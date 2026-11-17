// US-063 : contre-indications structurées (UC-21, R-REC-05). Liste paramétrable, choix du
// praticien au Studio sur son brouillon. Chaque cas part du même état (transaction annulée).
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const PRACTITIONER = 'm.diallo@exemple.gn';
const FIELDS = JSON.stringify({ maladie: 'MA-001', titreFr: 'Contre-indications d’essai' }).replace(
  /'/g,
  "''",
);
const CODE = `(SELECT code FROM recette WHERE titre_fr = 'Contre-indications d’essai')`;
const draft = `${openContext(PRACTITIONER)}
  SELECT traitement_enregistrer(NULL, NULL, '${FIELDS}'::jsonb);`;
const pose = (codes: string[]) =>
  `SELECT traitement_contre_indications_poser(${CODE}, '${JSON.stringify(codes)}'::jsonb);`;
const chosen = `SELECT string_agg(contre_indication_code, ',' ORDER BY contre_indication_code) AS codes
                  FROM recette_contre_indication WHERE recette_id = (SELECT id FROM recette WHERE code = ${CODE});`;
const run = (sql: string) => lastRows(db.url.app, sql);
// Préparation par le super-utilisateur, puis le praticien dans son contexte
const asOwnerThen = (setup: string, sql: string) =>
  lastRows(db.url.postgres, `${setup} SET LOCAL ROLE sabou_app; ${sql}`);

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : liste paramétrable (grossesse, allaitement, enfant de moins de 5 ans…)', () => {
  it('la liste initiale est posée par migration, active', async () => {
    const rows = await run(
      `SELECT string_agg(code, ',' ORDER BY id) AS codes, bool_and(active) AS actives
         FROM contre_indication;`,
    );
    expect(rows).toEqual([
      {
        codes: 'grossesse,allaitement,enfant_moins_5_ans,personne_agee,maladie_chronique',
        actives: true,
      },
    ]);
  });

  it('une contre-indication ajoutée est aussitôt proposée ; jamais supprimée', async () => {
    const rows = await run(`${openContext('dg@sabou-sante.gn')}
      INSERT INTO contre_indication (code, libelle_fr) VALUES ('insuffisance_renale', 'Insuffisance rénale');
      ${draft} ${pose(['insuffisance_renale'])} ${chosen}`);
    expect(rows).toEqual([{ codes: 'insuffisance_renale' }]);
    await expect(run(`DELETE FROM contre_indication WHERE code = 'grossesse';`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it('libellé en double (casse, accents) ou code mal formé : refusé', async () => {
    await expect(
      run(
        `INSERT INTO contre_indication (code, libelle_fr) VALUES ('grossesse_2', ' GROSSÉSSE ');`,
      ),
    ).rejects.toThrow(/ux_contre_indication_libelle/);
    await expect(
      run(`INSERT INTO contre_indication (code, libelle_fr) VALUES ('Rein!', 'Rein');`),
    ).rejects.toThrow(/ck_contre_indication_code/);
  });
});

describe('Le praticien les indique sur son brouillon', () => {
  it('choix enregistré, puis remplacé ; doublons ignorés', async () => {
    const rows = await run(
      `${draft} ${pose(['grossesse', 'enfant_moins_5_ans'])} ${pose(['allaitement', 'allaitement'])} ${chosen}`,
    );
    expect(rows).toEqual([{ codes: 'allaitement' }]);
  });

  it('contre-indication inconnue : refusée', async () => {
    await expect(run(`${draft} ${pose(['diabete_inconnu'])}`)).rejects.toThrow(
      'Contre-indication diabete_inconnu inconnue',
    );
  });

  it('désactivée : plus proposée, mais gardée par le traitement qui l’a déjà', async () => {
    const rows = await asOwnerThen(
      '',
      `${draft} ${pose(['grossesse'])}
       RESET ROLE; UPDATE sabou.contre_indication SET active = false WHERE code = 'grossesse';
       SET LOCAL ROLE sabou_app;
       ${pose(['grossesse', 'allaitement'])} ${chosen}`,
    );
    expect(rows).toEqual([{ codes: 'allaitement,grossesse' }]);
    await expect(
      asOwnerThen(
        `UPDATE sabou.contre_indication SET active = false WHERE code = 'grossesse';`,
        `${draft} ${pose(['grossesse'])}`,
      ),
    ).rejects.toThrow('Contre-indication grossesse inconnue');
  });

  it('traitement soumis : plus modifiable ; traitement d’un autre praticien : introuvable', async () => {
    await expect(
      run(`${openContext('s.kourouma@exemple.gn')}
        SELECT traitement_contre_indications_poser('REC-2041', '["grossesse"]'::jsonb);`),
    ).rejects.toThrow('Traitement REC-2041 introuvable');
    await expect(
      run(`${openContext('a.traore@exemple.gn')}
        SELECT traitement_contre_indications_poser('REC-2041', '["grossesse"]'::jsonb);`),
    ).rejects.toThrow('seul un brouillon se modifie');
  });

  it('le praticien n’écrit pas directement dans la table', async () => {
    await expect(
      run(`${draft} INSERT INTO recette_contre_indication (recette_id, contre_indication_code)
                    SELECT id, 'grossesse' FROM recette WHERE code = ${CODE};`),
    ).rejects.toThrow(/permission denied/);
  });
});
