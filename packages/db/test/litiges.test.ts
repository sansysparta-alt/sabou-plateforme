// US-101 : litiges et recours de 30 jours après un rejet définitif (UC-43, R-MOD-01,
// R-CER-04 ; décisions du maître d'œuvre du 19 novembre 2026, 05 §2.88).
// Exécuté sous le rôle de l'API (sabou_app) ; chaque cas part du même état (transaction annulée).
// Critère 1 : pièces et échanges, décision motivée notifiée.
// Critère 2 : le recours de 30 jours après un rejet définitif passe par un litige.
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const DG = 'dg@sabou-sante.gn';
const REGIONAL = 'regional.labe@sabou-sante.gn';
const OTHER_REGIONAL = 'regional.kankan@sabou-sante.gn';
const PREFECTORAL = 'prefectoral.labe@sabou-sante.gn';
// PR-1042 (Labé) : certifié, certificat actif, traitements certifiés
const DIALLO = 'm.diallo@exemple.gn';
// PR-1041 (Labé) : dossier DS-1041 en cours, jamais certifié
const KOUROUMA = 's.kourouma@exemple.gn';
const run = (sql: string) => lastRows(db.url.app, sql);

const reject = (code: string) => `${openContext(DG)}
  SELECT praticien_rejeter(p.id, contexte_utilisateur(), 'fraude_documentaire', 'Pièce falsifiée')
    FROM praticien p WHERE p.code = '${code}';`;
const open = (email: string, type = 'recours') => `${openContext(email)}
  SELECT litige_ouvrir('${type}', 'Contestation', 'Je conteste la décision ; voici mes pièces.') AS code;`;
const CODE = `(SELECT code FROM litige WHERE objet = 'Contestation')`;
const recours = `${reject('PR-1042')} ${open(DIALLO)}`;
const say = (email: string, text = 'Merci de préciser.') =>
  `${openContext(email)} SELECT litige_message_ajouter(${CODE}, '${text}');`;
const opinion = `${openContext(REGIONAL)}
  SELECT litige_avis_rendre(${CODE}, 'favorable', 'Pièce authentique, confirmée par la mairie.');`;
const sms = (modele: string) => `SELECT count(*)::int AS sms FROM notification
  WHERE modele = '${modele}' AND objet_type = 'litige' AND objet_id = ${CODE};`;
// Décision de la DG sur un recours accepté, avec les données d'un certificat préparé
const acceptWithCertificate = `${openContext(DG)}
  SELECT litige_decider(${CODE}, 'accepte', 'Recours fondé : pièce authentique.',
           c.numero, c.emis_le, c.expire_le, '${'e'.repeat(64)}', 'c2lnbmF0dXJl', 'dg-essai',
           'Y2xlLXB1YmxpcXVl', 'SB1:ESSAI')
    FROM litige_certificat_preparer(${CODE}) c;`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère 2 : le recours de 30 jours passe par un litige', () => {
  it('le praticien rejeté ouvre son recours, rattaché au rejet', async () => {
    const rows = await run(`${recours}
      SELECT l.code ~ '^LT-\\d{5}$' AS code, l.type, l.statut, l.rejet_id IS NOT NULL AS rejet,
             (SELECT count(*)::int FROM litige_message m WHERE m.litige_id = l.id) AS messages
        FROM litige l WHERE l.code = ${CODE};`);
    expect(rows).toEqual([
      { code: true, type: 'recours', statut: 'ouvert', rejet: true, messages: 1 },
    ]);
  });

  it('sans rejet définitif, pas de recours', async () => {
    await expect(run(open(DIALLO))).rejects.toThrow(/seulement après un rejet définitif/);
  });

  it('un seul recours par rejet', async () => {
    await expect(run(`${recours} ${open(DIALLO)}`)).rejects.toThrow(/déjà ouvert/);
  });

  it('au-delà de 30 jours, le recours est refusé', async () => {
    await expect(
      lastRows(
        db.url.postgres,
        `SET LOCAL search_path = sabou, public; SET LOCAL ROLE sabou_app; ${reject('PR-1042')}
         RESET ROLE; SET LOCAL session_replication_role = replica;
         UPDATE rejet_definitif SET decide_le = now() - interval '40 days',
                recours_jusquau = ((now() - interval '40 days') AT TIME ZONE 'Africa/Conakry')::date + 30;
         SET LOCAL session_replication_role = origin; SET LOCAL ROLE sabou_app; ${open(DIALLO)}`,
      ),
    ).rejects.toThrow(/délai de recours dépassé/);
  });

  it('seul un praticien ouvre un litige', async () => {
    await expect(run(open(REGIONAL, 'autre'))).rejects.toThrow(/réservée au praticien/);
  });
});

describe('Cloisonnement', () => {
  it('le praticien, le régional de sa région et la DG le voient ; personne d’autre', async () => {
    const seen = (email: string) => `${openContext(email)}
      SELECT count(*)::int AS n FROM litige WHERE objet = 'Contestation';`;
    expect(await run(`${recours} ${seen(DIALLO)}`)).toEqual([{ n: 1 }]);
    expect(await run(`${recours} ${seen(REGIONAL)}`)).toEqual([{ n: 1 }]);
    expect(await run(`${recours} ${seen(DG)}`)).toEqual([{ n: 1 }]);
    expect(await run(`${recours} ${seen(KOUROUMA)}`)).toEqual([{ n: 0 }]);
    expect(await run(`${recours} ${seen(OTHER_REGIONAL)}`)).toEqual([{ n: 0 }]);
    expect(await run(`${recours} ${seen('comite@sabou-sante.gn')}`)).toEqual([{ n: 0 }]);
  });
});

describe('Critère 1 : pièces et échanges', () => {
  it('le régional répond : litige en arbitrage, le praticien est prévenu par SMS', async () => {
    const rows = await run(`${open(KOUROUMA, 'autre')} ${say(REGIONAL)}
      SELECT l.statut, (SELECT count(*)::int FROM notification WHERE modele = 'litige.message'
                          AND objet_type = 'litige' AND objet_id = l.code) AS sms
        FROM litige l WHERE l.code = ${CODE};`);
    expect(rows).toEqual([{ statut: 'en_arbitrage', sms: 1 }]);
  });

  it('le message du praticien ne déclenche pas de SMS ; le préfectoral n’écrit pas', async () => {
    expect(
      await run(`${open(KOUROUMA, 'autre')} ${say(KOUROUMA)} ${sms('litige.message')}`),
    ).toEqual([{ sms: 0 }]);
    await expect(run(`${open(KOUROUMA, 'autre')} ${say(PREFECTORAL)}`)).rejects.toThrow(
      /réservée au praticien et à l'administration/,
    );
  });

  it('la DG n’intervient que dans un recours', async () => {
    await expect(run(`${open(KOUROUMA, 'autre')} ${say(DG)}`)).rejects.toThrow(/réservée/);
    expect(await run(`${recours} ${say(DG)} SELECT 1 AS ok;`)).toEqual([{ ok: 1 }]);
  });

  it('pièces : jointes par les parties, dix au plus', async () => {
    const piece = (n: number) =>
      `SELECT litige_piece_ajouter(${CODE}, 'pieces/essai-${n}.jpg', '${'a'.repeat(64)}', 'image/jpeg', 1000);`;
    const ten = Array.from({ length: 10 }, (_, i) => piece(i)).join(' ');
    const rows = await run(`${open(KOUROUMA, 'autre')} ${ten}
      SELECT count(*)::int AS n FROM litige_piece p JOIN litige l ON l.id = p.litige_id WHERE l.code = ${CODE};`);
    expect(rows).toEqual([{ n: 10 }]);
    await expect(run(`${open(KOUROUMA, 'autre')} ${ten} ${piece(11)}`)).rejects.toThrow(
      /dix pièces au plus/,
    );
  });

  it('échanges et pièces ne se modifient pas', async () => {
    await expect(
      run(`${open(KOUROUMA, 'autre')} UPDATE litige_message SET contenu = 'autre';`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('Critère 1 : décision motivée notifiée', () => {
  it('litige ordinaire : le régional décide ; SMS au praticien ; litige figé', async () => {
    const decided = `${open(KOUROUMA, 'autre')} ${openContext(REGIONAL)}
      SELECT litige_decider(${CODE}, 'accepte', 'Photo refaite : la pièce est lisible.');`;
    const rows = await run(`${decided}
      SELECT statut, issue, decision IS NOT NULL AS motif, (SELECT count(*)::int FROM notification
        WHERE modele = 'litige.decide' AND objet_id = ${CODE}) AS sms FROM litige WHERE code = ${CODE};`);
    expect(rows).toEqual([{ statut: 'resolu', issue: 'accepte', motif: true, sms: 1 }]);
    await expect(run(`${decided} ${say(KOUROUMA)}`)).rejects.toThrow(/résolu/);
    await expect(
      lastRows(
        db.url.postgres,
        `SET LOCAL search_path = sabou, public; SET LOCAL ROLE sabou_app; ${decided}
         RESET ROLE; UPDATE litige SET decision = 'autre' WHERE code = ${CODE};`,
      ),
    ).rejects.toThrow(/résolu : aucune modification/);
  });

  it('recours : le régional rend un avis, il ne décide pas ; la DG décide après l’avis', async () => {
    await expect(
      run(`${recours} ${openContext(REGIONAL)} SELECT litige_decider(${CODE}, 'accepte', 'x');`),
    ).rejects.toThrow(/réservée à la DG/);
    await expect(
      run(`${recours} ${openContext(DG)} SELECT litige_decider(${CODE}, 'refuse', 'x');`),
    ).rejects.toThrow(/après l'avis/);
    const rows = await run(`${recours} ${opinion}
      SELECT statut, avis_sens FROM litige WHERE code = ${CODE};`);
    expect(rows).toEqual([{ statut: 'avis_rendu', avis_sens: 'favorable' }]);
  });

  it('recours refusé : le praticien reste rejeté, il est prévenu', async () => {
    const rows = await run(`${recours} ${opinion} ${openContext(DG)}
      SELECT litige_decider(${CODE}, 'refuse', 'Falsification confirmée.');
      SELECT p.statut, (SELECT count(*)::int FROM notification WHERE modele = 'litige.decide'
                          AND objet_id = ${CODE}) AS sms
        FROM praticien p WHERE p.code = 'PR-1042';`);
    expect(rows).toEqual([{ statut: 'rejete', sms: 1 }]);
  });

  it('recours accepté d’un certifié : rétabli, traitements remis en ligne, nouveau certificat', async () => {
    const rows = await run(`${openContext(DIALLO)}
      CREATE TEMP TABLE avant AS SELECT count(*)::int AS n FROM recette r JOIN praticien p
        ON p.id = r.praticien_id WHERE p.code = 'PR-1042' AND r.statut = 'certifiee';
      ${recours} ${opinion} ${acceptWithCertificate}
      SELECT p.statut,
             (SELECT count(*)::int FROM recette r WHERE r.praticien_id = p.id AND r.statut = 'certifiee')
               = (SELECT n FROM avant) AS traitements,
             (SELECT count(*)::int FROM recette r WHERE r.praticien_id = p.id AND r.statut = 'suspendue') AS suspendus,
             (SELECT statut FROM certificat WHERE numero = 'SAB-2026-PR1042-KX7') AS ancien,
             (SELECT c.statut FROM certificat c JOIN litige l ON l.certificat_id = c.id
               WHERE l.code = ${CODE}) AS nouveau
        FROM praticien p WHERE p.code = 'PR-1042';`);
    expect(rows).toEqual([
      { statut: 'certifie', traitements: true, suspendus: 0, ancien: 'revoque', nouveau: 'actif' },
    ]);
  });

  it('recours accepté d’un certifié sans certificat signé : refusé', async () => {
    await expect(
      run(`${recours} ${opinion} ${openContext(DG)}
        SELECT litige_decider(${CODE}, 'accepte', 'Recours fondé.');`),
    ).rejects.toThrow(/dates du certificat/);
  });

  it('recours accepté d’un praticien jamais certifié : en attente, délai de 12 mois levé', async () => {
    const accepted = `${reject('PR-1041')} ${open(KOUROUMA)} ${opinion} ${openContext(DG)}
      SELECT litige_decider(${CODE}, 'accepte', 'Recours fondé.');`;
    expect(await run(`${accepted} SELECT statut FROM praticien WHERE code = 'PR-1041';`)).toEqual([
      { statut: 'en_attente' },
    ]);
    // Un nouveau dossier est de nouveau possible (refusé sans le recours : rejet-definitif.test.ts)
    const rows = await lastRows(
      db.url.postgres,
      `SET LOCAL search_path = sabou, public; SET LOCAL ROLE sabou_app; ${accepted}
       RESET ROLE;
       INSERT INTO dossier_certification (code, praticien_id, type, etape_courante, statut)
       VALUES ('DS-9101', 1, 'initial', 1, 'en_cours');
       SELECT count(*)::int AS n FROM dossier_certification WHERE code = 'DS-9101';`,
    );
    expect(rows).toEqual([{ n: 1 }]);
  });
});
