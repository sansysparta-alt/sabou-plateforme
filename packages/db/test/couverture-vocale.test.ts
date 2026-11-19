// US-074 : suivre la couverture vocale par langue et publier les voix validées (UC-63,
// R-GOV-05, R-LNG-10 à 12). Jeu d'exemple : REC-2041 (certifié, Kankan) a des voix publiées
// en malinké et en français. Traitement d'essai de Mamadou Diallo (PR-1042, Labé), mené
// jusqu'à la certification, avec des voix en pular validées. Chaque cas part du même état
// (transaction annulée).
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
  titreFr: 'Couverture d’essai',
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
const CODE = `(SELECT code FROM recette WHERE titre_fr = 'Couverture d’essai')`;
const processed = (consent = true) => `
  SELECT id FROM voix_deposer('voix/originaux/' || gen_random_uuid() || '.webm', 'audio/webm', 9000,
                              '${'a'.repeat(64)}', ${consent});
  SELECT 1 FROM voix_depots_prendre(1);
  SELECT voix_depot_terminer((SELECT max(id) FROM voix_depot), 'voix/' || gen_random_uuid() || '.webm',
                             'voix/' || gen_random_uuid() || '.m4a', 1.2, 4000, 5000, '${'b'.repeat(64)}');`;
const decide = (email: string, seen: string) =>
  `${openContext(email)} SELECT traitement_decider(${CODE}, '${seen}', 'avance', NULL);`;
const submitted = `${openContext(PRACTITIONER)}
  SELECT traitement_enregistrer(NULL, NULL, ${json(FIELDS)});
  SELECT traitement_soumettre(${CODE});`;
const certified = `${decide(REGIONAL, 'soumise')} ${decide(COMMITTEE, 'transmise')} ${decide(DG, 'expertisee')}`;
// Voix en pular d'une section, validée par le régional
const validated = (type: string, consent = true) => `
  ${openContext(PREFECTORAL)} ${processed(consent)}
  SELECT traitement_voix_enregistrer(${CODE}, '${type}', 'pul', (SELECT max(id) FROM voix_depot));
  SELECT traitement_voix_envoyer(${CODE}, '${type}', 'pul');
  ${openContext(REGIONAL)} SELECT traitement_voix_valider(${CODE}, '${type}', 'pul', true);`;
const publish = (langue = 'NULL') =>
  `${openContext(DG)} SELECT * FROM traitement_voix_publier(${langue});`;
const statuses = `
  SELECT s.type_code AS section, v.statut FROM recette_section_voix v
    JOIN recette_section s ON s.id = v.section_id JOIN recette r ON r.id = s.recette_id
   WHERE r.code = ${CODE} ORDER BY s.type_code;`;
const run = (sql: string) => lastRows(db.url.app, sql);

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : publication groupée des voix validées', () => {
  it('la DG publie d’un coup toutes les voix validées publiables ; les effets non contrôlés restent bloqués', async () => {
    const rows = await run(`${submitted} ${validated('preparation')} ${validated('cycle')}
      ${validated('effets_indesirables')} ${certified} ${publish()}`);
    expect(rows).toEqual([{ publiees: 2, bloquees: 1 }]);
    expect(
      await run(`${submitted} ${validated('preparation')} ${validated('effets_indesirables')}
        ${certified} ${publish()} ${statuses}`),
    ).toEqual([
      { section: 'effets_indesirables', statut: 'valide' },
      { section: 'preparation', statut: 'publie' },
    ]);
  });

  it('effets indésirables contrôlés par le Comité : publiés avec le reste', async () => {
    const rows = await run(`${submitted} ${validated('effets_indesirables')}
      ${openContext(COMMITTEE)} SELECT traitement_voix_controler(${CODE}, 'pul', true);
      ${certified} ${publish("'pul'")}`);
    expect(rows).toEqual([{ publiees: 1, bloquees: 0 }]);
  });

  it('bloquées : traitement non certifié, voix sans consentement ; filtre par langue', async () => {
    expect(await run(`${submitted} ${validated('preparation')} ${publish()}`)).toEqual([
      { publiees: 0, bloquees: 1 },
    ]);
    expect(
      await run(`${submitted} ${validated('preparation', false)} ${certified} ${publish()}`),
    ).toEqual([{ publiees: 0, bloquees: 1 }]);
    expect(
      await run(`${submitted} ${validated('preparation')} ${certified} ${publish("'mal'")}`),
    ).toEqual([{ publiees: 0, bloquees: 0 }]);
  });

  it('réservée à la DG ; journalisée', async () => {
    await expect(
      run(`${submitted} ${openContext(REGIONAL)} SELECT * FROM traitement_voix_publier(NULL);`),
    ).rejects.toThrow('Publication réservée à la Direction Générale');
    const audit = await run(`${submitted} ${validated('preparation')} ${certified} ${publish()}
      SELECT details->>'publiees' AS n FROM journal_audit WHERE action = 'recette.voix_publiees';`);
    expect(audit).toEqual([{ n: '1' }]);
  });
});

describe('Critère : pourcentage de sections publiées par langue et retards par région', () => {
  it('couverture : sections des traitements certifiés et voix publiées, par langue', async () => {
    const rows = await run(`${openContext(DG)}
      SELECT langue, sections, publiees FROM voix_couverture() WHERE langue IN ('mal', 'pul', 'fr')
       ORDER BY langue;`);
    // Jeu d'exemple : REC-2041 (5 sections), REC-2042 et REC-2044 (4 chacun) certifiés
    expect(rows).toEqual([
      { langue: 'fr', sections: 13, publiees: 2 },
      { langue: 'mal', sections: 13, publiees: 4 },
      { langue: 'pul', sections: 13, publiees: 0 },
    ]);
    const after = await run(`${submitted} ${validated('preparation')} ${certified} ${publish()}
      ${openContext(DG)} SELECT sections, publiees FROM voix_couverture() WHERE langue = 'pul';`);
    expect(after).toEqual([{ sections: 17, publiees: 1 }]);
  });

  it('retards : voix en attente depuis plus de 7 jours, par région du praticien', async () => {
    const rows = await lastRows(
      db.url.postgres,
      `${submitted} ${validated('preparation')}
       ALTER TABLE recette_section_voix DISABLE TRIGGER trg_rsv_pub;
       UPDATE recette_section_voix SET updated_at = now() - interval '8 days';
       ALTER TABLE recette_section_voix ENABLE TRIGGER trg_rsv_pub;
       ${openContext(DG)} SELECT region, validees FROM voix_retards() WHERE region = 'Labé';`,
    );
    expect(rows).toEqual([{ region: 'Labé', validees: 1 }]);
    expect(
      await run(`${submitted} ${validated('preparation')}
        ${openContext(DG)} SELECT count(*)::int AS n FROM voix_retards() WHERE region = 'Labé';`),
    ).toEqual([{ n: 0 }]);
  });

  it('couverture et retards : rien pour un autre profil que la DG', async () => {
    expect(
      await run(`${openContext(REGIONAL)} SELECT count(*)::int AS n FROM voix_couverture();`),
    ).toEqual([{ n: 0 }]);
  });
});
