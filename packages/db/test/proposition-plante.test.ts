// US-054 : un praticien propose une plante depuis l'application mobile (§6.5, §6.6).
// Critère 1 : la plante est créée « en revue », avec le praticien comme auteur.
// Critère 2 : elle n'entre pas dans un traitement certifié tant que le Comité ne l'a pas
//             validée (US-051) ; le Comité complète d'abord le nom scientifique et la famille.
// Jeu d'exemple : m.diallo@exemple.gn est praticien ; chaque cas part du même état
// (transaction annulée).
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const PRACTITIONER = 'm.diallo@exemple.gn';
const COMMITTEE = 'comite@sabou-sante.gn';
const as = (email: string, sql: string) => lastRows(db.url.app, `${openContext(email)} ${sql}`);
const propose = (nomFr: string, sci = 'NULL', famille = 'NULL', description = 'NULL') =>
  `SELECT * FROM plante_proposer(${nomFr}, ${sci}, ${famille}, ${description})`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère 1 : créée « en revue », le praticien comme auteur', () => {
  it('nom français seul : fiche en revue, auteur, journal', async () => {
    const rows = await as(
      PRACTITIONER,
      `CREATE TEMP TABLE p AS ${propose("'  Kinkéliba rouge '", 'NULL', 'NULL', "'Arbuste des savanes'")};
       SELECT p.statut, p.nom_fr, p.nom_scientifique, p.famille, p.description,
              u.email AS auteur, j.action, j.utilisateur_id = u.id AS journal_de_l_auteur
         FROM p JOIN utilisateur u ON u.id = p.proposee_par
         JOIN journal_audit j ON j.objet_id = p.code AND j.action = 'plante.proposee';`,
    );
    expect(rows).toEqual([
      {
        statut: 'en_revue',
        nom_fr: 'Kinkéliba rouge',
        nom_scientifique: null,
        famille: null,
        description: 'Arbuste des savanes',
        auteur: PRACTITIONER,
        action: 'plante.proposee',
        journal_de_l_auteur: true,
      },
    ]);
  });

  it('nom scientifique déjà pris : refusé, avec la fiche qui le porte', async () => {
    await expect(
      as(PRACTITIONER, `${propose("'Caïlcédrat'", "' khaya senegalensis '", "'Meliaceae'")};`),
    ).rejects.toThrow('Nom scientifique déjà utilisé par la fiche PL-001');
  });

  it('nom français obligatoire', async () => {
    await expect(as(PRACTITIONER, `${propose("'   '")};`)).rejects.toThrow(
      'Nom français obligatoire',
    );
  });

  it('réservée aux praticiens : ni citoyen, ni DG, ni Comité par cette voie', async () => {
    for (const email of ['dg@sabou-sante.gn', COMMITTEE]) {
      await expect(as(email, `${propose("'Plante'")};`)).rejects.toThrow('réservée aux praticiens');
    }
  });

  it('10 propositions en attente au plus par praticien', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => `${propose(`'Plante ${i}'`)};`).join('\n');
    await expect(as(PRACTITIONER, `${ten} ${propose("'Plante 11'")};`)).rejects.toThrow(
      'déjà 10 plantes en attente',
    );
  });

  it('le rôle de l’API ne crée pas de fiche en écrivant la table en direct', async () => {
    await expect(
      as(PRACTITIONER, `INSERT INTO plante (code, nom_fr) VALUES ('PL-999', 'Directe');`),
    ).rejects.toThrow('permission denied');
  });
});

describe('Critère 2 : pas de traitement certifié tant que le Comité n’a pas validé', () => {
  it('le Comité ne valide pas une fiche sans nom scientifique ni famille', async () => {
    await expect(
      lastRows(
        db.url.app,
        `${openContext(PRACTITIONER)}
         CREATE TEMP TABLE p AS ${propose("'Plante proposée'")};
         ${openContext(COMMITTEE)}
         SELECT plante_valider(code, updated_at) FROM p;`,
      ),
    ).rejects.toThrow('complétez le nom scientifique et la famille avant de valider');
  });

  it('une fiche validée a toujours son nom scientifique et sa famille (contrainte)', async () => {
    await expect(
      lastRows(
        db.url.migrator,
        `SET LOCAL search_path = sabou;
         UPDATE plante SET nom_scientifique = NULL WHERE code = 'PL-001';`,
      ),
    ).rejects.toThrow('ck_plante_validee_identifiee');
  });

  it('complétée par le Comité, la fiche proposée est validée et garde son auteur', async () => {
    const rows = await lastRows(
      db.url.app,
      `${openContext(PRACTITIONER)}
       CREATE TEMP TABLE p AS ${propose("'Plante proposée'")};
       ${openContext(COMMITTEE)}
       SELECT plante_modifier(code, updated_at, 'Combretum glutinosum', 'Combretaceae',
                              'Quinquéliba rouge') FROM p;
       SELECT plante_valider(pl.code, pl.updated_at) FROM plante pl JOIN p ON p.code = pl.code;
       SELECT pl.statut, pl.nom_scientifique, u.email AS auteur
         FROM plante pl JOIN p ON p.code = pl.code JOIN utilisateur u ON u.id = pl.proposee_par;`,
    );
    expect(rows).toEqual([
      { statut: 'validee', nom_scientifique: 'Combretum glutinosum', auteur: PRACTITIONER },
    ]);
  });
});
