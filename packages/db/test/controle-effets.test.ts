// US-073 : contrôler la voix des effets indésirables dans chaque langue (UC-53, R-LNG-12,
// R-GOV-04). Traitement d'essai de Mamadou Diallo (PR-1042, Labé) : voix des effets
// indésirables en pular enregistrée par le préfectoral de Labé, validée par le régional de
// Labé, puis contrôlée par le Comité. Chaque cas part du même état (transaction annulée).
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const PRACTITIONER = 'm.diallo@exemple.gn';
const PREFECTORAL = 'prefectoral.labe@sabou-sante.gn';
const REGIONAL = 'regional.labe@sabou-sante.gn';
const COMMITTEE = 'comite@sabou-sante.gn';
const DG = 'dg@sabou-sante.gn';

const FIELDS = {
  maladie: 'MA-001',
  titreFr: 'Contrôle d’essai',
  cycleDureeJours: 5,
  cyclePrisesParJour: 1,
  plantes: [{ plante: 'PL-003', partie: 'gousses' }],
  sections: ['preparation', 'consommation', 'cycle', 'effets_indesirables'].map((type) => ({
    type,
    texteFr: `Texte : ${type}`,
  })),
  consentement: true,
  visibilite: 'publique',
};
const json = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
const CODE = `(SELECT code FROM recette WHERE titre_fr = 'Contrôle d’essai')`;
const processed = `
  SELECT id FROM voix_deposer('voix/originaux/' || gen_random_uuid() || '.webm', 'audio/webm', 9000,
                              '${'a'.repeat(64)}', true);
  SELECT 1 FROM voix_depots_prendre(1);
  SELECT voix_depot_terminer((SELECT max(id) FROM voix_depot), 'voix/' || gen_random_uuid() || '.webm',
                             'voix/' || gen_random_uuid() || '.m4a', 1.2, 4000, 5000, '${'b'.repeat(64)}');`;
// Voix d'une section validée par le régional
const validated = (type = 'effets_indesirables') => `${openContext(PRACTITIONER)}
  SELECT traitement_enregistrer(NULL, NULL, ${json(FIELDS)});
  SELECT traitement_soumettre(${CODE});
  ${openContext(PREFECTORAL)} ${processed}
  SELECT traitement_voix_enregistrer(${CODE}, '${type}', 'pul', (SELECT max(id) FROM voix_depot));
  SELECT traitement_voix_envoyer(${CODE}, '${type}', 'pul');
  ${openContext(REGIONAL)} SELECT traitement_voix_valider(${CODE}, '${type}', 'pul', true);`;
const control = (email = COMMITTEE, accepte = true, motif = 'NULL') =>
  `${openContext(email)} SELECT traitement_voix_controler(${CODE}, 'pul', ${accepte}, ${motif}) AS r;`;
const state = `
  SELECT v.statut, v.renvoi_motif AS motif, u.role_code AS controleur, v.controle_comite_le IS NOT NULL AS date
    FROM recette_section_voix v JOIN recette_section s ON s.id = v.section_id
    JOIN recette r ON r.id = s.recette_id LEFT JOIN utilisateur u ON u.id = v.controle_comite_par
   WHERE r.code = ${CODE} AND s.type_code = 'effets_indesirables';`;
// Publication tentée directement (compte propriétaire) : seul le déclencheur s'y oppose
const forcePublish = `UPDATE recette_section_voix v SET statut = 'publie'
  FROM recette_section s, recette r
 WHERE s.id = v.section_id AND r.id = s.recette_id AND r.code = ${CODE};`;
const run = (sql: string) => lastRows(db.url.app, sql);
const owner = (sql: string) => lastRows(db.url.postgres, sql);

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : sans ce contrôle, la voix des effets indésirables ne peut pas être publiée', () => {
  it('voix validée mais non contrôlée : la publication est refusée par la base', async () => {
    await expect(owner(`${validated()} ${forcePublish}`)).rejects.toThrow(
      'contrôle du Comité requis avant publication',
    );
  });

  it('après le contrôle du Comité, la même publication passe', async () => {
    const rows = await owner(`${validated()} ${control()} ${forcePublish} ${state}`);
    expect(rows).toEqual([
      { statut: 'publie', motif: null, controleur: 'scientifique', date: true },
    ]);
  });

  it('les autres sections ne demandent pas ce contrôle', async () => {
    await expect(owner(`${validated('preparation')} ${forcePublish}`)).resolves.toEqual([]);
  });
});

describe('Contrôle par le Comité, dans chaque langue', () => {
  it('contrôle : auteur et date notés, journalisé', async () => {
    expect(await run(`${validated()} ${control()} ${state}`)).toEqual([
      { statut: 'valide', motif: null, controleur: 'scientifique', date: true },
    ]);
    const audit = await run(`${validated()} ${control()}
      SELECT details->>'langue' AS langue FROM journal_audit
       WHERE objet_id = ${CODE} AND action = 'recette.voix_controlee';`);
    expect(audit).toEqual([{ langue: 'pul' }]);
  });

  it('renvoi en brouillon avec motif obligatoire', async () => {
    await expect(run(`${validated()} ${control(COMMITTEE, false)}`)).rejects.toThrow(
      'Motif du renvoi obligatoire',
    );
    expect(
      await run(
        `${validated()} ${control(COMMITTEE, false, "'Contre-indication omise'")} ${state}`,
      ),
    ).toEqual([
      { statut: 'brouillon', motif: 'Contre-indication omise', controleur: null, date: false },
    ]);
  });

  it('seulement une voix validée, et une seule fois', async () => {
    await expect(run(`${validated()} ${control()} ${control()}`)).rejects.toThrow(
      'contrôle impossible',
    );
  });

  it('réservé au Comité : régional et DG refusés', async () => {
    for (const email of [REGIONAL, DG]) {
      await expect(run(`${validated()} ${control(email)}`)).rejects.toThrow(
        'Contrôle réservé au Comité scientifique',
      );
    }
  });
});
