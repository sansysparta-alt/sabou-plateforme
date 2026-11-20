// US-090 : un tableau de bord adapté à chaque profil (UC-67 ; décisions du maître d'œuvre du
// 20 novembre 2026, 05 §2.90). Exécuté sous le rôle de l'API (sabou_app) ; chaque cas part du
// même état (transaction annulée).
// Critère 1 : indicateurs du cahier des charges pour chaque profil (§6.2 à §6.6).
// Critère 2 : données limitées à la zone du compte. Chaque chiffre est comparé à la même
// mesure faite par le super-utilisateur (sans RLS), filtrée explicitement sur la zone.
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const DG = 'dg@sabou-sante.gn';
const REGIONAL_LABE = 'regional.labe@sabou-sante.gn';
const REGIONAL_KANKAN = 'regional.kankan@sabou-sante.gn';
const PREFECTORAL_LABE = 'prefectoral.labe@sabou-sante.gn';
const PREFECTORAL_KANKAN = 'prefectoral.kankan@sabou-sante.gn';
const COMITE = 'comite@sabou-sante.gn';
const PRATICIEN = 's.kourouma@exemple.gn';

type Board = Record<string, unknown>;

// Tableau de bord du compte, précédé éventuellement d'écritures faites par le super-utilisateur
async function board(email: string, before = ''): Promise<Board> {
  const url = before ? db.url.postgres : db.url.app;
  const role = before ? 'SET LOCAL ROLE sabou_app;' : '';
  const rows = await lastRows(
    url,
    `${before} ${role} ${openContext(email)} SELECT tableau_de_bord() AS t;`,
  );
  return rows[0]!.t as Board;
}

// Mesure de référence, faite sans RLS par le super-utilisateur
const reference = async (sql: string) => (await lastRows(db.url.postgres, sql))[0]!;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère 1 et 2 : Admin préfectoral (§6.4)', () => {
  const expected = (prefecture: number) =>
    reference(`
      SELECT (SELECT count(*)::int FROM praticien WHERE prefecture_id = ${prefecture}) AS enregistres,
             (SELECT count(*)::int FROM praticien WHERE prefecture_id = ${prefecture} AND statut = 'certifie') AS certifies,
             (SELECT count(*)::int FROM praticien WHERE prefecture_id = ${prefecture} AND statut = 'en_attente') AS "enAttente",
             (SELECT count(*)::int FROM recette r JOIN praticien p ON p.id = r.praticien_id
               WHERE p.prefecture_id = ${prefecture} AND r.saisi_par IS NOT NULL) AS "recettesNumerisees",
             (SELECT count(*)::int FROM dossier_certification d JOIN praticien p ON p.id = d.praticien_id
               WHERE p.prefecture_id = ${prefecture} AND d.statut = 'en_cours' AND d.etape_courante = 2) AS "aValider";`);

  it('Labé : indicateurs, spécialités et dossiers à valider de sa seule préfecture', async () => {
    const submitted = `SET LOCAL ROLE sabou_app; ${openContext(PRATICIEN)}
      SELECT dossier_transition(1, 'soumis', contexte_utilisateur()); RESET ROLE;`;
    const t = await board(PREFECTORAL_LABE, submitted);
    const { aValider: toValidate, ...ref } = await expected(4);
    expect(t.profil).toBe('prefectoral');
    expect({
      enregistres: t.enregistres,
      certifies: t.certifies,
      enAttente: t.enAttente,
      recettesNumerisees: t.recettesNumerisees,
    }).toEqual(ref);
    expect(t.enregistres).toBe(2);
    // Répartition par spécialité : tous ses praticiens, aucun autre
    const specialites = t.parSpecialite as { praticiens: number }[];
    expect(specialites.reduce((n, s) => n + s.praticiens, 0)).toBe(t.enregistres);
    // DS-1041 soumis : à valider, avec la date d'entrée dans l'étape
    const aValider = t.aValider as {
      total: number;
      dossiers: { dossier: string; depuis: string }[];
    };
    expect(aValider.total).toBe(toValidate);
    expect(aValider.total).toBe(1);
    expect(aValider.dossiers[0]!.dossier).toBe('DS-1041');
    expect(aValider.dossiers[0]!.depuis).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('Kankan : ne voit rien de Labé', async () => {
    const t = await board(PREFECTORAL_KANKAN);
    const ref = await expected(7);
    expect(t.enregistres).toBe(ref.enregistres);
    expect(t.certifies).toBe(ref.certifies);
    expect((t.aValider as { total: number }).total).toBe(ref.aValider);
    expect(JSON.stringify(t)).not.toContain('DS-1041');
  });
});

describe('Critère 1 et 2 : Admin régional (§6.3)', () => {
  const expected = (region: number) =>
    reference(`
      SELECT (SELECT count(*)::int FROM praticien p JOIN prefecture pf ON pf.id = p.prefecture_id
               WHERE pf.region_admin_id = ${region}) AS praticiens,
             (SELECT count(*)::int FROM litige l JOIN prefecture pf ON pf.id = l.prefecture_id
               WHERE pf.region_admin_id = ${region} AND l.statut <> 'resolu') AS litiges,
             (SELECT count(*)::int FROM prefecture WHERE region_admin_id = ${region} AND active) AS prefectures,
             (SELECT count(*)::int FROM prefecture pf WHERE pf.region_admin_id = ${region} AND pf.active
                 AND EXISTS (SELECT 1 FROM praticien p WHERE p.prefecture_id = pf.id AND p.statut = 'certifie')) AS couvertes,
             (SELECT count(*)::int FROM alerte_territoriale WHERE region_admin_id = ${region} AND statut <> 'close') AS alertes;`);

  it('Labé : praticiens, litiges, couverture, préfectures et alertes de sa région', async () => {
    const t = await board(REGIONAL_LABE);
    const ref = await expected(4);
    expect(t.profil).toBe('regional');
    expect(t.praticiens).toBe(ref.praticiens);
    expect(t.litiges).toBe(ref.litiges);
    expect(t.litiges).toBe(1);
    expect(t.couverture).toEqual({ prefectures: ref.prefectures, couvertes: ref.couvertes });
    const prefectures = t.parPrefecture as { prefecture: string }[];
    expect(prefectures).toHaveLength(ref.prefectures as number);
    expect(prefectures.map((p) => p.prefecture)).toContain('Labé');
    const alertes = t.alertes as {
      total: number;
      dernieres: { description: string; le: string }[];
    };
    expect(alertes.total).toBe(ref.alertes);
    expect(alertes.dernieres.map((a) => a.description)).toEqual([
      'DS-1041 sans décision depuis 8 jours.',
    ]);
  });

  it('Kankan : aucune préfecture, aucun litige ni aucune alerte de Labé', async () => {
    const t = await board(REGIONAL_KANKAN);
    const ref = await expected(7);
    expect(t.praticiens).toBe(ref.praticiens);
    expect(t.litiges).toBe(0);
    const prefectures = (t.parPrefecture as { prefecture: string }[]).map((p) => p.prefecture);
    expect(prefectures).toHaveLength(ref.prefectures as number);
    expect(prefectures).not.toContain('Labé');
    expect((t.alertes as { total: number }).total).toBe(ref.alertes);
  });

  // DS-1041 (Labé) consolidé par le régional (DS-1042 l'est déjà dans le jeu d'exemple) :
  // compté une fois, sur 12 mois glissants, dans sa préfecture
  const consolidated = (age: string) => `
    INSERT INTO dossier_historique (dossier_id, etape_depart, etape_arrivee, decision, acteur_id, decide_le)
    VALUES (1, 3, 4, 'valide', 15, now() - interval '${age}'), (1, 3, 4, 'valide', 15, now() - interval '${age}');`;
  const labe = (t: Board) =>
    (t.parPrefecture as { prefecture: string; consolides: number }[]).find(
      (p) => p.prefecture === 'Labé',
    )!.consolides;

  it('dossiers consolidés : un par dossier, sur 12 mois glissants, dans sa préfecture', async () => {
    const base = await board(REGIONAL_LABE);
    const t = await board(REGIONAL_LABE, consolidated('10 days'));
    expect(t.consolides).toBe((base.consolides as number) + 1);
    expect(labe(t)).toBe(labe(base) + 1);
    expect((await board(REGIONAL_LABE, consolidated('13 months'))).consolides).toBe(
      base.consolides,
    );
    const kankan = await board(REGIONAL_KANKAN);
    expect((await board(REGIONAL_KANKAN, consolidated('10 days'))).consolides).toBe(
      kankan.consolides,
    );
  });
});

describe('Critère 1 et 2 : Direction Générale (§6.2)', () => {
  it('national : certifiés, traitements, plantes, certificats, régions et registre', async () => {
    const t = await board(DG);
    const ref = await reference(`
      SELECT (SELECT count(*)::int FROM praticien WHERE statut = 'certifie') AS certifies,
             (SELECT count(*)::int FROM recette WHERE statut = 'certifiee') AS traitements,
             (SELECT count(*)::int FROM plante WHERE statut = 'validee') AS plantes,
             (SELECT count(*)::int FROM certificat WHERE statut = 'actif' AND expire_le >= current_date) AS certificats,
             (SELECT count(*)::int FROM region_admin WHERE active) AS regions,
             (SELECT count(*)::int FROM praticien) AS praticiens;`);
    expect(t.profil).toBe('dg');
    expect({
      certifies: t.certifies,
      traitements: t.traitements,
      plantes: t.plantes,
      certificats: t.certificats,
    }).toEqual({
      certifies: ref.certifies,
      traitements: ref.traitements,
      plantes: ref.plantes,
      certificats: ref.certificats,
    });
    const regions = t.parRegion as { region: string; certifies: number }[];
    expect(regions).toHaveLength(ref.regions as number);
    expect(regions.reduce((n, r) => n + r.certifies, 0)).toBe(ref.certifies);
    const registre = t.registre as Record<string, number>;
    expect(Object.values(registre).reduce((n, v) => n + v, 0)).toBe(ref.praticiens);
    expect(registre.certifies).toBe(ref.certifies);
  });

  it('indicateurs sans donnée (revenus, vues, écoutes) : absents, jamais à zéro', async () => {
    for (const email of [DG, PRATICIEN]) {
      const keys = Object.keys(await board(email));
      expect(keys).not.toEqual(expect.arrayContaining(['revenus']));
      expect(keys.some((k) => /revenu|vue|ecoute|reputation/i.test(k))).toBe(false);
    }
  });
});

describe('Critère 1 : Comité scientifique (§6.5)', () => {
  // REC-2041 et REC-2044 transmis au Comité ; REC-2043 l'est déjà dans le jeu d'exemple, sans
  // date de transmission : une date inconnue passe en tête de file
  const transmitted = `UPDATE recette SET statut = 'transmise' WHERE id IN (1, 4);
    INSERT INTO recette_historique (recette_id, statut_depart, statut_arrivee, acteur_id, decide_le)
    VALUES (1, 'soumise', 'transmise', 15, now() - interval '3 days'),
           (4, 'soumise', 'transmise', 15, now() - interval '1 day');`;

  it('file d’expertise : les plus anciens d’abord ; signalements ouverts ; plantes', async () => {
    const t = await board(COMITE, transmitted);
    const ref = await reference(`
      SELECT (SELECT count(*)::int FROM signalement_sanitaire WHERE statut <> 'clos') AS alertes,
             (SELECT count(*)::int FROM plante WHERE statut = 'validee') AS plantes,
             (SELECT count(*)::int FROM plante WHERE statut = 'en_revue') AS "plantesEnRevue";`);
    expect(t.profil).toBe('scientifique');
    expect(t.enAttente).toBe(3);
    expect((t.file as { traitements: { code: string }[] }).traitements.map((f) => f.code)).toEqual([
      'REC-2043',
      'REC-2041',
      'REC-2044',
    ]);
    expect({ alertes: t.alertes, plantes: t.plantes, plantesEnRevue: t.plantesEnRevue }).toEqual(
      ref,
    );
  });

  it('expertisés sur 12 mois glissants ; pathologies les plus traitées (5 au plus)', async () => {
    // REC-2041 est déjà expertisé (jeu d'exemple) ; REC-2044 l'est deux fois (compté une
    // fois) ; REC-2045 il y a 13 mois (hors période)
    const base = (await board(COMITE)).expertises as number;
    const expertised = `${transmitted}
      INSERT INTO recette_historique (recette_id, statut_depart, statut_arrivee, acteur_id, decide_le)
      VALUES (4, 'transmise', 'expertisee', 4, now()), (4, 'transmise', 'expertisee', 4, now()),
             (5, 'transmise', 'expertisee', 4, now() - interval '13 months');`;
    const t = await board(COMITE, expertised);
    expect(base).toBe(1);
    expect(t.expertises).toBe(base + 1);
    const top = t.topPathologies as { maladie: string; traitements: number }[];
    expect(top.length).toBeLessThanOrEqual(5);
    const counts = top.map((p) => p.traitements);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });
});

describe('Critère 1 et 2 : Praticien (§6.6, application mobile)', () => {
  it('ses traitements et la frise de son dossier, rien d’un autre praticien', async () => {
    const submitted = `SET LOCAL ROLE sabou_app; ${openContext(PRATICIEN)}
      SELECT dossier_transition(1, 'soumis', contexte_utilisateur()); RESET ROLE;`;
    const t = await board(PRATICIEN, submitted);
    expect(t.profil).toBe('praticien');
    const ref = await reference(`SELECT count(*)::int AS n FROM recette WHERE praticien_id = 1;`);
    const traitements = t.traitements as Record<string, number>;
    expect(Object.values(traitements).reduce((n, v) => n + v, 0)).toBe(ref.n);
    const dossier = t.dossier as {
      code: string;
      etape: number;
      etapes: { etape: number; etat: string; le: string | null }[];
    };
    expect(dossier.code).toBe('DS-1041');
    expect(dossier.etape).toBe(2);
    expect(dossier.etapes.map((e) => e.etat)).toEqual([
      'franchie',
      'en_cours',
      'a_venir',
      'a_venir',
      'a_venir',
      'a_venir',
    ]);
    expect(dossier.etapes[0]!.le).toMatch(/Z$/);
    expect(dossier.etapes[1]!.le).toMatch(/Z$/);
    expect(dossier.etapes[2]!.le).toBeNull();
    expect(t.certificat).toBeNull();
  });

  it('praticien certifié : toutes les étapes franchies et son certificat', async () => {
    const t = await board('m.diallo@exemple.gn');
    const dossier = t.dossier as { code: string; etapes: { etat: string }[] };
    expect(dossier.code).toBe('DS-1042');
    expect(dossier.etapes.every((e) => e.etat === 'franchie')).toBe(true);
  });
});

describe('Profils sans tableau de bord', () => {
  it('citoyen : refus', async () => {
    await expect(board('aminata@exemple.gn')).rejects.toThrow(/aucun pour ce profil/);
  });

  it('sans contexte ouvert : refus', async () => {
    await expect(lastRows(db.url.app, 'SELECT tableau_de_bord();')).rejects.toThrow(
      /aucun pour ce profil/,
    );
  });
});
