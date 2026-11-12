// US-031 : file des SMS au praticien. La fonction de workflow met le message en file dans la
// transaction de la décision ; l'API relève la file (notification_sms_prendre) et rend le
// résultat de chaque essai (notification_sms_resultat). Exécuté sous le rôle de l'API
// (sabou_app), sur le jeu d'exemple ; sauf mention, chaque cas part du même état.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createSeededDatabase,
  inRolledBackTransaction,
  lastRows as rowsAt,
  openContext,
  runSql,
  type TestDatabase,
} from './helpers.ts';

let db: TestDatabase;
const attempt = (sql: string) => inRolledBackTransaction(db.url.app, sql);
const lastRows = (sql: string) => rowsAt(db.url.app, sql);

// DS-1041 soumis par son praticien (utilisateur 6, +224620000006 dans le jeu d'exemple)
const submitted = `${openContext('s.kourouma@exemple.gn')}
  SELECT dossier_transition(1, 'soumis', contexte_utilisateur());`;
// Identifiant du message mis en file par la soumission
const queued = `(SELECT max(id) FROM notification WHERE objet_id = 'DS-1041' AND statut = 'en_attente')`;
const result = (erreur: string, definitive = false) =>
  `SELECT notification_sms_resultat(${queued}, ${erreur}, ${definitive}) AS statut;`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère 1 : transition validée, le SMS est mis en file pour partir aussitôt', () => {
  it('écrit un message en attente, avec l’étape d’arrivée, prêt à être relevé', async () => {
    const rows = await lastRows(`${submitted}
      SELECT modele, statut, tentatives, parametres, prochaine_tentative <= now() AS pret
        FROM notification WHERE id = ${queued};`);
    expect(rows).toEqual([
      {
        modele: 'dossier.soumis',
        statut: 'en_attente',
        tentatives: 0,
        parametres: { etape: 2 },
        pret: true,
      },
    ]);
  });

  it('la relève donne le numéro du praticien et le message, puis le réserve (bail)', async () => {
    const rows = await lastRows(`${submitted}
      CREATE TEMP TABLE premiere AS SELECT * FROM notification_sms_prendre(10, interval '2 minutes');
      SELECT (SELECT json_agg(json_build_object('telephone', telephone, 'modele', modele,
                     'objet', objet_id, 'parametres', parametres)) FROM premiere) AS premiere,
             (SELECT count(*)::int FROM notification_sms_prendre(10, interval '2 minutes')) AS seconde;`);
    expect(rows).toEqual([
      {
        premiere: [
          {
            telephone: '+224620000006',
            modele: 'dossier.soumis',
            objet: 'DS-1041',
            parametres: { etape: 2 },
          },
        ],
        seconde: 0,
      },
    ]);
  });

  it('un message déjà envoyé n’est jamais relevé de nouveau', async () => {
    const rows = await lastRows(
      `SELECT count(*)::int AS n FROM notification_sms_prendre(10, interval '0');`,
    );
    expect(rows).toEqual([{ n: 0 }]);
  });

  it('un envoi réussi marque le message envoyé', async () => {
    const rows = await lastRows(`${submitted} ${result('NULL')}
      SELECT statut, tentatives, envoyee_le IS NOT NULL AS horodate
        FROM notification WHERE objet_id = 'DS-1041' ORDER BY id DESC LIMIT 1;`);
    expect(rows).toEqual([{ statut: 'envoyee', tentatives: 1, horodate: true }]);
  });
});

describe('Critère 2 : transition annulée, aucun SMS', () => {
  it('une décision refusée ne laisse aucun message en file', async () => {
    const rows = await lastRows(`${submitted}
      ${openContext('prefectoral.labe@sabou-sante.gn')}
      DO $$ BEGIN
        -- Rejet sans motif : la transition échoue et son sous-ensemble est annulé
        PERFORM dossier_transition(1, 'rejete', contexte_utilisateur(), NULL);
      EXCEPTION WHEN check_violation THEN NULL;
      END $$;
      SELECT modele FROM notification WHERE objet_id = 'DS-1041' AND statut = 'en_attente';`);
    expect(rows).toEqual([{ modele: 'dossier.soumis' }]);
  });

  it('une transaction annulée n’écrit rien dans la file', async () => {
    await attempt(submitted);
    const rows = await lastRows(
      `SELECT count(*)::int AS n FROM notification WHERE statut = 'en_attente';`,
    );
    expect(rows).toEqual([{ n: 0 }]);
  });
});

describe('Critère 3 : 3 nouvelles tentatives, puis l’échec est visible', () => {
  it('reprogramme après 1, 5 puis 15 minutes, puis passe en échec au 4e essai', async () => {
    // now() est fixe dans la transaction : le délai se lit exactement
    const step = `INSERT INTO essais (statut)
      SELECT notification_sms_resultat(${queued}, 'HTTP 503', false);
      UPDATE essais SET delai = (SELECT (prochaine_tentative - now())::text FROM notification
                                  WHERE objet_id = 'DS-1041' ORDER BY id DESC LIMIT 1)
       WHERE delai IS NULL;`;
    const rows = await lastRows(`${submitted}
      CREATE TEMP TABLE essais (n serial, statut text, delai text);
      ${step} ${step} ${step} ${step}
      SELECT statut, delai FROM essais ORDER BY n;`);
    expect(rows.map((r) => r.statut)).toEqual(['en_attente', 'en_attente', 'en_attente', 'echec']);
    expect(rows.slice(0, 3).map((r) => r.delai)).toEqual(['00:01:00', '00:05:00', '00:15:00']);
  });

  it('l’échec garde la raison et est tracé au journal d’audit', async () => {
    const rows = await lastRows(`${submitted}
      ${[1, 2, 3, 4].map(() => result(`'HTTP 503 : service indisponible'`)).join('\n')}
      SELECT (SELECT row(statut, tentatives, derniere_erreur, echouee_le IS NOT NULL)::text
                FROM notification WHERE objet_id = 'DS-1041' ORDER BY id DESC LIMIT 1) AS message,
             (SELECT row(utilisateur_id IS NULL, action, objet_id, details->>'modele',
                         details->>'tentatives', details->>'erreur')::text
                FROM journal_audit ORDER BY id DESC LIMIT 1) AS audit;`);
    expect(rows).toEqual([
      {
        message: '(echec,4,"HTTP 503 : service indisponible",t)',
        audit: '(t,notification.echec,DS-1041,dossier.soumis,4,"HTTP 503 : service indisponible")',
      },
    ]);
  });

  it('une erreur définitive (pas de numéro) passe en échec sans nouvel essai', async () => {
    const rows = await lastRows(`${submitted} ${result(`'Aucun numéro de téléphone'`, true)}`);
    expect(rows).toEqual([{ statut: 'echec' }]);
  });

  it('un message déjà traité ne peut pas recevoir un second résultat', async () => {
    await expect(
      attempt(`${submitted} ${result('NULL')}
        SELECT notification_sms_resultat((SELECT max(id) FROM notification), NULL);`),
    ).rejects.toThrow('introuvable ou déjà traitée');
  });

  it('refuse un échec sans date et une 5e tentative', async () => {
    await expect(attempt(`UPDATE notification SET statut = 'echec' WHERE id = 1;`)).rejects.toThrow(
      'ck_notification_echec',
    );
    await expect(attempt(`UPDATE notification SET tentatives = 5 WHERE id = 1;`)).rejects.toThrow(
      'ck_notification_tentatives',
    );
  });
});

describe('Plusieurs instances de l’API relèvent la file en même temps', () => {
  let id: number;

  beforeAll(async () => {
    const { rows } = await runSql(
      db.url.app,
      `INSERT INTO sabou.notification (destinataire_id, canal, modele, objet_type, objet_id)
       VALUES (6, 'sms', 'dossier.soumis', 'dossier', 'DS-9999') RETURNING id`,
    );
    id = Number((rows[0] as { id: string }).id);
  });

  afterAll(async () => {
    await runSql(db.url.app, `DELETE FROM sabou.notification WHERE id = ${id}`);
  });

  it('un message pris par une instance est sauté par l’autre (SKIP LOCKED)', async () => {
    const take = `SELECT id FROM sabou.notification_sms_prendre(10, interval '2 minutes')`;
    const first = new pg.Client({ connectionString: db.url.app });
    await first.connect();
    try {
      await first.query('BEGIN');
      const mine = await first.query(take);
      // Pendant que la première instance envoie (transaction ouverte), la seconde relève
      const other = await runSql(db.url.app, take);
      expect(mine.rows.map((r: { id: string }) => Number(r.id))).toEqual([id]);
      expect(other.rows).toEqual([]);
    } finally {
      await first.query('ROLLBACK');
      await first.end();
    }
  });
});
