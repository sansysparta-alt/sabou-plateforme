import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateLanguage,
  CreateSpecialty,
  CreateTerritory,
  TerritoryLevel,
  UpdateLanguage,
  UpdateSpecialty,
} from '@sabou/types';
import { AUDIT_LOG, type AuditLog } from '../audit/audit.log';
import type { Trx } from '../accounts/accounts.repository';
import type { Actor } from '../accounts/accounts.service';
import { ReferentialsRepository } from './referentials.repository';

// Refus de la base traduits en messages pour la DG ; le reste remonte tel quel (erreur 500)
const CONSTRAINT_MESSAGES: Record<string, string> = {
  ck_langue_nationale_voix: 'Une langue nationale existe uniquement en voix (aucun texte écrit).',
  ck_langue_francais: 'Le français reste actif : c’est la langue de repli de la plateforme.',
  ck_langue_region:
    'Cette langue est la langue par défaut d’une région naturelle : elle reste active.',
  ck_langue_usage_fixe: 'Le code, le type et l’usage d’une langue sont fixés à sa création.',
};

export function databaseError(error: unknown): unknown {
  const { code, constraint } = error as { code?: string; constraint?: string };
  if (code === '23505') return new ConflictException('Cette valeur existe déjà.');
  if (code === '23503') return new BadRequestException('Rattachement inconnu.');
  if (code === '23514' && constraint && constraint in CONSTRAINT_MESSAGES) {
    return new BadRequestException(CONSTRAINT_MESSAGES[constraint]);
  }
  return error;
}

const TERRITORY_OBJECTS: Record<TerritoryLevel, string> = {
  regions: 'region_admin',
  prefectures: 'prefecture',
  'sous-prefectures': 'sous_prefecture',
};

// Paramétrage des référentiels par la DG (lot C : US-020, US-021, UC-65). Chaque
// modification et sa ligne d'audit sont confirmées ou annulées ensemble (R-DON-02).
@Injectable()
export class ReferentialsService {
  constructor(
    private readonly repository: ReferentialsRepository,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}

  createLanguage(input: CreateLanguage, actor: Actor): Promise<void> {
    return this.decide(actor, 'referentiel.langue_ajoutee', 'langue', async (trx) => {
      await this.repository.createLanguage(trx, input);
      return { id: input.code, details: { ...input } };
    });
  }

  updateLanguage(code: string, input: UpdateLanguage, actor: Actor): Promise<void> {
    return this.decide(actor, 'referentiel.langue_modifiee', 'langue', async (trx) => {
      if (!(await this.repository.updateLanguage(trx, code, input))) throw notFound();
      return { id: code, details: { ...input } };
    });
  }

  createTerritory(level: TerritoryLevel, input: CreateTerritory, actor: Actor): Promise<void> {
    const object = TERRITORY_OBJECTS[level];
    return this.decide(actor, 'referentiel.territoire_ajoute', object, async (trx) => {
      const id = await this.repository.createTerritory(trx, level, input.name, input.parentId);
      return { id: String(id), details: { ...input } };
    });
  }

  renameTerritory(level: TerritoryLevel, id: number, name: string, actor: Actor): Promise<void> {
    const object = TERRITORY_OBJECTS[level];
    return this.decide(actor, 'referentiel.territoire_renomme', object, async (trx) => {
      const previous = await this.repository.renameTerritory(trx, level, id, name);
      if (previous === null) throw notFound();
      return { id: String(id), details: { avant: previous, apres: name } };
    });
  }

  createSpecialty(input: CreateSpecialty, actor: Actor): Promise<void> {
    return this.decide(actor, 'referentiel.specialite_ajoutee', 'specialite', async (trx) => {
      const id = await this.repository.createSpecialty(trx, input);
      return { id: String(id), details: { ...input } };
    });
  }

  updateSpecialty(id: number, input: UpdateSpecialty, actor: Actor): Promise<void> {
    return this.decide(actor, 'referentiel.specialite_modifiee', 'specialite', async (trx) => {
      if (!(await this.repository.updateSpecialty(trx, id, input))) throw notFound();
      return { id: String(id), details: { ...input } };
    });
  }

  // US-063 : contre-indications structurées (R-REC-05)
  createContraindication(input: CreateSpecialty, actor: Actor): Promise<void> {
    return this.decide(
      actor,
      'referentiel.contre_indication_ajoutee',
      'contre_indication',
      async (trx) => {
        const id = await this.repository.createContraindication(trx, input);
        return { id: String(id), details: { ...input } };
      },
    );
  }

  updateContraindication(id: number, input: UpdateSpecialty, actor: Actor): Promise<void> {
    return this.decide(
      actor,
      'referentiel.contre_indication_modifiee',
      'contre_indication',
      async (trx) => {
        if (!(await this.repository.updateContraindication(trx, id, input))) throw notFound();
        return { id: String(id), details: { ...input } };
      },
    );
  }

  private async decide(
    actor: Actor,
    action: string,
    objectType: string,
    work: (trx: Trx) => Promise<{ id: string; details: Record<string, unknown> }>,
  ): Promise<void> {
    try {
      await this.repository.transaction(async (trx) => {
        const { id, details } = await work(trx);
        await this.audit.record(
          {
            action,
            objectType,
            objectId: id,
            account: actor.sub,
            userId: (await this.repository.userIdBySub(actor.sub, trx)) ?? undefined,
            ip: actor.ip,
            details,
          },
          trx,
        );
      });
    } catch (error) {
      throw databaseError(error);
    }
  }
}

const notFound = () => new NotFoundException('Élément introuvable.');
