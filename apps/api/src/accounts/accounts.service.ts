import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { InvitationLink, InvitationPreview, InviteRequest } from '@sabou/types';
import { AUDIT_LOG, type AuditLog } from '../audit/audit.log';
import { SESSION_STORE, type SessionStore } from '../auth/session.store';
import { ENV, type Env } from '../config/env';
import { AccountsRepository, type Trx } from './accounts.repository';
import {
  AccountExistsError,
  IDENTITY_ADMIN,
  PasswordRejectedError,
  type IdentityAdmin,
} from './identity-admin';

// Auteur d'une décision : compte Keycloak de la session et IP de la requête
export interface Actor {
  sub: string;
  ip: string | undefined;
}

export const digestToken = (token: string): Buffer => createHash('sha256').update(token).digest();

const INVALID_LINK = 'Ce lien d’invitation n’est plus valable. Demandez-en un nouveau à la DG.';

// Erreur PostgreSQL traduite en réponse compréhensible ; le reste remonte tel quel
function databaseError(error: unknown): unknown {
  const { code, constraint } = error as { code?: string; constraint?: string };
  if (code === '23505' && constraint === 'ux_utilisateur_email') {
    return new ConflictException('Un compte existe déjà avec cette adresse e-mail.');
  }
  // Un seul compte DG actif (US-024)
  if (code === '23505' && constraint === 'ux_utilisateur_dg_unique') {
    return new ConflictException(
      'Un compte DG est déjà actif : il n’y a qu’un seul compte DG. Sa récupération passe par l’administrateur technique.',
    );
  }
  if (code === '23514' && constraint === 'ck_zone_role') {
    return new BadRequestException('La zone ne correspond pas au rôle.');
  }
  // Clé étrangère (région, préfecture ou langue inconnue) ou langue d'un usage inadapté
  if (code === '23503' || code === 'P0001') {
    return new BadRequestException('Zone ou langue inconnue, ou langue inadaptée à son usage.');
  }
  return error;
}

// Gestion des comptes par la DG (lot A : US-012, US-013, UC-65). Chaque décision et sa
// ligne d'audit sont confirmées ou annulées ensemble ; Keycloak est appelé dans la
// transaction, pour qu'un échec de Keycloak annule la décision.
@Injectable()
export class AccountsService {
  private readonly logger = new Logger('Comptes');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly repository: AccountsRepository,
    @Inject(IDENTITY_ADMIN) private readonly idp: IdentityAdmin,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}

  async invite(input: InviteRequest, actor: Actor): Promise<InvitationLink> {
    try {
      return await this.repository.transaction(async (trx) => {
        const accountId = await this.repository.createInvited(trx, input);
        const link = await this.issue(trx, accountId, actor);
        await this.audit.record(
          {
            action: 'compte.invite',
            objectType: 'utilisateur',
            objectId: String(accountId),
            account: actor.sub,
            userId: (await this.repository.userIdBySub(actor.sub, trx)) ?? undefined,
            ip: actor.ip,
            details: {
              email: input.email,
              role: input.role,
              region: input.regionId,
              prefecture: input.prefectureId,
              langues: input.languages,
            },
          },
          trx,
        );
        return link;
      });
    } catch (error) {
      throw databaseError(error);
    }
  }

  // Nouveau lien pour un compte encore invité (lien perdu ou expiré)
  async renewInvitation(accountId: number, actor: Actor): Promise<InvitationLink> {
    return this.repository.transaction(async (trx) => {
      const link = await this.issue(trx, accountId, actor);
      await this.audit.record(
        {
          action: 'compte.invitation_renouvelee',
          objectType: 'utilisateur',
          objectId: String(accountId),
          account: actor.sub,
          userId: (await this.repository.userIdBySub(actor.sub, trx)) ?? undefined,
          ip: actor.ip,
        },
        trx,
      );
      return link;
    });
  }

  private async issue(trx: Trx, accountId: number, actor: Actor): Promise<InvitationLink> {
    // 256 bits ; seule l'empreinte est écrite en base
    const token = randomBytes(32).toString('base64url');
    const expiresAt = await this.repository.issueInvitation(
      trx,
      accountId,
      digestToken(token),
      this.env.INVITATION_HOURS,
      await this.repository.userIdBySub(actor.sub, trx),
    );
    if (!expiresAt) throw new ConflictException('Ce compte n’est plus en attente d’invitation.');
    // Jeton dans le fragment : jamais transmis au serveur qui sert la page
    const link = new URL('/invitation', this.env.ADMIN_APP_URL);
    link.hash = token;
    return { accountId, link: link.href, expiresAt: expiresAt.toISOString() };
  }

  async preview(token: string): Promise<InvitationPreview> {
    const pending = await this.repository.findInvitation(digestToken(token));
    if (!pending) throw new GoneException(INVALID_LINK);
    const { firstName, lastName, email, role } = pending;
    return { firstName, lastName, email, role };
  }

  // L'invité choisit son mot de passe : transmis une seule fois à Keycloak, jamais gardé
  // ni journalisé (écart assumé à §2.20, décision du 6 novembre 2026)
  async accept(token: string, password: string, ip: string | undefined): Promise<void> {
    let created = null as string | null;
    try {
      await this.repository.transaction(async (trx) => {
        const pending = await this.repository.findInvitation(digestToken(token), trx);
        if (!pending) throw new GoneException(INVALID_LINK);
        created = await this.idp.createAccount({
          username: pending.email,
          firstName: pending.firstName,
          lastName: pending.lastName,
          role: pending.role,
          password,
        });
        await this.repository.activate(trx, pending, created);
        await this.audit.record(
          {
            action: 'compte.active',
            objectType: 'utilisateur',
            objectId: String(pending.accountId),
            account: created,
            userId: pending.accountId,
            ip,
            details: { role: pending.role },
          },
          trx,
        );
      });
    } catch (error) {
      // Pas de compte Keycloak sans compte de la plateforme : la création est défaite
      if (created) {
        await this.idp.deleteAccount(created).catch((cleanup: unknown) => {
          this.logger.error(
            `Compte Keycloak ${created} à supprimer à la main : ${(cleanup as Error).message}`,
          );
        });
      }
      if (error instanceof PasswordRejectedError) throw new BadRequestException(error.message);
      if (error instanceof AccountExistsError) {
        throw new ConflictException('Un compte existe déjà pour cette adresse e-mail.');
      }
      throw databaseError(error);
    }
    this.logger.log(`Invitation acceptée : compte ${String(created)}`);
  }

  async suspend(accountId: number, actor: Actor): Promise<void> {
    const self = await this.repository.userIdBySub(actor.sub);
    if (self === accountId) {
      throw new BadRequestException('Vous ne pouvez pas suspendre votre propre compte.');
    }
    let revoked = null as string | null;
    try {
      await this.repository.transaction(async (trx) => {
        const change = await this.repository.changeStatus(trx, accountId, 'actif', 'suspendu');
        if (!change) throw await this.statusError(accountId, 'actif');
        await this.audit.record(
          {
            action: 'compte.suspendu',
            objectType: 'utilisateur',
            objectId: String(accountId),
            account: actor.sub,
            userId: self ?? undefined,
            ip: actor.ip,
            details: { compte: change.keycloakId, email: change.email },
          },
          trx,
        );
        // Sessions de l'API d'abord (effet immédiat), puis Keycloak : plus de nouvelle
        // connexion, plus de session ni de jeton de rafraîchissement valable
        revoked = change.keycloakId;
        await this.sessions.revokeAccount(change.keycloakId);
        await this.idp.setEnabled(change.keycloakId, false);
        await this.idp.logoutAccount(change.keycloakId);
      });
    } catch (error) {
      // Suspension annulée : le compte retrouve l'accès aux sessions de l'API
      if (revoked) await this.sessions.restoreAccount(revoked).catch(() => undefined);
      throw error;
    }
  }

  async reactivate(accountId: number, actor: Actor): Promise<void> {
    await this.repository.transaction(async (trx) => {
      const change = await this.repository
        .changeStatus(trx, accountId, 'suspendu', 'actif')
        .catch((error: unknown) => {
          throw databaseError(error);
        });
      if (!change) throw await this.statusError(accountId, 'suspendu');
      await this.audit.record(
        {
          action: 'compte.reactive',
          objectType: 'utilisateur',
          objectId: String(accountId),
          account: actor.sub,
          userId: (await this.repository.userIdBySub(actor.sub, trx)) ?? undefined,
          ip: actor.ip,
          details: { compte: change.keycloakId, email: change.email },
        },
        trx,
      );
      await this.idp.setEnabled(change.keycloakId, true);
      await this.sessions.restoreAccount(change.keycloakId);
    });
  }

  private async statusError(accountId: number, expected: 'actif' | 'suspendu'): Promise<Error> {
    const current = await this.repository.statusOf(accountId);
    if (!current) return new NotFoundException('Compte introuvable.');
    return new ConflictException(
      expected === 'actif' ? 'Ce compte n’est pas actif.' : 'Ce compte n’est pas suspendu.',
    );
  }
}
