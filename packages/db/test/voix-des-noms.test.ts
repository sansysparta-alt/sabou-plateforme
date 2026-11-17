// US-071 : voix du nom des plantes et des maladies, par langue, avec ses statuts (R-LNG-10,
// R-LNG-11, R-GOV-03, R-GOV-05 à 07). Jeu d'exemple : le préfectoral de Labé enregistre et
// traduit en pular (pas de droit de valider) ; le régional de Labé valide le pular ; la DG
// publie. PL-002 n'a pas de voix en pular. Chaque cas part du même état (transaction annulée).
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const RECORDER = 'prefectoral.labe@sabou-sante.gn';
const VALIDATOR = 'regional.labe@sabou-sante.gn';
const DG = 'dg@sabou-sante.gn';
const as = (email: string, sql: string) => lastRows(db.url.app, `${openContext(email)} ${sql}`);

// Dépôt traité du compte du contexte (chaîne de US-070), avec ou sans consentement
const processed = (consent = true) => `
  SELECT id FROM voix_deposer('voix/originaux/' || gen_random_uuid() || '.webm', 'audio/webm', 9000,
                              '${'a'.repeat(64)}', ${consent});
  SELECT 1 FROM voix_depots_prendre(1);
  SELECT voix_depot_terminer((SELECT max(id) FROM voix_depot), 'voix/' || gen_random_uuid() || '.webm',
                             'voix/' || gen_random_uuid() || '.m4a', 1.2, 4000, 5000, '${'b'.repeat(64)}');`;
const record = (code = 'PL-002', objet = 'plante', langue = 'pul') =>
  `SELECT voix_nom_enregistrer('${objet}', '${code}', '${langue}', (SELECT max(id) FROM voix_depot)) AS statut;`;
const move = (to: string, motif = 'NULL', code = 'PL-002', objet = 'plante', langue = 'pul') =>
  `SELECT voix_nom_statut('${objet}', '${code}', '${langue}', '${to}', ${motif}) AS statut;`;
const state = (code = 'PL-002') => `
  SELECT v.statut, v.renvoi_motif AS motif, v.valideur_id IS NOT NULL AS valideur
    FROM plante_voix v JOIN plante p ON p.id = v.plante_id
   WHERE p.code = '${code}' AND v.langue_code = 'pul';`;

// Mise en place par un seul compte puis enchaînement par d'autres : chaque compte ouvre son
// contexte dans la même transaction (openContext remplace le précédent)
const chain = (...steps: [email: string, sql: string][]) =>
  lastRows(db.url.app, steps.map(([email, sql]) => `${openContext(email)} ${sql}`).join('\n'));

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : statuts Brouillon → Traduit → Validé → Publié par langue', () => {
  it('le circuit complet, chaque geste par le compte qui en a le droit', async () => {
    const rows = await chain(
      [RECORDER, `${processed()} ${record()} ${move('traduit')}`],
      [VALIDATOR, move('valide')],
      [DG, `${move('publie')} ${state()}`],
    );
    expect(rows).toEqual([{ statut: 'publie', motif: null, valideur: true }]);
  });

  it('enregistrer met la voix en brouillon ; un nouvel enregistrement y ramène une voix publiée', async () => {
    expect(await as(RECORDER, `${processed()} ${record()} ${state()}`)).toEqual([
      { statut: 'brouillon', motif: null, valideur: false },
    ]);
    // PL-001 a déjà une voix publiée en pular dans le jeu d'exemple
    expect(await as(RECORDER, `${processed()} ${record('PL-001')} ${state('PL-001')}`)).toEqual([
      { statut: 'brouillon', motif: null, valideur: false },
    ]);
  });

  it('pas de saut d’étape : brouillon → validé ou → publié refusés', async () => {
    await expect(
      chain([RECORDER, `${processed()} ${record()}`], [VALIDATOR, move('valide')]),
    ).rejects.toThrow('Transition brouillon → valide impossible');
    await expect(
      chain([RECORDER, `${processed()} ${record()}`], [DG, move('publie')]),
    ).rejects.toThrow('Transition brouillon → publie impossible');
  });

  it('renvoi en brouillon par le valideur, motif obligatoire et gardé', async () => {
    await expect(
      chain(
        [RECORDER, `${processed()} ${record()} ${move('traduit')}`],
        [VALIDATOR, move('brouillon')],
      ),
    ).rejects.toThrow('Motif du renvoi obligatoire');
    const rows = await chain(
      [RECORDER, `${processed()} ${record()} ${move('traduit')}`],
      [VALIDATOR, `${move('brouillon', "'Nom mal prononcé'")} ${state()}`],
    );
    expect(rows).toEqual([{ statut: 'brouillon', motif: 'Nom mal prononcé', valideur: false }]);
  });

  it('maladie : même circuit (MA-002 en malinké, préfectoral et régional de Kankan)', async () => {
    const rows = await chain(
      [
        'prefectoral.kankan@sabou-sante.gn',
        `${processed()} ${record('MA-002', 'maladie', 'mal')} ${move('traduit', 'NULL', 'MA-002', 'maladie', 'mal')}`,
      ],
      ['regional.kankan@sabou-sante.gn', move('valide', 'NULL', 'MA-002', 'maladie', 'mal')],
      [DG, move('publie', 'NULL', 'MA-002', 'maladie', 'mal')],
    );
    expect(rows).toEqual([{ statut: 'publie' }]);
  });

  it('chaque geste est tracé au journal d’audit', async () => {
    const rows = await chain(
      [RECORDER, `${processed()} ${record()} ${move('traduit')}`],
      [
        VALIDATOR,
        `${move('valide')} SELECT action FROM journal_audit
           WHERE objet_id = 'PL-002' AND action LIKE 'plante.voix_%' ORDER BY id;`,
      ],
    );
    expect(rows.map((r) => r.action)).toEqual([
      'plante.voix_enregistree',
      'plante.voix_traduit',
      'plante.voix_valide',
    ]);
  });
});

describe('Critère : publication impossible sans consentement ; le valideur n’a jamais enregistré', () => {
  it('sans consentement de la personne qui parle : publication refusée', async () => {
    await expect(
      chain(
        [RECORDER, `${processed(false)} ${record()} ${move('traduit')}`],
        [VALIDATOR, move('valide')],
        [DG, move('publie')],
      ),
    ).rejects.toThrow('consentement');
  });

  it('celui qui a enregistré ne valide pas sa propre voix, même avec le droit de valider', async () => {
    // Le régional de Labé a tous les droits en pular : il enregistre, puis tente de valider
    await expect(
      as(VALIDATOR, `${processed()} ${record()} ${move('traduit')} ${move('valide')}`),
    ).rejects.toThrow('jamais celui qui a enregistré');
  });

  it('droits par langue : enregistrer, valider, publier', async () => {
    // Le préfectoral de Labé n'enregistre pas en malinké, ne valide pas le pular
    await expect(
      as(RECORDER, `${processed()} ${record('PL-002', 'plante', 'mal')}`),
    ).rejects.toThrow('réservé au référent de la langue');
    await expect(
      chain(
        [VALIDATOR, `${processed()} ${record()}`],
        [RECORDER, `${move('traduit')} ${move('valide')}`],
      ),
    ).rejects.toThrow('Droit de valider en pul absent');
    // Le valideur ne publie pas : réservé à la DG
    await expect(
      chain(
        [RECORDER, `${processed()} ${record()} ${move('traduit')}`],
        [VALIDATOR, `${move('valide')} ${move('publie')}`],
      ),
    ).rejects.toThrow('réservée à la Direction Générale');
  });

  it('aucune écriture directe dans les tables de voix', async () => {
    await expect(as(DG, `UPDATE plante_voix SET statut = 'publie';`)).rejects.toThrow(
      'permission denied',
    );
  });
});
