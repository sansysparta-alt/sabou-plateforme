import { z } from 'zod';
import type { AccountRole } from '@sabou/types';
import type { Env } from '../config/env';
import { KeycloakAdminError, KeycloakServiceAccount } from '../keycloak/service-account';

export const IDENTITY_ADMIN = Symbol('IDENTITY_ADMIN');

// Rôle de la plateforme → rôle du domaine Keycloak. Les rôles d'administration portent le
// rôle composite « administrateur », qui impose le double facteur (R-ACC-03, §2.20).
export const KEYCLOAK_ROLES: Record<AccountRole, string> = {
  dg: 'dg',
  regional: 'admin_regional',
  prefectoral: 'admin_prefectoral',
  scientifique: 'comite',
};

// Mot de passe refusé par les règles du domaine ; le message de Keycloak est montré tel quel
export class PasswordRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordRejectedError';
  }
}

export class AccountExistsError extends Error {
  constructor() {
    super('Un compte Keycloak existe déjà avec cet identifiant.');
    this.name = 'AccountExistsError';
  }
}

export interface NewAccount {
  // Identifiant de connexion : l'adresse e-mail, en minuscules
  username: string;
  firstName: string;
  lastName: string;
  role: AccountRole;
  password: string;
}

// Opérations sur les comptes Keycloak, seule source des mots de passe et du double facteur
export interface IdentityAdmin {
  // Crée le compte avec son mot de passe et son rôle ; renvoie son identifiant (« sub »)
  createAccount(account: NewAccount): Promise<string>;
  deleteAccount(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  // Ferme toutes les sessions Keycloak du compte
  logoutAccount(id: string): Promise<void>;
}

const roleSchema = z.array(z.object({ id: z.string().min(1), name: z.string() }));
const errorSchema = z.object({
  error: z.string().optional(),
  error_description: z.string().optional(),
});

// Compte de service « sabou-comptes » : droits manage-users et view-users seulement.
// Sans view-realm, un rôle se lit dans la liste des rôles que le compte peut recevoir.
export class KeycloakIdentityAdmin implements IdentityAdmin {
  private readonly client: KeycloakServiceAccount;

  constructor(env: Env) {
    this.client = new KeycloakServiceAccount(env, env.COMPTES_CLIENT_ID, env.COMPTES_CLIENT_SECRET);
  }

  async createAccount(account: NewAccount): Promise<string> {
    let response: Response;
    try {
      response = await this.client.request('/users', {
        method: 'POST',
        body: {
          username: account.username,
          email: account.username,
          // L'adresse a été donnée par la DG, qui a transmis le lien elle-même
          emailVerified: true,
          enabled: true,
          firstName: account.firstName,
          lastName: account.lastName,
          credentials: [{ type: 'password', value: account.password, temporary: false }],
        },
      });
    } catch (error) {
      throw translateKeycloakError(error);
    }
    const id = /\/users\/([0-9a-f-]{36})$/.exec(response.headers.get('location') ?? '')?.[1];
    if (!id) throw new Error('Keycloak : identifiant du compte créé absent');
    try {
      const available = roleSchema.parse(
        await (await this.client.request(`/users/${id}/role-mappings/realm/available`)).json(),
      );
      const role = available.find((candidate) => candidate.name === KEYCLOAK_ROLES[account.role]);
      if (!role) throw new Error(`Keycloak : rôle ${KEYCLOAK_ROLES[account.role]} introuvable`);
      await this.client.request(`/users/${id}/role-mappings/realm`, {
        method: 'POST',
        body: [{ id: role.id, name: role.name }],
      });
    } catch (error) {
      // Pas de compte sans rôle : il est retiré, l'invitation reste utilisable
      await this.deleteAccount(id).catch(() => undefined);
      throw error;
    }
    return id;
  }

  async deleteAccount(id: string): Promise<void> {
    await this.client.request(`/users/${id}`, { method: 'DELETE' });
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.client.request(`/users/${id}`, { method: 'PUT', body: { enabled } });
  }

  async logoutAccount(id: string): Promise<void> {
    await this.client.request(`/users/${id}/logout`, { method: 'POST' });
  }
}

export function translateKeycloakError(error: unknown): unknown {
  if (!(error instanceof KeycloakAdminError)) return error;
  if (error.status === 409) return new AccountExistsError();
  if (error.status === 400) {
    const parsed = errorSchema.safeParse(safeJson(error.body));
    if (parsed.success && parsed.data.error?.startsWith('invalidPassword')) {
      return new PasswordRejectedError(
        parsed.data.error_description ?? 'Mot de passe refusé par les règles de sécurité.',
      );
    }
  }
  return error;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
