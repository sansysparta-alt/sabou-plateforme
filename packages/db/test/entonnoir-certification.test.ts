// US-048 : l'entonnoir des 6 étapes et les dossiers bloqués (UC-67, R-CER-07). Jeu d'exemple :
// DS-1041 en cours à l'étape 1 (Labé), DS-1042 passé par les 6 étapes, DS-1043 soumis. Les
// cas qui déplacent un dossier s'exécutent avec le propriétaire des tables (préparation
// directe en base) ; le cloisonnement, sous le rôle de l'API dans le contexte de chaque
// acteur. Chaque cas part du même état (transaction annulée).
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createSeededDatabase,
  lastRows as rowsAt,
  openContext,
  type TestDatabase,
} from './helpers.ts';

let db: TestDatabase;
const asOwner = (sql: string) => rowsAt(db.url.migrator, `SET LOCAL search_path = sabou; ${sql}`);
const asActor = (email: string, sql: string) => rowsAt(db.url.app, `${openContext(email)} ${sql}`);

const funnel = (at = 'now()') =>
  `SELECT etape, en_cours, bloques, passages, delai_moyen_jours::float AS delai
     FROM certification_entonnoir(${at});`;
// DS-1041 placé à l'étape 3, entré dans l'étape il y a n jours
const atStep3For = (days: number) =>
  `UPDATE dossier_certification SET etape_courante = 3,
          etape_entree_le = now() - interval '${days} days' WHERE id = 1;`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : nombre par étape, délai moyen par étape, dossiers bloqués', () => {
  it('donne les 6 étapes, avec les dossiers en cours et le délai moyen des passages', async () => {
    const rows = await asActor('dg@sabou-sante.gn', funnel());
    // Délais du jeu d'exemple : étape 2, DS-1042 6 jours et DS-1041 4 jours (renvoyé) ; étape
    // 3, 6 jours ; étape 4, 7 jours ; étape 5, 6 jours ; publication immédiate
    expect(rows).toEqual([
      { etape: 1, en_cours: 1, bloques: 0, passages: 3, delai: 0 },
      { etape: 2, en_cours: 0, bloques: 0, passages: 2, delai: 5 },
      { etape: 3, en_cours: 0, bloques: 0, passages: 1, delai: 6 },
      { etape: 4, en_cours: 0, bloques: 0, passages: 1, delai: 7 },
      { etape: 5, en_cours: 0, bloques: 0, passages: 1, delai: 6 },
      { etape: 6, en_cours: 0, bloques: 0, passages: 1, delai: 0 },
    ]);
  });

  it('le délai moyen ne retient que les 12 derniers mois', async () => {
    const rows = await asActor('dg@sabou-sante.gn', funnel(`now() + interval '13 months'`));
    expect(rows.map((r) => [r['passages'], r['delai']])).toEqual(Array(6).fill([0, null]));
    // Il y a 61 jours, aucune décision n'était encore prise
    const before = await asActor('dg@sabou-sante.gn', funnel(`now() - interval '61 days'`));
    expect(before.every((r) => r['passages'] === 0)).toBe(true);
  });

  it('un dossier sans décision depuis plus de 15 jours est bloqué, avec son praticien et sa zone', async () => {
    const rows = await asOwner(`${atStep3For(16)}
      SELECT row_to_json(b)::jsonb - 'depuis' AS b,
             (SELECT bloques FROM certification_entonnoir() WHERE etape = 3) AS compte
        FROM certification_dossiers_bloques() b;`);
    expect(rows).toEqual([
      {
        b: {
          dossier: 'DS-1041',
          praticien: 'PR-1041',
          nom: expect.any(String) as string,
          etape: 3,
          prefecture: 'Labé',
          region: expect.any(String) as string,
          jours: 16,
        },
        compte: 1,
      },
    ]);
  });

  it('15 jours tout juste ne suffisent pas ; à l’étape 1, le dossier attend le praticien', async () => {
    const fresh = await asOwner(`${atStep3For(14)}
      SELECT count(*)::int AS bloques FROM certification_dossiers_bloques();`);
    expect(fresh).toEqual([{ bloques: 0 }]);
    const draft = await asOwner(`
      UPDATE dossier_certification SET etape_entree_le = now() - interval '40 days' WHERE id = 1;
      SELECT (SELECT count(*)::int FROM certification_dossiers_bloques()) AS bloques,
             (SELECT en_cours FROM certification_entonnoir() WHERE etape = 1) AS etape1;`);
    expect(draft).toEqual([{ bloques: 0, etape1: 1 }]);
  });

  it('les dossiers bloqués sont triés du plus ancien au plus récent', async () => {
    const rows = await asOwner(`${atStep3For(20)}
      UPDATE dossier_certification SET statut = 'en_cours', cloture_le = NULL, etape_courante = 4,
             etape_entree_le = now() - interval '30 days' WHERE id = 3;
      SELECT string_agg(dossier || ':' || jours, ',') AS ordre FROM certification_dossiers_bloques();`);
    expect(rows).toEqual([{ ordre: 'DS-1043:30,DS-1041:20' }]);
  });
});

describe('Cloisonnement par zone', () => {
  it('chaque acteur ne compte que les dossiers de sa zone', async () => {
    const enCours = (email: string) =>
      asActor(email, `SELECT sum(en_cours)::int AS n FROM certification_entonnoir();`);
    expect(await enCours('dg@sabou-sante.gn')).toEqual([{ n: 1 }]);
    expect(await enCours('prefectoral.labe@sabou-sante.gn')).toEqual([{ n: 1 }]);
    expect(await enCours('prefectoral.kankan@sabou-sante.gn')).toEqual([{ n: 0 }]);
  });

  it('les fonctions ne sont pas ouvertes à tous', async () => {
    const rows = await rowsAt(
      db.url.postgres,
      `SELECT has_function_privilege('public', 'sabou.certification_entonnoir(timestamptz)', 'EXECUTE') AS a,
              has_function_privilege('public', 'sabou.certification_dossiers_bloques(timestamptz)', 'EXECUTE') AS b;`,
    );
    expect(rows).toEqual([{ a: false, b: false }]);
  });
});
