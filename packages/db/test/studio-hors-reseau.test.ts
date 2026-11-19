// US-080 : le Studio mobile fonctionne sans réseau ; synchronisation au retour du réseau avec la
// règle de conflit R-DON-04 (validée le 3 novembre 2026). Praticien d'essai : Mamadou Diallo
// (PR-1042). Chaque cas part du même état (transaction annulée).
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const PRACTITIONER = 'm.diallo@exemple.gn';
const SECTIONS = ['preparation', 'consommation', 'cycle', 'effets_indesirables'];

const fields = (titreFr: string, extra: Record<string, unknown> = {}) => ({
  maladie: 'MA-001',
  titreFr,
  cycleDureeJours: 5,
  cyclePrisesParJour: 1,
  plantes: [{ plante: 'PL-003', partie: 'gousses' }],
  sections: SECTIONS.map((type) => ({ type, texteFr: `${titreFr} : ${type}` })),
  consentement: true,
  visibilite: 'publique',
  ...extra,
});
const json = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
let keys = 0;
const key = () => `'00000000-0000-4000-9000-${String(++keys).padStart(12, '0')}'::uuid`;
const CODE = `(SELECT code FROM recette WHERE titre_fr LIKE 'Hors réseau%' ORDER BY id DESC LIMIT 1)`;
const sync = (titre: string, cle = key(), code = 'NULL', vue = 'NULL') =>
  `SELECT traitement_synchroniser(${cle}, ${code}, ${vue}, ${json(fields(titre))}) AS r;`;
const created = `${openContext(PRACTITIONER)} ${sync('Hors réseau 1')}`;
// Date de modification lue par le téléphone avant de partir hors réseau
const READ = `(SELECT updated_at FROM recette WHERE code = ${CODE})`;
const run = (sql: string) => lastRows(db.url.app, sql);

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : saisie hors réseau rejouée au retour du réseau', () => {
  it('un brouillon créé hors réseau arrive au serveur', async () => {
    const rows = await run(`${created}
      SELECT titre_fr AS titre, statut FROM recette WHERE code = ${CODE};`);
    expect(rows).toEqual([{ titre: 'Hors réseau 1', statut: 'brouillon' }]);
  });

  it('rejoué avec la même clé (réponse perdue) : même traitement, aucun doublon', async () => {
    const cle = key();
    const rows = await run(`${openContext(PRACTITIONER)} ${sync('Hors réseau 2', cle)}
      ${sync('Hors réseau 2', cle)}
      SELECT r->>'rejoue' AS rejoue,
             (SELECT count(*)::int FROM recette WHERE titre_fr = 'Hors réseau 2') AS traitements
        FROM (SELECT traitement_synchroniser(${cle}, NULL, NULL, ${json(fields('Hors réseau 2'))}) AS r) x;`);
    expect(rows).toEqual([{ rejoue: 'true', traitements: 1 }]);
  });

  it('modification sans conflit (personne n’a touché au brouillon) : appliquée, sans copie', async () => {
    const rows = await run(`${created}
      SELECT traitement_synchroniser(${key()}, ${CODE}, ${READ}, ${json(fields('Hors réseau 1 bis'))})->>'conflit' AS conflit,
             (SELECT count(*)::int FROM recette_version_ecartee) AS copies;`);
    expect(rows).toEqual([{ conflit: null, copies: 0 }]);
  });

  it('soumission rejouée : déjà soumis = succès, sans seconde transition', async () => {
    const rows = await run(`${created}
      SELECT traitement_soumettre_synchro(${CODE});
      SELECT traitement_soumettre_synchro(${CODE}) AS statut,
             (SELECT count(*)::int FROM recette_historique h JOIN recette r ON r.id = h.recette_id
               WHERE r.code = ${CODE}) AS transitions;`);
    expect(rows).toEqual([{ statut: 'soumise', transitions: 1 }]);
  });
});

describe('Règle R-DON-04 : conflit sur le traitement entier', () => {
  it('cas 3 : deux brouillons, le dernier arrivé l’emporte ; l’autre est gardé', async () => {
    // Le téléphone A lit, le téléphone B enregistre entre-temps, puis A arrive
    const rows = await run(`${created}
      CREATE TEMP TABLE lu AS SELECT updated_at - interval '1 second' AS updated_at FROM recette WHERE code = ${CODE};
      SELECT traitement_synchroniser(${key()}, ${CODE}, ${READ}, ${json(fields('Hors réseau B'))});
      CREATE TEMP TABLE res AS
        SELECT traitement_synchroniser(${key()}, ${CODE}, (SELECT updated_at FROM lu),
                                       ${json(fields('Hors réseau A'))})->>'conflit' AS conflit;
      SELECT (SELECT conflit FROM res) AS conflit,
             (SELECT titre_fr FROM recette WHERE code = ${CODE}) AS retenu,
             (SELECT contenu->>'titreFr' FROM recette_version_ecartee) AS garde,
             (SELECT raison FROM recette_version_ecartee) AS raison;`);
    expect(rows).toEqual([
      {
        conflit: 'remplacee',
        retenu: 'Hors réseau A',
        garde: 'Hors réseau B',
        raison: 'remplacee',
      },
    ]);
  });

  it('cas 2 : version du serveur validée (soumise) : elle prime, la saisie devient une copie', async () => {
    const rows = await run(`${created}
      CREATE TEMP TABLE lu AS SELECT updated_at - interval '1 second' AS updated_at FROM recette WHERE code = ${CODE};
      SELECT traitement_soumettre(${CODE});
      CREATE TEMP TABLE res AS
        SELECT traitement_synchroniser(${key()}, ${CODE}, (SELECT updated_at FROM lu),
                                       ${json(fields('Hors réseau tardif'))})->>'conflit' AS conflit;
      SELECT (SELECT conflit FROM res) AS conflit,
             (SELECT titre_fr || ' / ' || statut FROM recette WHERE code = ${CODE}) AS serveur,
             (SELECT contenu->>'titreFr' FROM recette_version_ecartee) AS copie;`);
    expect(rows).toEqual([
      {
        conflit: 'version_validee',
        serveur: 'Hors réseau 1 / soumise',
        copie: 'Hors réseau tardif',
      },
    ]);
  });

  it('cas 4 : le praticien voit les versions écartées à la synchronisation suivante', async () => {
    const rows = await run(`${created}
      SELECT traitement_soumettre(${CODE});
      SELECT traitement_synchroniser(${key()}, ${CODE}, now(), ${json(fields('Hors réseau copie'))});
      SELECT raison, titre FROM traitement_versions_ecartees(${CODE});`);
    expect(rows).toEqual([{ raison: 'version_validee', titre: 'Hors réseau copie' }]);
  });

  it('jamais l’heure du téléphone : seule l’arrivée au serveur compte', async () => {
    // Une date « lue » dans le futur (horloge du téléphone en avance) ne donne aucun droit
    const rows = await run(`${created}
      SELECT traitement_synchroniser(${key()}, ${CODE}, now() + interval '1 day',
                                     ${json(fields('Hors réseau horloge'))})->>'conflit' AS conflit;`);
    expect(rows).toEqual([{ conflit: 'remplacee' }]);
  });
});

describe('Cloisonnement', () => {
  it('un autre compte ne rejoue pas la clé d’un praticien ; les administrateurs ne synchronisent pas', async () => {
    const cle = key();
    await expect(
      run(`${openContext(PRACTITIONER)} ${sync('Hors réseau 3', cle)}
           ${openContext('prefectoral.labe@sabou-sante.gn')} ${sync('Hors réseau 3', cle)}`),
    ).rejects.toThrow(/réservé aux praticiens/);
  });
});
