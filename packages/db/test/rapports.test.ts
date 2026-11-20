// US-091 : rapports mensuels et historique des exports (UC-36, UC-67, R-MOD-09 ; décisions du
// maître d'œuvre du 20 novembre 2026, 05 §2.91). Exécuté sous le rôle de l'API (sabou_app) ;
// chaque cas part du même état (transaction annulée).
// Critère 1 : rapport mensuel préfectoral prérempli, envoi au régional (et chaîne jusqu'à la DG).
// Critère 2 : historique des exports.
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const DG = 'dg@sabou-sante.gn';
const REGIONAL_LABE = 'regional.labe@sabou-sante.gn';
const REGIONAL_KANKAN = 'regional.kankan@sabou-sante.gn';
const PREFECTORAL_LABE = 'prefectoral.labe@sabou-sante.gn';
const PREFECTORAL_KANKAN = 'prefectoral.kankan@sabou-sante.gn';
const COMITE = 'comite@sabou-sante.gn';

const run = (sql: string) => lastRows(db.url.app, sql);
const as = (email: string, sql: string) => `${openContext(email)} ${sql}`;

// Mois écoulé, à l'heure de Conakry
const LAST_MONTH = `(date_trunc('month', now() AT TIME ZONE 'Africa/Conakry') - interval '1 month')::date`;
const prepare = (email: string, month = LAST_MONTH) =>
  as(email, `SELECT rapport_mensuel_preparer(${month}) AS id;`);
const PREF_REPORT = `(SELECT id FROM rapport_mensuel WHERE niveau = 'prefectoral' AND statut <> 'renvoye')`;
const REG_REPORT = `(SELECT id FROM rapport_mensuel WHERE niveau = 'regional' AND statut <> 'renvoye')`;
const send = (email: string, report: string) =>
  as(
    email,
    `SELECT rapport_mensuel_envoyer(${report}, (SELECT calcule_le FROM rapport_mensuel WHERE id = ${report}));`,
  );
// Rapport préfectoral de Labé envoyé au régional
const prefSent = `${prepare(PREFECTORAL_LABE)}
  ${as(PREFECTORAL_LABE, `SELECT rapport_mensuel_commenter(${PREF_REPORT}, 'Deux visites reportées pour cause de pluie.');`)}
  ${send(PREFECTORAL_LABE, PREF_REPORT)}`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère 1 : rapport mensuel préfectoral prérempli', () => {
  it('mois écoulé : activité, délais, anomalies et registre de sa seule préfecture', async () => {
    const rows = await run(`${prepare(PREFECTORAL_LABE)}
      SELECT niveau, statut, version, prefecture_id, region_admin_id,
             contenu -> 'registre' AS registre,
             contenu -> 'delais' ->> 'objectifJours' AS objectif,
             contenu ? 'activite' AND contenu ? 'anomalies' AS complet
        FROM rapport_mensuel;`);
    expect(rows).toEqual([
      {
        niveau: 'prefectoral',
        statut: 'brouillon',
        version: 1,
        prefecture_id: 4,
        region_admin_id: 4,
        registre: { enregistres: 2, certifies: 1, enAttente: 1 },
        objectif: '3',
        complet: true,
      },
    ]);
  });

  it('seul un mois écoulé, au premier jour, peut être rapporté', async () => {
    const current = `date_trunc('month', now() AT TIME ZONE 'Africa/Conakry')::date`;
    await expect(run(prepare(PREFECTORAL_LABE, current))).rejects.toThrow(/mois écoulé/);
    await expect(run(prepare(PREFECTORAL_LABE, `${LAST_MONTH} + 3`))).rejects.toThrow(
      /mois écoulé/,
    );
  });

  it('réservé au préfectoral et au régional', async () => {
    for (const email of [DG, COMITE, 's.kourouma@exemple.gn'])
      await expect(run(prepare(email))).rejects.toThrow(/Rapport : /);
  });

  it('préparé deux fois : même brouillon, chiffres recalculés, commentaire gardé', async () => {
    const rows = await run(`${prepare(PREFECTORAL_LABE)}
      ${as(PREFECTORAL_LABE, `SELECT rapport_mensuel_commenter(${PREF_REPORT}, 'Mois calme.');`)}
      UPDATE rapport_mensuel SET calcule_le = calcule_le - interval '1 hour';
      ${prepare(PREFECTORAL_LABE)}
      SELECT count(*)::int AS n, max(commentaire) AS commentaire,
             max(calcule_le) > now() - interval '1 minute' AS recalcule FROM rapport_mensuel;`);
    expect(rows).toEqual([{ n: 1, commentaire: 'Mois calme.', recalcule: true }]);
  });

  it('envoi : figé, régional prévenu (application et e-mail), trace au journal', async () => {
    const rows = await run(`${prefSent}
      SELECT r.statut, r.envoye_le IS NOT NULL AS date,
             (SELECT array_agg(n.canal ORDER BY n.canal) FROM notification n
               JOIN utilisateur u ON u.id = n.destinataire_id
              WHERE n.modele = 'rapport.recu' AND u.email = '${REGIONAL_LABE}') AS regional,
             (SELECT count(*)::int FROM notification WHERE modele = 'rapport.recu') AS notifications,
             (SELECT count(*)::int FROM journal_audit WHERE action = 'rapport.envoye') AS audit
        FROM rapport_mensuel r;`);
    expect(rows).toEqual([
      {
        statut: 'envoye',
        date: true,
        regional: ['application', 'email'],
        notifications: 2,
        audit: 1,
      },
    ]);
  });

  it('envoi refusé si les chiffres ont été recalculés depuis la lecture', async () => {
    await expect(
      run(`${prepare(PREFECTORAL_LABE)}
        ${as(PREFECTORAL_LABE, `SELECT rapport_mensuel_envoyer(${PREF_REPORT}, now() - interval '1 day');`)}`),
    ).rejects.toThrow(/ont changé depuis votre lecture/);
  });

  it('envoyé : plus de commentaire, plus de recalcul, aucune écriture directe', async () => {
    await expect(
      run(
        `${prefSent} ${as(PREFECTORAL_LABE, `SELECT rapport_mensuel_commenter(${PREF_REPORT}, 'x');`)}`,
      ),
    ).rejects.toThrow(/ne peut plus être modifié/);
    const rows = await run(`${prefSent} ${prepare(PREFECTORAL_LABE)}
      SELECT count(*)::int AS n, max(statut) AS statut FROM rapport_mensuel;`);
    expect(rows).toEqual([{ n: 1, statut: 'envoye' }]);
    await expect(
      run(
        `${prefSent} ${openContext(PREFECTORAL_LABE)} UPDATE rapport_mensuel SET contenu = '{}'::jsonb;`,
      ),
    ).rejects.toThrow(/ne peut plus être modifié/);
    await expect(
      run(`${prefSent} ${openContext(PREFECTORAL_LABE)} DELETE FROM rapport_mensuel;`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('Critère 1 : cloisonnement et renvoi', () => {
  const visible = (email: string, before = prefSent) =>
    run(`${before} ${openContext(email)} SELECT count(*)::int AS n FROM rapport_mensuel;`);

  it('le régional de la région lit le rapport envoyé ; ni Kankan, ni la DG, ni le Comité', async () => {
    expect(await visible(REGIONAL_LABE)).toEqual([{ n: 1 }]);
    for (const email of [REGIONAL_KANKAN, PREFECTORAL_KANKAN, DG, COMITE])
      expect(await visible(email)).toEqual([{ n: 0 }]);
  });

  it('un brouillon reste invisible du régional', async () => {
    expect(await visible(REGIONAL_LABE, prepare(PREFECTORAL_LABE))).toEqual([{ n: 0 }]);
  });

  const returned = `${prefSent}
    ${as(REGIONAL_LABE, `SELECT rapport_mensuel_renvoyer(${PREF_REPORT}, 'Délais de l’étape 2 à expliquer.');`)}`;

  it('renvoi motivé par le régional : auteur prévenu, nouvelle version, l’ancienne gardée', async () => {
    const rows = await run(`${returned}
      SELECT (SELECT count(*)::int FROM notification n JOIN utilisateur u ON u.id = n.destinataire_id
               WHERE n.modele = 'rapport.renvoye' AND u.email = '${PREFECTORAL_LABE}') AS prevenu;`);
    expect(rows).toEqual([{ prevenu: 2 }]);
    const versions = await run(`${returned} ${prepare(PREFECTORAL_LABE)}
      SELECT version, statut, renvoi_motif, commentaire FROM rapport_mensuel ORDER BY version;`);
    expect(versions).toEqual([
      {
        version: 1,
        statut: 'renvoye',
        renvoi_motif: 'Délais de l’étape 2 à expliquer.',
        commentaire: 'Deux visites reportées pour cause de pluie.',
      },
      {
        version: 2,
        statut: 'brouillon',
        renvoi_motif: null,
        commentaire: 'Deux visites reportées pour cause de pluie.',
      },
    ]);
  });

  it('renvoi : destinataire seulement, motif obligatoire, rapport envoyé seulement', async () => {
    const back = (email: string, motif = 'À revoir.') =>
      `${prefSent} ${as(email, `SELECT rapport_mensuel_renvoyer(${PREF_REPORT}, '${motif}');`)}`;
    await expect(run(back(PREFECTORAL_LABE))).rejects.toThrow(/réservé à son destinataire/);
    await expect(run(back(DG))).rejects.toThrow(/introuvable/);
    await expect(run(back(REGIONAL_KANKAN))).rejects.toThrow(/introuvable/);
    await expect(run(back(REGIONAL_LABE, ' '))).rejects.toThrow(/motif du renvoi obligatoire/);
    await expect(
      run(
        `${returned} ${as(REGIONAL_LABE, `SELECT rapport_mensuel_renvoyer((SELECT id FROM rapport_mensuel), 'x');`)}`,
      ),
    ).rejects.toThrow(/seul un rapport envoyé/);
  });

  it('le préfectoral ne peut pas renvoyer son propre rapport par une écriture directe', async () => {
    await expect(
      run(`${prefSent} ${openContext(PREFECTORAL_LABE)}
        UPDATE rapport_mensuel SET statut = 'renvoye', renvoi_motif = 'x',
               renvoye_par = contexte_utilisateur(), renvoye_le = now();`),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('Critère 1 : rapport régional, regroupement et envoi à la DG', () => {
  it('regroupe les préfectures : Labé reçue avec son commentaire, les autres manquantes', async () => {
    const rows = await run(`${prefSent} ${prepare(REGIONAL_LABE)}
      SELECT niveau, prefecture_id, region_admin_id,
             contenu -> 'anomalies' -> 'rapportsManquants' AS manquants,
             jsonb_array_length(contenu -> 'prefectures') AS prefectures,
             (SELECT p FROM jsonb_array_elements(contenu -> 'prefectures') p
               WHERE p ->> 'prefecture' = 'Labé') AS labe
        FROM rapport_mensuel WHERE niveau = 'regional';`);
    const [report] = rows as {
      manquants: number;
      prefectures: number;
      labe: Record<string, unknown>;
    }[];
    expect(rows[0]).toMatchObject({ niveau: 'regional', prefecture_id: null, region_admin_id: 4 });
    expect(report!.manquants).toBe(report!.prefectures - 1);
    expect(report!.labe).toMatchObject({
      rapport: 'recu',
      version: 1,
      commentaire: 'Deux visites reportées pour cause de pluie.',
    });
  });

  const regSent = `${prefSent} ${prepare(REGIONAL_LABE)} ${send(REGIONAL_LABE, REG_REPORT)}`;

  it('envoi à la DG : prévenue, elle le lit ; le Comité et Kankan non', async () => {
    const rows = await run(`${regSent}
      SELECT (SELECT count(*)::int FROM notification n JOIN utilisateur u ON u.id = n.destinataire_id
               WHERE n.modele = 'rapport.recu' AND u.role_code = 'dg') AS dg;`);
    expect(rows).toEqual([{ dg: 2 }]);
    const seen = (email: string) =>
      run(`${regSent} ${openContext(email)}
        SELECT count(*)::int AS n FROM rapport_mensuel WHERE niveau = 'regional';`);
    expect(await seen(DG)).toEqual([{ n: 1 }]);
    expect(await seen(COMITE)).toEqual([{ n: 0 }]);
    expect(await seen(REGIONAL_KANKAN)).toEqual([{ n: 0 }]);
  });

  it('la DG renvoie le rapport régional avec un motif ; le régional est prévenu', async () => {
    const rows = await run(`${regSent}
      ${as(DG, `SELECT rapport_mensuel_renvoyer(${REG_REPORT}, 'Couverture à commenter.');`)}
      SELECT (SELECT count(*)::int FROM notification n JOIN utilisateur u ON u.id = n.destinataire_id
               WHERE n.modele = 'rapport.renvoye' AND u.email = '${REGIONAL_LABE}') AS regional;`);
    expect(rows).toEqual([{ regional: 2 }]);
  });
});

describe('Critère 2 : historique des exports', () => {
  const exportBoard = (email: string, format = 'pdf') =>
    as(email, `SELECT export_creer('tableau_de_bord', '${format}') AS id;`);

  it('export du tableau de bord : photographie des indicateurs de sa zone, trace au journal', async () => {
    const rows = await run(`${exportBoard(PREFECTORAL_LABE)}
      SELECT type, format, statut, prefecture_id, region_admin_id,
             contenu ->> 'zone' AS zone, contenu -> 'indicateurs' ->> 'profil' AS profil,
             (contenu -> 'indicateurs' ->> 'enregistres')::int AS enregistres,
             (SELECT count(*)::int FROM journal_audit WHERE action = 'export.cree') AS audit
        FROM rapport_export;`);
    expect(rows).toEqual([
      {
        type: 'tableau_de_bord',
        format: 'pdf',
        statut: 'pret',
        prefecture_id: 4,
        region_admin_id: 4,
        zone: 'Labé',
        profil: 'prefectoral',
        enregistres: 2,
        audit: 1,
      },
    ]);
  });

  it('historique : ses exports et ceux de sa zone ; DG tout ; Comité les siens', async () => {
    const before = `${exportBoard(PREFECTORAL_LABE)} ${exportBoard(PREFECTORAL_KANKAN, 'xlsx')}
      ${exportBoard(COMITE)}`;
    const seen = async (email: string) =>
      (
        await run(`${before} ${openContext(email)}
          SELECT count(*)::int AS n FROM rapport_export;`)
      )[0]!.n;
    expect(await seen(DG)).toBe(3);
    expect(await seen(REGIONAL_LABE)).toBe(1);
    expect(await seen(PREFECTORAL_LABE)).toBe(1);
    expect(await seen(PREFECTORAL_KANKAN)).toBe(1);
    expect(await seen(COMITE)).toBe(1);
  });

  it('export d’un rapport : seulement s’il est visible ; photographie du rapport', async () => {
    const rows = await run(`${prefSent}
      ${as(REGIONAL_LABE, `SELECT export_creer('rapport_mensuel', 'xlsx', ${PREF_REPORT});`)}
      SELECT contenu ->> 'zone' AS zone, contenu ->> 'statut' AS statut,
             contenu ->> 'commentaire' AS commentaire, periode_debut = ${LAST_MONTH} AS periode
        FROM rapport_export;`);
    expect(rows).toEqual([
      {
        zone: 'Labé',
        statut: 'envoye',
        commentaire: 'Deux visites reportées pour cause de pluie.',
        periode: true,
      },
    ]);
    await expect(
      run(
        `${prefSent} ${as(REGIONAL_KANKAN, `SELECT export_creer('rapport_mensuel', 'pdf', ${PREF_REPORT});`)}`,
      ),
    ).rejects.toThrow(/introuvable/);
  });

  it('type ou format inconnu, citoyen : refus ; historique en ajout seul', async () => {
    await expect(
      run(as(PREFECTORAL_LABE, `SELECT export_creer('tableau_de_bord', 'csv');`)),
    ).rejects.toThrow(/format inconnu/);
    await expect(run(as(PREFECTORAL_LABE, `SELECT export_creer('autre', 'pdf');`))).rejects.toThrow(
      /type inconnu/,
    );
    await expect(run(exportBoard('aminata@exemple.gn'))).rejects.toThrow(/réservé/);
    for (const write of [
      `UPDATE rapport_export SET format = 'xlsx'`,
      `DELETE FROM rapport_export`,
    ])
      await expect(
        run(`${exportBoard(PREFECTORAL_LABE)} ${openContext(PREFECTORAL_LABE)} ${write};`),
      ).rejects.toThrow(/permission denied/);
  });
});
