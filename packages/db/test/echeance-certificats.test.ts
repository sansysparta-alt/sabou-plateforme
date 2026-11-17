// US-049 : le système expire les certificats et relance les praticiens 60 jours avant
// l'échéance (UC-71, R-QR-01, R-QR-07, R-CER-08). Exécuté sous le rôle de l'API (sabou_app),
// sans contexte de zone, comme la relève des SMS ; chaque cas part du même état (transaction
// annulée). Certificat étudié : SAB-2026-PR1042-KX7 (praticien PR-1042, utilisateur 7).
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows as rowsAt, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const lastRows = (sql: string) => rowsAt(db.url.app, sql);

const NUMERO = `'SAB-2026-PR1042-KX7'`;
const expiry = `(SELECT expire_le FROM certificat WHERE numero = ${NUMERO})`;
// Heure de Conakry, n jours avant (ou après, si n < 0) l'échéance du certificat étudié
const at = (days: number, time: string) =>
  `((${expiry} - ${days}) + time '${time}') AT TIME ZONE 'Africa/Conakry'`;
const run = (when: string) => `SELECT * FROM certificats_echeances_traiter(${when});`;
// Le certificat étudié arrive à échéance hier (date réelle) : 12 mois tout juste écoulés
const expiredYesterday = `UPDATE certificat
  SET emis_le = current_date - 365, expire_le = current_date - 1 WHERE numero = ${NUMERO};`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère 1 : un certificat arrivé à échéance passe « expiré » et sort de l’annuaire', () => {
  it('valable jusqu’à son échéance incluse, expiré au premier passage du lendemain', async () => {
    const lastDay = await lastRows(`${run(at(0, '23:59'))}
      SELECT statut FROM certificat WHERE numero = ${NUMERO};`);
    expect(lastDay).toEqual([{ statut: 'actif' }]);
    const nextDay = await lastRows(`${run(at(-1, '00:00'))}
      SELECT statut FROM certificat WHERE numero = ${NUMERO};`);
    expect(nextDay).toEqual([{ statut: 'expire' }]);
  });

  it('la tâche quotidienne expire le certificat : le praticien sort de l’annuaire, le QR répond ambre', async () => {
    const before = await lastRows(
      `SELECT count(*)::int AS annuaire FROM v_annuaire_public WHERE code = 'PR-1042';`,
    );
    expect(before).toEqual([{ annuaire: 1 }]);
    const rows = await lastRows(`${expiredYesterday} ${run('now()')}
      SELECT (SELECT statut FROM certificat WHERE numero = ${NUMERO}) AS statut,
             (SELECT count(*)::int FROM v_annuaire_public WHERE code = 'PR-1042') AS annuaire,
             (SELECT verdict FROM verifier_certificat(${NUMERO})) AS verdict;`);
    expect(rows).toEqual([{ statut: 'expire', annuaire: 0, verdict: 'ambre' }]);
  });

  it('une seule fois, tracé au journal comme action automatique', async () => {
    const rows = await lastRows(`${expiredYesterday} ${run('now()')} ${run('now()')}
      SELECT utilisateur_id, action, objet_type, objet_id, details->>'praticien' AS praticien,
             details->>'automatique' AS automatique,
             (SELECT count(*)::int FROM journal_audit WHERE action = 'certificat.expire') AS total
        FROM journal_audit WHERE action = 'certificat.expire';`);
    expect(rows).toEqual([
      {
        utilisateur_id: null,
        action: 'certificat.expire',
        objet_type: 'certificat',
        objet_id: 'SAB-2026-PR1042-KX7',
        praticien: 'PR-1042',
        automatique: 'true',
        total: 1,
      },
    ]);
  });

  it('les autres certificats actifs ne bougent pas', async () => {
    const rows = await lastRows(`${expiredYesterday} ${run('now()')}
      SELECT count(*)::int AS actifs FROM certificat WHERE statut = 'actif';`);
    expect(rows).toEqual([{ actifs: 3 }]);
  });

  it('un certificat révoqué reste révoqué', async () => {
    const rows = await lastRows(`${expiredYesterday}
      UPDATE certificat SET statut = 'revoque', revoque_le = now(), motif_revocation = 'test'
       WHERE numero = ${NUMERO};
      ${run('now()')}
      SELECT statut FROM certificat WHERE numero = ${NUMERO};`);
    expect(rows).toEqual([{ statut: 'revoque' }]);
  });
});

describe('Critère 2 : à 60 jours de l’échéance, le praticien est invité à renouveler', () => {
  const sms = `SELECT row(destinataire_id, canal, modele, objet_type, objet_id)::text AS sms,
         parametres->>'expireLe' = to_char(${expiry}, 'YYYY-MM-DD') AS date,
         (SELECT count(*)::int FROM notification
           WHERE modele = 'certificat.renouvellement' AND objet_id = ${NUMERO}) AS total
    FROM notification WHERE modele = 'certificat.renouvellement' AND objet_id = ${NUMERO};`;

  it('rien à 61 jours, ni avant 8 h le 60e jour', async () => {
    expect(await lastRows(run(at(61, '12:00')))).toEqual([{ expires: 0, relances: 0 }]);
    expect(await lastRows(run(at(60, '07:59')))).toEqual([{ expires: 0, relances: 0 }]);
  });

  it('à partir de 8 h le 60e jour : un SMS au praticien, une seule fois', async () => {
    expect(await lastRows(run(at(60, '08:00')))).toEqual([{ expires: 0, relances: 1 }]);
    const rows = await lastRows(`${run(at(60, '08:00'))} ${run(at(60, '12:00'))}
      ${run(at(30, '09:00'))} ${sms}`);
    expect(rows).toEqual([
      {
        sms: '(7,sms,certificat.renouvellement,certificat,SAB-2026-PR1042-KX7)',
        date: true,
        total: 1,
      },
    ]);
  });

  it('un passage manqué est rattrapé tant que le certificat est actif', async () => {
    const rows = await lastRows(`${run(at(10, '08:30'))} ${sms}`);
    expect(rows).toEqual([
      {
        sms: '(7,sms,certificat.renouvellement,certificat,SAB-2026-PR1042-KX7)',
        date: true,
        total: 1,
      },
    ]);
  });

  it('aucune relance si un dossier de renouvellement est déjà en cours', async () => {
    // Insertion par le propriétaire des tables : l'ouverture d'un renouvellement n'a pas
    // encore son récit (R-QR-07)
    const rows = await rowsAt(
      db.url.migrator,
      `SET LOCAL search_path = sabou;
      INSERT INTO dossier_certification (code, praticien_id, type, visite_requise)
      VALUES ('DS-9049', 2, 'renouvellement', false);
      ${run(at(60, '09:00'))}`,
    );
    expect(rows).toEqual([{ expires: 0, relances: 0 }]);
  });

  it('aucune relance pour un certificat révoqué', async () => {
    const rows = await lastRows(`
      UPDATE certificat SET statut = 'revoque', revoque_le = now(), motif_revocation = 'test'
       WHERE numero = ${NUMERO};
      ${run(at(60, '09:00'))}`);
    expect(rows).toEqual([{ expires: 0, relances: 0 }]);
  });

  it('la tâche est réservée à l’API', async () => {
    const rows = await rowsAt(
      db.url.postgres,
      `SELECT has_function_privilege('public', 'sabou.certificats_echeances_traiter(timestamptz)', 'EXECUTE') AS public,
              has_function_privilege('sabou_app', 'sabou.certificats_echeances_traiter(timestamptz)', 'EXECUTE') AS api;`,
    );
    expect(rows).toEqual([{ public: false, api: true }]);
  });
});
