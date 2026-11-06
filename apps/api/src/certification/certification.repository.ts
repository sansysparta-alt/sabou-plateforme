import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { DossierSummary, PractitionerSummary, ZoneListQuery, ZonePage } from '@sabou/types';
import { DATABASE, type Database } from '../database/database';
import { inZone } from '../database/zone';

// Page de « limite » éléments : une ligne de plus est lue pour savoir s'il en reste
function page<T extends { code: string }>(rows: T[], limit: number): ZonePage<T> {
  const elements = rows.slice(0, limit);
  return { elements, suivant: rows.length > limit ? elements.at(-1)!.code : null };
}

// Lectures des praticiens et des dossiers (US-011). Aucun filtre de zone ici : les règles
// RLS de la base l'appliquent, dans le contexte ouvert par inZone.
@Injectable()
export class CertificationRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  listPractitioners(sub: string, query: ZoneListQuery): Promise<ZonePage<PractitionerSummary>> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<PractitionerSummary>`
        SELECT p.code, u.prenom, u.nom, sp.libelle_fr AS specialite, pf.nom AS prefecture,
               ra.nom AS region, p.statut
          FROM sabou.praticien p
          JOIN sabou.utilisateur u    ON u.id = p.utilisateur_id
          JOIN sabou.specialite sp    ON sp.id = p.specialite_id
          JOIN sabou.prefecture pf    ON pf.id = p.prefecture_id
          JOIN sabou.region_admin ra  ON ra.id = pf.region_admin_id
         WHERE ${query.apres ?? null}::text IS NULL OR p.code > ${query.apres ?? null}
         ORDER BY p.code
         LIMIT ${query.limite + 1}`.execute(trx);
      return page(rows, query.limite);
    });
  }

  listDossiers(sub: string, query: ZoneListQuery): Promise<ZonePage<DossierSummary>> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<DossierSummary>`
        SELECT d.code, p.code AS praticien, u.prenom || ' ' || u.nom AS "praticienNom",
               pf.nom AS prefecture, d.type, d.etape_courante AS etape, d.statut,
               to_char(d.ouvert_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "ouvertLe"
          FROM sabou.dossier_certification d
          JOIN sabou.praticien p   ON p.id = d.praticien_id
          JOIN sabou.utilisateur u ON u.id = p.utilisateur_id
          JOIN sabou.prefecture pf ON pf.id = p.prefecture_id
         WHERE ${query.apres ?? null}::text IS NULL OR d.code > ${query.apres ?? null}
         ORDER BY d.code
         LIMIT ${query.limite + 1}`.execute(trx);
      return page(rows, query.limite);
    });
  }
}
