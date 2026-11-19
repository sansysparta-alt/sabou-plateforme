// US-075 : résumer une recette en français et enregistrer la voix locale (UC-33, R-GOV-02,
// R-GOV-06, R-LNG-10). Traitement d'essai de Mamadou Diallo (PR-1042, certifié, préfecture
// de Labé), soumis au Studio. Le préfectoral de Labé enregistre et traduit en pular et en
// français ; celui de Kankan n'a aucun droit sur Labé. Chaque cas part du même état
// (transaction annulée).
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const PRACTITIONER = 'm.diallo@exemple.gn';
const PREFECTORAL = 'prefectoral.labe@sabou-sante.gn';
const OTHER_PREFECTORAL = 'prefectoral.kankan@sabou-sante.gn';
const REGIONAL = 'regional.labe@sabou-sante.gn';

const FIELDS = {
  maladie: 'MA-001',
  titreFr: 'Résumé d’essai',
  cycleDureeJours: 5,
  cyclePrisesParJour: 1,
  plantes: [{ plante: 'PL-003', partie: 'gousses' }],
  sections: ['preparation', 'consommation', 'cycle', 'effets_indesirables'].map((type) => ({
    type,
    texteFr: `Texte du praticien : ${type}`,
  })),
  consentement: true,
  visibilite: 'publique',
};
const json = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
const CODE = `(SELECT code FROM recette WHERE titre_fr = 'Résumé d’essai')`;
const draft = `${openContext(PRACTITIONER)}
  SELECT traitement_enregistrer(NULL, NULL, ${json(FIELDS)});`;
const submitted = `${draft} SELECT traitement_soumettre(${CODE});`;
const revise = (texte: string, type = 'preparation', email = PREFECTORAL) =>
  `${openContext(email)} SELECT traitement_section_reviser(${CODE}, '${type}', '${texte}') AS revise;`;
// Dépôt traité du compte du contexte (chaîne de US-070)
const processed = (consent = true) => `
  SELECT id FROM voix_deposer('voix/originaux/' || gen_random_uuid() || '.webm', 'audio/webm', 9000,
                              '${'a'.repeat(64)}', ${consent});
  SELECT 1 FROM voix_depots_prendre(1);
  SELECT voix_depot_terminer((SELECT max(id) FROM voix_depot), 'voix/' || gen_random_uuid() || '.webm',
                             'voix/' || gen_random_uuid() || '.m4a', 1.2, 4000, 5000, '${'b'.repeat(64)}');`;
const record = (langue = 'pul', type = 'preparation', email = PREFECTORAL) =>
  `${openContext(email)} ${processed()}
   SELECT traitement_voix_enregistrer(${CODE}, '${type}', '${langue}', (SELECT max(id) FROM voix_depot)) AS statut;`;
const send = (langue = 'pul', type = 'preparation', email = PREFECTORAL) =>
  `${openContext(email)} SELECT traitement_voix_envoyer(${CODE}, '${type}', '${langue}') AS statut;`;
const voices = `
  SELECT s.type_code AS section, v.langue_code AS langue, v.statut, v.renvoi_motif AS motif,
         v.traducteur_id IS NOT NULL AS traducteur
    FROM recette_section_voix v JOIN recette_section s ON s.id = v.section_id
    JOIN recette r ON r.id = s.recette_id WHERE r.code = ${CODE}
   ORDER BY s.type_code, v.langue_code;`;
const run = (sql: string) => lastRows(db.url.app, sql);

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : texte français par section (révision du préfectoral)', () => {
  it('le préfectoral de la préfecture révise un traitement soumis ; le texte d’origine reste dans l’historique', async () => {
    const rows = await run(`${submitted} ${revise('Résumé du préfectoral')}
      SELECT s.texte_fr AS texte, h.texte_fr_avant AS avant, h.texte_fr AS apres, u.role_code AS par
        FROM recette_section s JOIN recette r ON r.id = s.recette_id
        JOIN recette_section_revision h ON h.section_id = s.id
        JOIN utilisateur u ON u.id = h.revise_par
       WHERE r.code = ${CODE} AND s.type_code = 'preparation';`);
    expect(rows).toEqual([
      {
        texte: 'Résumé du préfectoral',
        avant: 'Texte du praticien : preparation',
        apres: 'Résumé du préfectoral',
        par: 'prefectoral',
      },
    ]);
  });

  it('un texte identique n’ajoute pas de révision ; la révision est journalisée', async () => {
    const rows = await run(`${submitted} ${revise('Texte du praticien : preparation')}`);
    expect(rows).toEqual([{ revise: false }]);
    const audit = await run(`${submitted} ${revise('Nouveau texte')}
      SELECT action, details->>'section' AS section FROM journal_audit
       WHERE objet_id = ${CODE} AND action = 'recette.section_revisee';`);
    expect(audit).toEqual([{ action: 'recette.section_revisee', section: 'preparation' }]);
  });

  it('refusée hors de l’état « soumis » (brouillon, transmis) et pour un texte vide', async () => {
    await expect(run(`${draft} ${revise('Trop tôt')}`)).rejects.toThrow(
      'le texte se révise seulement quand il est soumis',
    );
    await expect(
      run(`${submitted}
        ${openContext(REGIONAL)} SELECT traitement_decider(${CODE}, 'soumise', 'avance', NULL);
        ${revise('Trop tard')}`),
    ).rejects.toThrow('le texte se révise seulement quand il est soumis');
    await expect(run(`${submitted} ${revise('   ')}`)).rejects.toThrow('1 à 4000 caractères');
  });

  it('refusée au préfectoral d’une autre préfecture, au régional et au praticien', async () => {
    for (const email of [OTHER_PREFECTORAL, REGIONAL, PRACTITIONER]) {
      await expect(run(`${submitted} ${revise('Intrus', 'preparation', email)}`)).rejects.toThrow(
        /réservée à l'administrateur préfectoral|introuvable/,
      );
    }
  });
});

describe('Critère : voix locale par section', () => {
  it('le préfectoral enregistre la voix de chaque section dans ses langues : brouillon', async () => {
    const rows = await run(`${submitted} ${record('pul')} ${record('fr', 'effets_indesirables')}
      ${voices}`);
    expect(rows).toEqual([
      {
        section: 'effets_indesirables',
        langue: 'fr',
        statut: 'brouillon',
        motif: null,
        traducteur: false,
      },
      {
        section: 'preparation',
        langue: 'pul',
        statut: 'brouillon',
        motif: null,
        traducteur: false,
      },
    ]);
  });

  it('refusé sans droit d’enregistrer dans la langue (malinké pour Labé)', async () => {
    await expect(run(`${submitted} ${record('mal')}`)).rejects.toThrow(
      "Droit d'enregistrer en mal absent",
    );
  });

  it('refusé au préfectoral d’une autre préfecture', async () => {
    await expect(
      run(`${submitted} ${record('mal', 'preparation', OTHER_PREFECTORAL)}`),
    ).rejects.toThrow(/réservé à l'administrateur préfectoral|introuvable/);
  });

  it('refusé avec le dépôt d’un autre compte', async () => {
    await expect(
      run(`${submitted} ${openContext(OTHER_PREFECTORAL)} ${processed()}
        ${openContext(PREFECTORAL)}
        SELECT traitement_voix_enregistrer(${CODE}, 'preparation', 'pul', (SELECT max(id) FROM voix_depot));`),
    ).rejects.toThrow('déposée par un autre compte');
  });

  it('pas d’écriture directe des voix de section par l’application', async () => {
    await expect(
      run(`${submitted} UPDATE recette_section_voix SET statut = 'publie';`),
    ).rejects.toThrow('permission denied');
  });
});

describe('Critère : envoi à l’admin régional de la langue', () => {
  it('celui qui a enregistré envoie : brouillon → traduit, traducteur noté', async () => {
    const rows = await run(`${submitted} ${record()} ${send()} ${voices}`);
    expect(rows).toEqual([
      { section: 'preparation', langue: 'pul', statut: 'traduit', motif: null, traducteur: true },
    ]);
  });

  it('pas d’envoi deux fois, ni sans voix', async () => {
    await expect(run(`${submitted} ${record()} ${send()} ${send()}`)).rejects.toThrow(
      'Transition traduit → traduit impossible',
    );
    await expect(run(`${submitted} ${send()}`)).rejects.toThrow('Aucune voix en pul');
  });

  it('un compte hors de la préfecture n’envoie pas', async () => {
    await expect(
      run(`${submitted} ${record()} ${send('pul', 'preparation', OTHER_PREFECTORAL)}`),
    ).rejects.toThrow(/Droit de traduire en pul absent|introuvable/);
  });
});

describe('Texte modifié : les voix de la section reviennent en brouillon', () => {
  it('une révision ramène la voix envoyée en brouillon, avec la raison', async () => {
    const rows = await run(
      `${submitted} ${record()} ${send()} ${revise('Texte révisé')} ${voices}`,
    );
    expect(rows).toEqual([
      {
        section: 'preparation',
        langue: 'pul',
        statut: 'brouillon',
        motif: 'Texte français modifié : voix à vérifier',
        traducteur: false,
      },
    ]);
  });

  it('le Studio garde les sections et leurs voix quand le texte ne change pas', async () => {
    // Renvoi du régional en brouillon, puis nouvel enregistrement du praticien sans changement
    const rows = await run(`${submitted} ${record()}
      ${openContext(REGIONAL)} SELECT traitement_decider(${CODE}, 'soumise', 'renvoi', 'À compléter');
      ${openContext(PRACTITIONER)}
      SELECT traitement_enregistrer(${CODE}, (SELECT updated_at FROM recette WHERE code = ${CODE}),
                                    ${json(FIELDS)});
      ${voices}`);
    expect(rows).toEqual([
      {
        section: 'preparation',
        langue: 'pul',
        statut: 'brouillon',
        motif: null,
        traducteur: false,
      },
    ]);
  });
});
