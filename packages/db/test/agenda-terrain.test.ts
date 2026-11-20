// US-083 : agenda des visites de l'agent préfectoral et compte rendu attesté sans réseau
// (UC-30 ; décisions du maître d'œuvre du 19 novembre 2026, 05 §2.87).
// Exécuté sous le rôle de l'API (sabou_app) ; chaque cas part du même état (transaction annulée).
// Critère : agenda des visites, itinéraire (ordre de la tournée par jour puis localité), compte
// rendu signé depuis le téléphone (heure déclarée gardée à côté de l'heure de réception).
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const LABE = 'prefectoral.labe@sabou-sante.gn';
const KANKAN = 'prefectoral.kankan@sabou-sante.gn';
const REGIONAL = 'regional.labe@sabou-sante.gn';
const HASH = `'${'d'.repeat(64)}'`;
const run = (sql: string) => lastRows(db.url.app, sql);

// DS-1041 (Labé) soumis : il passe à l'étape 2 ; sa visite du jeu d'exemple (n° 2) est
// planifiée dans 3 jours
const submitted = `${openContext('s.kourouma@exemple.gn')}
  SELECT dossier_transition(1, 'soumis', contexte_utilisateur());`;
const agenda = (email: string) => `${openContext(email)}
  SELECT categorie, dossier, visite, praticien, sous_prefecture, prefecture,
         prevue_le ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$' AS heure_ok, entree_le IS NOT NULL AS entree
    FROM visites_agenda();`;
const realize = (attested: string) => `${openContext(LABE)}
  SELECT visite_realiser(1, contexte_utilisateur(), 2, current_date, 'Lieu conforme.',
                         'favorable', ${HASH}, ${attested}) AS visite;`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Agenda des visites de l’agent', () => {
  it('visite planifiée d’un dossier à l’étape 2 de sa préfecture, avec la localité', async () => {
    const rows = await run(`${submitted} ${agenda(LABE)}`);
    expect(rows).toEqual([
      expect.objectContaining({
        categorie: 'planifiee',
        dossier: 'DS-1041',
        visite: 2,
        praticien: expect.any(String),
        prefecture: 'Labé',
        heure_ok: true,
        entree: true,
      }),
    ]);
  });

  it('dossier hors de l’étape 2 : absent de l’agenda, même avec une visite prévue', async () => {
    expect(await run(agenda(LABE))).toEqual([]);
  });

  it('dossier à l’étape 2 sans visite : « à planifier »', async () => {
    const rows = await lastRows(
      db.url.postgres,
      `SET LOCAL search_path = sabou, public;
       DELETE FROM visite_terrain WHERE id = 2;
       SET LOCAL ROLE sabou_app; ${submitted} ${agenda(LABE)}`,
    );
    expect(rows).toEqual([
      expect.objectContaining({ categorie: 'a_planifier', dossier: 'DS-1041', visite: null }),
    ]);
  });

  it('itinéraire : un même jour, par localité, puis par heure', async () => {
    // Second dossier de Labé (PR-1042), à l'étape 2, visité le même jour l'après-midi dans
    // la première localité par ordre alphabétique ; DS-1041 le matin dans la seconde. Écrit
    // par le super-utilisateur, déclencheurs suspendus, puis lu par le rôle de l'API.
    const rows = await lastRows(
      db.url.postgres,
      `SET LOCAL search_path = sabou, public;
       SET LOCAL ROLE sabou_app; ${submitted} RESET ROLE;
       SET LOCAL session_replication_role = replica;
       UPDATE praticien SET sous_prefecture_id =
         (SELECT id FROM sous_prefecture WHERE prefecture_id = 4 ORDER BY nom OFFSET 1 LIMIT 1) WHERE id = 1;
       UPDATE praticien SET sous_prefecture_id =
         (SELECT id FROM sous_prefecture WHERE prefecture_id = 4 ORDER BY nom LIMIT 1) WHERE id = 2;
       UPDATE visite_terrain SET prevue_le = (current_date + 3 + time '08:00') AT TIME ZONE 'Africa/Conakry'
        WHERE id = 2;
       INSERT INTO dossier_certification (code, praticien_id, type, etape_courante, etape_entree_le,
                                          statut, ouvert_le)
       VALUES ('DS-9083', 2, 'initial', 2, now() - interval '2 days', 'en_cours', now() - interval '3 days');
       INSERT INTO visite_terrain (dossier_id, admin_id, prevue_le, statut)
       VALUES ((SELECT id FROM dossier_certification WHERE code = 'DS-9083'), 3,
               (current_date + 3 + time '15:00') AT TIME ZONE 'Africa/Conakry', 'planifiee');
       SET LOCAL session_replication_role = origin;
       SET LOCAL ROLE sabou_app; ${agenda(LABE)}`,
    );
    expect(rows.map((r) => r.dossier)).toEqual(['DS-9083', 'DS-1041']);
  });

  it('autre préfecture, régional : rien', async () => {
    expect(await run(`${submitted} ${agenda(KANKAN)}`)).toEqual([]);
    expect(await run(`${submitted} ${agenda(REGIONAL)}`)).toEqual([]);
  });
});

describe('Compte rendu attesté sans réseau', () => {
  it('heure déclarée par le téléphone gardée à côté de l’heure de réception, et tracée', async () => {
    const rows = await run(`${submitted} ${realize(`now() - interval '2 hours'`)}
      SELECT signe_le - atteste_le_declare = interval '2 hours' AS ecart,
             (SELECT details ? 'atteste_le_declare' FROM journal_audit
               WHERE action = 'visite.realisee' ORDER BY id DESC LIMIT 1) AS trace
        FROM visite_terrain WHERE id = 2;`);
    expect(rows).toEqual([{ ecart: true, trace: true }]);
  });

  it('sans heure déclarée (gestion) : inchangé', async () => {
    const rows = await run(`${submitted} ${realize('NULL')}
      SELECT atteste_le_declare FROM visite_terrain WHERE id = 2;`);
    expect(rows).toEqual([{ atteste_le_declare: null }]);
  });

  it('heure du téléphone en avance sur la réception : refusée', async () => {
    await expect(run(`${submitted} ${realize(`now() + interval '1 hour'`)}`)).rejects.toThrow(
      /postérieure à la réception/,
    );
  });

  it('dix minutes d’écart d’horloge tolérées', async () => {
    const rows = await run(`${submitted} ${realize(`now() + interval '5 minutes'`)}
      SELECT atteste_le_declare IS NOT NULL AS gardee FROM visite_terrain WHERE id = 2;`);
    expect(rows).toEqual([{ gardee: true }]);
  });

  it('l’heure déclarée est figée avec le compte rendu', async () => {
    await expect(
      run(`${submitted} ${realize(`now() - interval '1 hour'`)}
        UPDATE visite_terrain SET atteste_le_declare = now() WHERE id = 2;`),
    ).rejects.toThrow(/compte rendu figé/);
  });
});
