// US-070 : file de traitement des voix déposées (UC-73). Dépôt dans le contexte d'un compte,
// relève par l'API (rôle de l'application, sans contexte), voix publiée avec sa durée, sa
// taille, son empreinte et le consentement du dépositaire. Chaque cas part du même état.
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const PREFECTORAL = 'prefectoral.labe@sabou-sante.gn';
const SHA = 'c'.repeat(64);
const as = (email: string, sql: string) => lastRows(db.url.app, `${openContext(email)} ${sql}`);
const asApi = (sql: string) => lastRows(db.url.app, sql);
const deposit = (key = 'voix/originaux/a.webm', consent = true) =>
  `SELECT id FROM voix_deposer('${key}', 'audio/webm', 120000, '${SHA}', ${consent});`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : durée, taille et empreinte calculées automatiquement', () => {
  it('dépôt → prise par l’API → voix publiée avec durée, taille, empreinte et consentement', async () => {
    const rows = await as(
      PREFECTORAL,
      `${deposit()}
       SELECT id AS pris, tentatives FROM voix_depots_prendre(5);
       SELECT voix_depot_terminer((SELECT max(id) FROM voix_depot), 'voix/abc.webm', 'voix/abc.m4a',
                                  90.456, 271000, 360000, '${'d'.repeat(64)}') AS audio;
       SELECT d.statut, a.duree_sec::text, a.taille_octets, a.sha256, a.format, a.chemin_secours,
              a.consentement_voix, a.consentement_le IS NOT NULL AS consentement_date,
              u.email AS depositaire
         FROM voix_depot d JOIN audio_fichier a ON a.id = d.audio_id
         JOIN utilisateur u ON u.id = a.enregistre_par
        WHERE d.id = (SELECT max(id) FROM voix_depot);`,
    );
    expect(rows).toEqual([
      {
        statut: 'traitee',
        duree_sec: '90.46',
        taille_octets: 271000,
        sha256: 'd'.repeat(64),
        format: 'opus',
        chemin_secours: 'voix/abc.m4a',
        consentement_voix: true,
        consentement_date: true,
        depositaire: PREFECTORAL,
      },
    ]);
  });

  it('sans consentement, la voix est enregistrée mais pas publiable (R-LNG-11)', async () => {
    const rows = await as(
      PREFECTORAL,
      `${deposit('voix/originaux/b.webm', false)}
       SELECT 1 FROM voix_depots_prendre(5);
       SELECT voix_depot_terminer((SELECT max(id) FROM voix_depot), 'voix/b.webm', 'voix/b.m4a',
                                  3, 9000, 12000, '${'e'.repeat(64)}');
       SELECT consentement_voix, consentement_le FROM audio_fichier WHERE chemin = 'voix/b.webm';`,
    );
    expect(rows).toEqual([{ consentement_voix: false, consentement_le: null }]);
  });

  it('le dépositaire voit l’état de son dépôt, un autre compte non', async () => {
    const mine = await as(
      PREFECTORAL,
      `${deposit()} SELECT * FROM voix_depot_etat((SELECT max(id) FROM voix_depot));`,
    );
    expect(mine).toEqual([
      { statut: 'en_attente', erreur: null, duree_sec: null, taille_octets: null, sha256: null },
    ]);
    const other = await lastRows(
      db.url.app,
      `${openContext(PREFECTORAL)} ${deposit()}
       ${openContext('dg@sabou-sante.gn')}
       SELECT * FROM voix_depot_etat((SELECT max(id) FROM voix_depot));`,
    );
    expect(other).toEqual([]);
  });
});

describe('File de traitement : un seul preneur, trois essais au plus', () => {
  it('un dépôt pris n’est pas repris tant qu’il est en cours', async () => {
    const rows = await as(
      PREFECTORAL,
      `${deposit()} SELECT 1 FROM voix_depots_prendre(5);
       SELECT count(*)::int AS repris FROM voix_depots_prendre(5);`,
    );
    expect(rows).toEqual([{ repris: 0 }]);
  });

  it('échec : nouvel essai, puis échec définitif au troisième, avec la raison', async () => {
    const attempt = `SELECT voix_depot_echouer((SELECT max(id) FROM voix_depot), 'FFmpeg a échoué (1)')
                       FROM voix_depots_prendre(5);`;
    const rows = await as(
      PREFECTORAL,
      `${deposit()} ${attempt} ${attempt} ${attempt}
       SELECT statut, tentatives, erreur FROM voix_depot WHERE id = (SELECT max(id) FROM voix_depot);`,
    );
    expect(rows).toEqual([{ statut: 'echec', tentatives: 3, erreur: 'FFmpeg a échoué (1)' }]);
  });

  it('traitement interrompu (API arrêtée) : repris après 10 minutes', async () => {
    const rows = await lastRows(
      db.url.migrator,
      `SET LOCAL search_path = sabou; ${openContext(PREFECTORAL)} ${deposit()}
       SELECT 1 FROM voix_depots_prendre(5);
       UPDATE voix_depot SET pris_le = now() - interval '11 minutes';
       SELECT count(*)::int AS repris FROM voix_depots_prendre(5);`,
    );
    expect(rows).toEqual([{ repris: 1 }]);
  });

  it('dépôt réservé aux comptes actifs des profils autorisés ; aucune écriture directe', async () => {
    await expect(as('aminata@exemple.gn', deposit())).rejects.toThrow(
      'non autorisé pour ce profil',
    );
    await expect(asApi(deposit())).rejects.toThrow('Acteur inconnu');
    await expect(as(PREFECTORAL, `UPDATE voix_depot SET statut = 'traitee';`)).rejects.toThrow(
      'permission denied',
    );
  });
});
