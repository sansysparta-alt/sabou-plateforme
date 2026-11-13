// US-045 : la DG approuve un dossier à l'étape 5 et émet un certificat signé (UC-60).
// Exécuté sous le rôle de l'API (sabou_app), dans le contexte de chaque acteur, sur le jeu
// d'exemple ; chaque cas part du même état (transaction annulée). L'empreinte et la signature
// viennent de l'API et du coffre (apps/api/src/certificates) : ici, des valeurs de forme
// valide. Les messages vérifiés ici sont ceux que l'API traduit en réponses.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createSeededDatabase,
  inRolledBackTransaction,
  lastRows as rowsAt,
  openContext,
  type TestDatabase,
} from './helpers.ts';

let db: TestDatabase;
const attempt = (sql: string) => inRolledBackTransaction(db.url.app, sql);
const lastRows = (sql: string) => rowsAt(db.url.app, sql);

const DG = 'dg@sabou-sante.gn';
const HASH = 'd'.repeat(64);
const SIGNATURE = 'c2lnbmF0dXJl';
const KID = 'dg-0a1b2c3d';
const KEY = 'uJK0ULaCKFo8CWZMA56e05Df5nq8-N-px4dnGxsiI4w';
const QR = 'SB1:EXEMPLE';
const TODAY = `(now() AT TIME ZONE 'Africa/Conakry')::date`;
const IN_12_MONTHS = `(${TODAY} + interval '12 months' - interval '1 day')::date`;

// DS-1041 (praticien de Labé) soumis, vérifié sur le terrain, consolidé, expertisé : il
// attend l'approbation de la DG (étape 5)
const atStep5 = `${openContext('s.kourouma@exemple.gn')}
  SELECT dossier_transition(1, 'soumis', contexte_utilisateur());
  ${openContext('prefectoral.labe@sabou-sante.gn')}
  SELECT visite_realiser(1, contexte_utilisateur(), vt.id, current_date, 'Lieu conforme.',
                         'favorable', repeat('b', 64))
    FROM visite_terrain vt WHERE vt.dossier_id = 1 AND vt.statut = 'planifiee';
  SELECT dossier_transition(1, 'valide', contexte_utilisateur());
  ${openContext('regional.labe@sabou-sante.gn')}
  SELECT dossier_transition(1, 'valide', contexte_utilisateur());
  ${openContext('comite@sabou-sante.gn')}
  SELECT dossier_transition(1, 'valide', contexte_utilisateur());`;

const prepare = (email: string, dossier = 1) => `${openContext(email)}
  SELECT * FROM certificat_preparer(${dossier}, contexte_utilisateur());`;

// Émission avec les données préparées ; chaque paramètre peut être remplacé
const emit = (
  email: string,
  {
    dossier = '1',
    numero = 'p.numero',
    emis = 'p.emis_le',
    expire = 'p.expire_le',
    kid = `'${KID}'`,
    key = `'${KEY}'`,
    qr = `'${QR}'`,
  } = {},
) => `${openContext(email)}
  SELECT certificat_emettre(${dossier}, contexte_utilisateur(), ${numero}, ${emis}, ${expire},
                            '${HASH}', '${SIGNATURE}', ${kid}, ${key}, ${qr}) AS etape
    FROM certificat_preparer(${dossier}, contexte_utilisateur()) p;`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère 1 : à l’étape 5, l’approbation crée un certificat de 12 mois, empreinte, signature et QR', () => {
  it('prépare le numéro, le titulaire et les dates : 12 mois à partir du jour, à Conakry', async () => {
    const rows = await lastRows(`${atStep5} ${prepare(DG)}`);
    expect(rows).toHaveLength(1);
    const [row] = rows as [{ numero: string; titulaire: string; emis_le: Date; expire_le: Date }];
    expect(row.numero).toMatch(/^SAB-\d{4}-PR1041-[A-HJ-NP-Z2-9]{3}$/);
    expect(row.titulaire).toBe('Sékou Kourouma');
    const check = await lastRows(`SELECT ${TODAY} = '${iso(row.emis_le)}'::date AS emis,
                                         ${IN_12_MONTHS} = '${iso(row.expire_le)}'::date AS expire;`);
    expect(check).toEqual([{ emis: true, expire: true }]);
  });

  it('enregistre le certificat actif et fait passer le dossier à l’étape 6', async () => {
    const rows = await lastRows(`${atStep5} ${emit(DG)}
      SELECT d.etape_courante AS etape, d.statut AS dossier, c.statut, c.empreinte_sha3 = '${HASH}' AS empreinte,
             c.signature, c.qr, k.kid, k.cle_publique, u.email AS emis_par,
             c.emis_le = ${TODAY} AS emis, c.expire_le = ${IN_12_MONTHS} AS expire
        FROM certificat c JOIN dossier_certification d ON d.id = c.dossier_id
        JOIN cle_signature k ON k.id = c.cle_id JOIN utilisateur u ON u.id = c.emis_par
       WHERE c.dossier_id = 1;`);
    expect(rows).toEqual([
      {
        etape: 6,
        dossier: 'en_cours',
        statut: 'actif',
        empreinte: true,
        signature: SIGNATURE,
        qr: QR,
        kid: KID,
        cle_publique: KEY,
        emis_par: DG,
        emis: true,
        expire: true,
      },
    ]);
  });

  it('trace l’approbation : historique, SMS au praticien, journal d’audit (R-CER-05)', async () => {
    const rows = await lastRows(`${atStep5} ${emit(DG)}
      SELECT (SELECT row(etape_depart, etape_arrivee, decision)::text FROM dossier_historique
                WHERE dossier_id = 1 ORDER BY id DESC LIMIT 1) AS historique,
             (SELECT count(*)::int FROM notification
                WHERE modele = 'dossier.valide' AND objet_id = 'DS-1041') AS sms,
             (SELECT string_agg(action, ',' ORDER BY id) FROM journal_audit
                WHERE action IN ('certificat.emis', 'dossier.valide')
                  AND (objet_id = 'DS-1041' OR details->>'dossier' = 'DS-1041')) AS audit;`);
    expect(rows).toEqual([
      {
        historique: '(5,6,valide)',
        sms: 4,
        audit: 'dossier.valide,dossier.valide,dossier.valide,certificat.emis,dossier.valide',
      },
    ]);
  });

  it('une clé déjà connue est réutilisée, sans doublon', async () => {
    const rows =
      await lastRows(`${atStep5} ${emit(DG, { kid: `'exemple-2026'`, key: `'MCowBQYDK2VwAyEA-exemple-cle-publique-DG-SABOU-2026'` })}
      SELECT count(*)::int AS cles, (SELECT cle_id FROM certificat WHERE dossier_id = 1) AS cle
        FROM cle_signature;`);
    expect(rows).toEqual([{ cles: 1, cle: 1 }]);
  });
});

describe('Seule la DG approuve, à l’étape 5 seulement, et jamais sans certificat', () => {
  it.each([
    ['le Comité', 'comite@sabou-sante.gn'],
    ['un admin régional', 'regional.labe@sabou-sante.gn'],
    ['un admin préfectoral', 'prefectoral.labe@sabou-sante.gn'],
  ])('%s ne prépare ni n’émet de certificat', async (_, email) => {
    await expect(attempt(`${atStep5} ${prepare(email)}`)).rejects.toThrow(/non habilité/);
    await expect(attempt(`${atStep5} ${emit(email)}`)).rejects.toThrow(/non habilité/);
  });

  it('dossier à une autre étape : refusé', async () => {
    await expect(attempt(prepare(DG))).rejects.toThrow(/étape 5 seulement/);
  });

  it('validation directe à l’étape 5, sans certificat : refusée', async () => {
    await expect(
      attempt(`${atStep5} ${openContext(DG)}
        SELECT dossier_transition(1, 'valide', contexte_utilisateur());`),
    ).rejects.toThrow(/certificat signé requis pour approuver/);
  });

  it('rejet à l’étape 5 (retour au Comité) : toujours possible, sans certificat', async () => {
    const rows = await lastRows(`${atStep5} ${openContext(DG)}
      SELECT dossier_transition(1, 'rejete', contexte_utilisateur(), 'Avis à préciser') AS etape;`);
    expect(rows).toEqual([{ etape: 4 }]);
  });
});

describe('Le certificat enregistré est celui qui a été préparé et signé', () => {
  it.each([
    ['date d’émission d’hier', { emis: `${TODAY} - 1` }, /dates du certificat périmées/],
    [
      'validité de plus de 12 mois',
      { expire: `${IN_12_MONTHS} + 1` },
      /dates du certificat périmées/,
    ],
    [
      'numéro d’un autre praticien',
      { numero: `'SAB-2026-PR1042-ABC'` },
      /numéro de certificat invalide/,
    ],
    ['QR absent', { qr: 'NULL' }, /QR du certificat manquant/],
    ['identifiant d’une autre clé', { kid: `'exemple-2026'` }, /inconnue ou révoquée/],
  ])('%s : refusé', async (_, change, message) => {
    await expect(attempt(`${atStep5} ${emit(DG, change)}`)).rejects.toThrow(message);
  });

  it('clé révoquée (R-QR-04) : refusée', async () => {
    await expect(
      attempt(`${atStep5}
        UPDATE cle_signature SET revoquee_le = now() WHERE kid = 'exemple-2026';
        ${emit(DG, { kid: `'exemple-2026'`, key: `'MCowBQYDK2VwAyEA-exemple-cle-publique-DG-SABOU-2026'` })}`),
    ).rejects.toThrow(/inconnue ou révoquée/);
  });
});

describe('Critère 3 : au renouvellement, l’ancien certificat passe « expiré »', () => {
  // PR-1042 (Mamadou Diallo) a un certificat actif ; son dossier de renouvellement arrive à
  // l'étape 5 (ouverture des renouvellements : US-049, hors de ce récit)
  const renewal = `${openContext(DG)}
    INSERT INTO dossier_certification (praticien_id, type, visite_requise, etape_courante)
    VALUES (2, 'renouvellement', false, 5);`;
  const renewalId = `(SELECT id FROM dossier_certification WHERE praticien_id = 2 AND statut = 'en_cours')`;

  it('l’ancien passe « expiré », le nouveau est le seul actif', async () => {
    const rows = await lastRows(`${renewal} ${emit(DG, { dossier: renewalId })}
      SELECT numero LIKE 'SAB-2026-PR1042-KX7' AS ancien, statut FROM certificat
       WHERE praticien_id = 2 ORDER BY id;`);
    expect(rows).toEqual([
      { ancien: true, statut: 'expire' },
      { ancien: false, statut: 'actif' },
    ]);
  });

  it('la vérification publique de l’ancien donne « ambre » (R-QR-05)', async () => {
    const rows = await lastRows(`${renewal} ${emit(DG, { dossier: renewalId })}
      SELECT verdict FROM verifier_certificat('SAB-2026-PR1042-KX7');`);
    expect(rows).toEqual([{ verdict: 'ambre' }]);
  });
});

function iso(date: Date): string {
  // Le pilote pg renvoie une date à minuit, heure locale
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
