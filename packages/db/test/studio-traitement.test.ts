// US-060 : créer un traitement depuis le Studio web (UC-21, R-REC-01 à 04, R-REC-08, R-REC-10).
// Jeu d'exemple : Sékou Kourouma (PR-1041, pas encore certifié, dossier DS-1041 en cours, Labé) ;
// Mamadou Diallo (PR-1042, certifié, Labé). Chaque cas part du même état (transaction annulée).
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const PENDING = 's.kourouma@exemple.gn';
const CERTIFIED = 'm.diallo@exemple.gn';
const as = (email: string, sql: string) => lastRows(db.url.app, `${openContext(email)} ${sql}`);
// Préparation par le propriétaire des tables, puis requête dans le contexte du compte
const after = (setup: string, email: string, sql: string) =>
  lastRows(db.url.postgres, `${setup} SET LOCAL ROLE sabou_app; ${openContext(email)} ${sql}`);
const json = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;

const SECTIONS = [
  {
    type: 'preparation',
    texteFr: 'Faire bouillir l’écorce vingt minutes.',
    texteEn: 'Boil the bark.',
  },
  { type: 'consommation', texteFr: 'Un verre matin et soir.' },
  { type: 'cycle', texteFr: 'Sept jours, pause de deux jours.' },
  { type: 'effets_indesirables', texteFr: 'Goût amer ; déconseillé pendant la grossesse.' },
];
const COMPLETE = {
  maladie: 'MA-001',
  titreFr: 'Décoction d’essai',
  titreEn: null,
  cycleDureeJours: 7,
  cyclePrisesParJour: 2,
  cyclePauseJours: 2,
  plantes: [
    { plante: 'PL-002', partie: 'feuilles' },
    { plante: 'PL-001', partie: 'écorce' },
  ],
  sections: SECTIONS,
  consentement: true,
  visibilite: 'restreinte',
};
const save = (data: object, code = 'NULL', seen = 'NULL') =>
  `SELECT traitement_enregistrer(${code}, ${seen}, ${json(data)}) AS code;`;
const created = `(SELECT max(code) FROM recette WHERE titre_fr = 'Décoction d’essai')`;
const seenOf = (code: string) => `(SELECT updated_at FROM recette WHERE code = ${code})`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : maladie, 1 à n plantes ordonnées avec partie utilisée, cycle', () => {
  it('le praticien crée un brouillon ; plantes dans l’ordre donné, cycle enregistré, tracé', async () => {
    const rows = await as(
      PENDING,
      `${save(COMPLETE)}
       SELECT r.code, r.statut, m.code AS maladie, r.cycle_duree_jours AS duree,
              r.cycle_prises_par_jour AS prises, r.cycle_pause_jours AS pause,
              (SELECT string_agg(pl.code || ':' || rp.partie_utilisee, ',' ORDER BY rp.ordre)
                 FROM recette_plante rp JOIN plante pl ON pl.id = rp.plante_id
                WHERE rp.recette_id = r.id) AS plantes,
              (SELECT action FROM journal_audit WHERE objet_id = r.code) AS audit
         FROM recette r JOIN maladie m ON m.id = r.maladie_id WHERE r.code = ${created};`,
    );
    expect(rows).toEqual([
      {
        code: expect.stringMatching(/^REC-\d{4,}$/),
        statut: 'brouillon',
        maladie: 'MA-001',
        duree: 7,
        prises: 2,
        pause: 2,
        plantes: 'PL-002:feuilles,PL-001:écorce',
        audit: 'recette.creee',
      },
    ]);
  });

  it('maladie ou plante inconnue, plante en double, plus de 15 plantes : refusé', async () => {
    await expect(as(PENDING, save({ ...COMPLETE, maladie: 'MA-999' }))).rejects.toThrow(
      'Maladie MA-999 introuvable',
    );
    await expect(
      as(PENDING, save({ ...COMPLETE, plantes: [{ plante: 'PL-999' }] })),
    ).rejects.toThrow('Plante PL-999 introuvable');
    await expect(
      as(PENDING, save({ ...COMPLETE, plantes: [{ plante: 'PL-001' }, { plante: 'PL-001' }] })),
    ).rejects.toThrow('Une plante figure deux fois');
    const many = Array.from({ length: 16 }, () => ({ plante: 'PL-001' }));
    await expect(as(PENDING, save({ ...COMPLETE, plantes: many }))).rejects.toThrow('15 au plus');
  });

  it('cycle hors bornes refusé', async () => {
    await expect(as(PENDING, save({ ...COMPLETE, cycleDureeJours: 0 }))).rejects.toThrow();
    await expect(as(PENDING, save({ ...COMPLETE, cyclePrisesParJour: 11 }))).rejects.toThrow(
      'ck_recette_cycle_bornes',
    );
  });
});

describe('Critère : 4 sections obligatoires + conservation facultative, français (anglais facultatif)', () => {
  it('soumission refusée tant qu’une section obligatoire manque ; conservation facultative', async () => {
    const partial = { ...COMPLETE, sections: SECTIONS.slice(0, 3) };
    await expect(
      as(PENDING, `${save(partial)} SELECT traitement_soumettre(${created});`),
    ).rejects.toThrow(/incomplet : sections/);
    const rows = await as(
      PENDING,
      `${save(COMPLETE)} SELECT traitement_soumettre(${created}) AS statut;`,
    );
    expect(rows).toEqual([{ statut: 'soumise' }]);
  });

  it('texte français et anglais enregistrés ; section vide ignorée ; section inconnue refusée', async () => {
    const rows = await as(
      PENDING,
      `${save({ ...COMPLETE, sections: [...SECTIONS, { type: 'conservation', texteFr: '  ' }] })}
       SELECT s.type_code AS type, s.texte_en AS en FROM recette_section s
         JOIN recette r ON r.id = s.recette_id JOIN section_type t ON t.code = s.type_code
        WHERE r.code = ${created} ORDER BY t.ordre;`,
    );
    expect(rows.map((r) => r.type)).toEqual([
      'preparation',
      'consommation',
      'cycle',
      'effets_indesirables',
    ]);
    expect(rows[0]!.en).toBe('Boil the bark.');
    await expect(
      as(PENDING, save({ ...COMPLETE, sections: [{ type: 'posologie', texteFr: 'x' }] })),
    ).rejects.toThrow('Section posologie inconnue');
  });

  it('soumission refusée sans plante ni cycle', async () => {
    await expect(
      as(
        PENDING,
        `${save({ ...COMPLETE, plantes: [], cycleDureeJours: null })}
         SELECT traitement_soumettre(${created});`,
      ),
    ).rejects.toThrow(/incomplet : plante, cycle/);
  });
});

describe('Critère : consentement et niveau de visibilité obligatoires avant soumission', () => {
  it('sans consentement : soumission refusée', async () => {
    await expect(
      as(
        PENDING,
        `${save({ ...COMPLETE, consentement: false })} SELECT traitement_soumettre(${created});`,
      ),
    ).rejects.toThrow(/incomplet : consentement/);
  });

  it('consentement sans niveau de visibilité : refusé ; avec : date et niveau enregistrés', async () => {
    await expect(as(PENDING, save({ ...COMPLETE, visibilite: null }))).rejects.toThrow(
      'Niveau de visibilité à choisir',
    );
    const rows = await as(
      PENDING,
      `${save(COMPLETE)} SELECT visibilite, consentement_le IS NOT NULL AS consenti
                          FROM recette WHERE code = ${created};`,
    );
    expect(rows).toEqual([{ visibilite: 'restreinte', consenti: true }]);
  });

  it('la soumission directe (sans le Studio) est soumise au même contrôle', async () => {
    await expect(
      lastRows(db.url.migrator, `UPDATE recette SET statut = 'soumise' WHERE code = 'REC-2045';`),
    ).rejects.toThrow(/REC-2045 incomplet : consentement, sections/);
  });
});

describe('Rattachement au dossier (R-REC-08, décision du 16 novembre 2026)', () => {
  it('praticien pas encore certifié : joint à son dossier en cours, historisé, SMS', async () => {
    const rows = await as(
      PENDING,
      `${save(COMPLETE)} SELECT traitement_soumettre(${created});
       SELECT d.code AS dossier, h.statut_depart || '>' || h.statut_arrivee AS historique,
              n.modele AS sms
         FROM recette r JOIN dossier_certification d ON d.id = r.dossier_id
         JOIN recette_historique h ON h.recette_id = r.id
         JOIN notification n ON n.objet_id = r.code
        WHERE r.code = ${created};`,
    );
    expect(rows).toEqual([
      { dossier: 'DS-1041', historique: 'brouillon>soumise', sms: 'recette.soumise' },
    ]);
  });

  it('praticien certifié : aucun dossier joint ; sans dossier en cours ni certificat : refusé', async () => {
    const rows = await as(
      CERTIFIED,
      `${save(COMPLETE)} SELECT traitement_soumettre(${created});
       SELECT dossier_id, statut FROM recette WHERE code = ${created};`,
    );
    expect(rows).toEqual([{ dossier_id: null, statut: 'soumise' }]);
    await expect(
      after(
        `UPDATE dossier_certification SET statut = 'abandonne', cloture_le = now() WHERE code = 'DS-1041';`,
        PENDING,
        `${save(COMPLETE)} SELECT traitement_soumettre(${created});`,
      ),
    ).rejects.toThrow(/dossier de certification à ouvrir/);
  });
});

describe('Le praticien ne touche qu’à ses brouillons ; cloisonnement des traitements', () => {
  it('un traitement soumis ne se modifie plus ; une version périmée est refusée', async () => {
    await expect(
      as(
        PENDING,
        `${save(COMPLETE)} SELECT traitement_soumettre(${created});
         ${save(COMPLETE, created, seenOf(created))}`,
      ),
    ).rejects.toThrow(/seul un brouillon se modifie/);
    await expect(
      as(PENDING, `${save(COMPLETE)} ${save(COMPLETE, created, "'2020-01-01'")}`),
    ).rejects.toThrow(/modifié entre-temps/);
  });

  it('le traitement d’un autre praticien est introuvable', async () => {
    await expect(as(CERTIFIED, save(COMPLETE, "'REC-2041'", seenOf("'REC-2041'")))).rejects.toThrow(
      'Traitement REC-2041 introuvable',
    );
  });

  it('le praticien ne change pas lui-même le statut de son traitement', async () => {
    await expect(
      as(
        PENDING,
        `${save(COMPLETE)} UPDATE recette SET statut = 'soumise' WHERE code = ${created};`,
      ),
    ).rejects.toThrow('Un praticien modifie ses traitements par le Studio');
    await expect(
      as(PENDING, `INSERT INTO recette_plante (recette_id, plante_id) VALUES (5, 1);`),
    ).rejects.toThrow(/permission denied/);
  });

  it('le Studio est réservé aux praticiens', async () => {
    await expect(as('comite@sabou-sante.gn', save(COMPLETE))).rejects.toThrow(
      'Le Studio est réservé aux praticiens',
    );
  });

  it('chacun voit ses traitements ; régional : sa zone ; citoyen : les certifiés publics et restreints', async () => {
    const codes = (email: string) =>
      as(email, `SELECT string_agg(code, ',' ORDER BY code) AS codes FROM recette;`);
    // Le brouillon du praticien : visible de lui et de sa zone (Labé), pas d'un autre praticien
    const draft = await as(
      PENDING,
      `${save(COMPLETE)} SELECT string_agg(code, ',' ORDER BY code) AS codes FROM recette
                          WHERE statut = 'brouillon';`,
    );
    expect(draft[0]!.codes).toMatch(/^REC-\d{4,}$/);
    expect(await codes(CERTIFIED)).toEqual([{ codes: 'REC-2041,REC-2042,REC-2044' }]);
    // REC-2043 (transmis, Mamou) visible du Comité national, pas du régional de Labé
    expect((await codes('comite@sabou-sante.gn'))[0]!.codes).toContain('REC-2043');
    expect((await codes('regional.labe@sabou-sante.gn'))[0]!.codes).not.toContain('REC-2043');
    expect(await codes('aminata@exemple.gn')).toEqual([{ codes: 'REC-2041,REC-2042,REC-2044' }]);
    const anonymous = await lastRows(
      db.url.app,
      `SELECT string_agg(code, ',' ORDER BY code) AS codes FROM recette;`,
    );
    expect(anonymous).toEqual([{ codes: 'REC-2041,REC-2042' }]);
  });
});

describe('Critère : raison de l’attente lue sur le traitement (US-046)', () => {
  it('le praticien lit la raison enregistrée sur son traitement resté « expertisé »', async () => {
    const rows = await after(
      `UPDATE recette SET statut = 'expertisee', praticien_id = 1 WHERE code = 'REC-2045';
       UPDATE recette SET attente_raison = 'quota' WHERE code = 'REC-2045';`,
      PENDING,
      `SELECT code, statut, attente_raison FROM recette WHERE code = 'REC-2045';`,
    );
    expect(rows).toEqual([{ code: 'REC-2045', statut: 'expertisee', attente_raison: 'quota' }]);
  });
});
