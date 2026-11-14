// US-047 : la DG prononce un rejet définitif (UC-61, R-CER-04, R-QR-06). Décisions du
// maître d'œuvre des 12 et 14 novembre 2026 (05_Choix_Techniques.md §2.36). Exécuté sous le
// rôle de l'API (sabou_app), dans le contexte de chaque acteur, sur le jeu d'exemple ;
// chaque cas part du même état (transaction annulée).
//   PR-1041 : dossier DS-1041 en cours (étape 1), aucun certificat
//   PR-1042 : certifié, sans dossier en cours, certificat SAB-2026-PR1042-KX7, REC-2042 certifié
//   PR-1045 : certifié, REC-2043 « transmis » au Comité (en cours d'examen)
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
// Précision écrite par la DG (apostrophe doublée pour SQL)
const DETAIL = "Diplôme falsifié, confirmé par l''école";

// Rejet par le compte donné ; avis du Comité seulement pour une pratique dangereuse
const reject = (
  praticien: string,
  options: { as?: string; motif?: string; detail?: string; avis?: string } = {},
) => `${openContext(options.as ?? DG)}
  SELECT (praticien_rejeter(p.id, contexte_utilisateur(), '${options.motif ?? 'fraude_documentaire'}',
                            '${options.detail ?? DETAIL}'
                            ${options.avis ?? ''})).recours_jusquau::text AS recours
    FROM praticien p WHERE p.code = '${praticien}';`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère 1 : un autre rôle que la DG ne peut pas prononcer de rejet définitif', () => {
  it.each([
    'regional.labe@sabou-sante.gn',
    'prefectoral.labe@sabou-sante.gn',
    'comite@sabou-sante.gn',
    'm.diallo@exemple.gn',
  ])('%s : refusé, rien ne change', async (email) => {
    await expect(attempt(reject('PR-1042', { as: email }))).rejects.toThrow(
      'Le rejet définitif est réservé à la Direction Générale',
    );
  });

  it('la DG ne passe plus par dossier_transition : la décision complète est exigée', async () => {
    await expect(
      attempt(`${openContext(DG)}
        SELECT dossier_transition(1, 'rejet_definitif', contexte_utilisateur(), 'Fraude')`),
    ).rejects.toThrow('le rejet définitif se prononce par praticien_rejeter');
  });
});

describe('Critère 2 : praticien déjà certifié, sans dossier en cours (décision du 14/11)', () => {
  it('le praticien passe « rejeté », son certificat est révoqué avec le motif', async () => {
    const rows = await lastRows(`${reject('PR-1042')}
      SELECT p.statut AS praticien, c.statut AS certificat, c.motif_revocation AS motif,
             c.revoque_le IS NOT NULL AS revoque_le
        FROM praticien p JOIN certificat c ON c.praticien_id = p.id WHERE p.code = 'PR-1042';`);
    expect(rows).toEqual([
      {
        praticien: 'rejete',
        certificat: 'revoque',
        motif: 'Rejet définitif : Fraude documentaire',
        revoque_le: true,
      },
    ]);
  });

  it('le QR du certificat répond « rouge » et le praticien quitte l’annuaire (R-QR-05, R-CER-08)', async () => {
    const rows = await lastRows(`${reject('PR-1042')}
      SELECT (SELECT count(*)::int FROM praticien p JOIN certificat c ON c.praticien_id = p.id
               WHERE p.code = 'PR-1042' AND p.statut = 'certifie' AND c.statut = 'actif') AS annuaire,
             (SELECT CASE WHEN c.statut = 'revoque' THEN 'rouge' ELSE 'autre' END
                FROM certificat c WHERE c.numero = 'SAB-2026-PR1042-KX7') AS verdict;`);
    expect(rows).toEqual([{ annuaire: 0, verdict: 'rouge' }]);
  });

  it('les traitements certifiés passent « suspendus », historique et audit à l’appui', async () => {
    const rows = await lastRows(`${reject('PR-1042')}
      SELECT r.code, r.statut,
             (SELECT row(h.statut_depart, h.statut_arrivee, h.motif)::text FROM recette_historique h
               WHERE h.recette_id = r.id ORDER BY h.id DESC LIMIT 1) AS historique,
             (SELECT j.details->>'automatique' FROM journal_audit j
               WHERE j.action = 'recette.suspendue' AND j.objet_id = r.code) AS automatique
        FROM recette r JOIN praticien p ON p.id = r.praticien_id WHERE p.code = 'PR-1042';`);
    expect(rows).toEqual([
      {
        code: 'REC-2042',
        statut: 'suspendue',
        historique: '(certifiee,suspendue,"Rejet définitif du praticien")',
        automatique: 'true',
      },
    ]);
  });

  it('la suspension est réversible : la DG peut le recertifier si le recours aboutit', async () => {
    // Le recours (US-101) rendra d'abord au praticien son statut et un certificat actif
    const rows = await lastRows(`${reject('PR-1042')}
      UPDATE praticien SET statut = 'certifie' WHERE code = 'PR-1042';
      UPDATE certificat SET statut = 'actif', revoque_le = NULL, motif_revocation = NULL
       WHERE numero = 'SAB-2026-PR1042-KX7';
      SELECT recette_transition(r.id, 'certifiee', contexte_utilisateur()) AS statut
        FROM recette r WHERE r.code = 'REC-2042';`);
    expect(rows).toEqual([{ statut: 'certifiee' }]);
  });

  it('le praticien est informé par un seul SMS, avec la date limite du recours (+30 jours)', async () => {
    const rows = await lastRows(`${reject('PR-1042')}
      SELECT n.modele, n.objet_type, n.objet_id, n.parametres,
             u.email AS destinataire,
             (n.parametres->>'recoursJusquau')::date
               = (now() AT TIME ZONE 'Africa/Conakry')::date + 30 AS trente_jours
        FROM notification n JOIN utilisateur u ON u.id = n.destinataire_id
       WHERE n.created_at = now();`);
    expect(rows).toEqual([
      {
        modele: 'praticien.rejet_definitif',
        objet_type: 'praticien',
        objet_id: 'PR-1042',
        parametres: { recoursJusquau: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
        destinataire: 'm.diallo@exemple.gn',
        trente_jours: true,
      },
    ]);
  });

  it('la décision est conservée et tracée au journal d’audit', async () => {
    const rows = await lastRows(`${reject('PR-1042')}
      SELECT r.motif, r.motif_detail, r.dossier_id, c.numero AS certificat, u.email AS decide_par,
             j.details - 'rejet' - 'recoursJusquau' AS audit
        FROM rejet_definitif r
        JOIN certificat c ON c.id = r.certificat_id
        JOIN utilisateur u ON u.id = r.decide_par
        JOIN journal_audit j ON j.action = 'praticien.rejet_definitif' AND j.objet_id = 'PR-1042';`);
    expect(rows).toEqual([
      {
        motif: 'fraude_documentaire',
        motif_detail: "Diplôme falsifié, confirmé par l'école",
        dossier_id: null,
        certificat: 'SAB-2026-PR1042-KX7',
        decide_par: DG,
        audit: {
          motif: 'fraude_documentaire',
          certificat: 'SAB-2026-PR1042-KX7',
          traitementsSuspendus: 1,
        },
      },
    ]);
  });
});

describe('Critère 2 : dossier en cours, clos par le rejet', () => {
  it('le dossier passe « rejeté définitivement » à son étape, la décision entre dans son historique', async () => {
    const identity = { motif: 'usurpation_identite', detail: "Pièce d''identité d''un tiers" };
    const rows = await lastRows(`${reject('PR-1041', identity)}
      SELECT d.statut, d.etape_courante AS etape, d.cloture_le IS NOT NULL AS clos, p.statut AS praticien,
             (SELECT row(h.etape_depart, h.etape_arrivee, h.decision, h.motif)::text
                FROM dossier_historique h WHERE h.dossier_id = d.id ORDER BY h.id DESC LIMIT 1) AS historique
        FROM dossier_certification d JOIN praticien p ON p.id = d.praticien_id WHERE d.code = 'DS-1041';`);
    expect(rows).toEqual([
      {
        statut: 'rejete_definitif',
        etape: 1,
        clos: true,
        praticien: 'rejete',
        historique: `(1,1,rejet_definitif,"Usurpation d'identité : Pièce d'identité d'un tiers")`,
      },
    ]);
  });

  it('le SMS porte le code du dossier', async () => {
    const rows = await lastRows(`${reject('PR-1041')}
      SELECT modele, objet_type, objet_id, parametres->>'dossier' AS dossier
        FROM notification WHERE created_at = now();`);
    expect(rows).toEqual([
      {
        modele: 'praticien.rejet_definitif',
        objet_type: 'dossier',
        objet_id: 'DS-1041',
        dossier: 'DS-1041',
      },
    ]);
  });
});

describe('Motif encadré (R-CER-04)', () => {
  const dangerous = (avis: string) => reject('PR-1042', { motif: 'pratique_dangereuse', avis });

  it('pratique dangereuse : date et référence de l’avis du Comité enregistrées', async () => {
    const rows = await lastRows(`${dangerous(`, current_date - 3, ' AV-2026-014 '`)}
      SELECT motif, avis_comite_le = current_date - 3 AS date, avis_comite_reference AS reference
        FROM rejet_definitif;`);
    expect(rows).toEqual([{ motif: 'pratique_dangereuse', date: true, reference: 'AV-2026-014' }]);
  });

  it.each([
    ['sans avis du Comité', ''],
    ['sans référence', `, current_date, NULL`],
    ['avec une référence vide', `, current_date, '   '`],
  ])('pratique dangereuse %s : refusée', async (_cas, avis) => {
    await expect(attempt(dangerous(avis))).rejects.toThrow();
  });

  it('refuse un avis du Comité daté après la décision', async () => {
    await expect(attempt(dangerous(`, current_date + 1, 'AV-2026-015'`))).rejects.toThrow(
      'ck_rejet_avis_anterieur',
    );
  });

  it('refuse un avis du Comité pour un autre motif', async () => {
    await expect(
      attempt(reject('PR-1042', { avis: `, current_date, 'AV-2026-016'` })),
    ).rejects.toThrow('ck_rejet_avis_comite');
  });

  it.each([
    ['un motif hors des trois cas', { motif: 'retard_de_paiement' }],
    ['une précision vide', { detail: '   ' }],
    ['une précision de plus de 1000 caractères', { detail: 'a'.repeat(1001) }],
  ])('refuse %s', async (_cas, options) => {
    await expect(attempt(reject('PR-1042', options))).rejects.toThrow('rejet_definitif');
  });
});

describe('Après le rejet', () => {
  it('refuse un second rejet du même praticien', async () => {
    await expect(attempt(`${reject('PR-1042')} ${reject('PR-1042')}`)).rejects.toThrow(
      'Praticien PR-1042 déjà rejeté définitivement',
    );
  });

  it('les traitements en cours d’examen gardent leur statut mais ne progressent plus', async () => {
    const rows = await lastRows(`${reject('PR-1045')}
      SELECT code, statut FROM recette WHERE code = 'REC-2043';`);
    expect(rows).toEqual([{ code: 'REC-2043', statut: 'transmise' }]);
    await expect(
      attempt(`${reject('PR-1045')} ${openContext('comite@sabou-sante.gn')}
        SELECT recette_transition(r.id, 'expertisee', contexte_utilisateur())
          FROM recette r WHERE r.code = 'REC-2043';`),
    ).rejects.toThrow('praticien rejeté définitivement, le traitement ne progresse plus');
  });

  it('le praticien peut encore retirer un traitement suspendu', async () => {
    const rows = await lastRows(`${reject('PR-1042')} ${openContext('m.diallo@exemple.gn')}
      SELECT recette_transition(r.id, 'retiree', contexte_utilisateur()) AS statut
        FROM recette r WHERE r.code = 'REC-2042';`);
    expect(rows).toEqual([{ statut: 'retiree' }]);
  });

  it('aucun nouveau dossier avant 12 mois, même sans dossier en cours au moment du rejet', async () => {
    await expect(
      attempt(`${reject('PR-1042')} ${openContext('m.diallo@exemple.gn')}
        INSERT INTO dossier_certification (praticien_id)
        SELECT id FROM praticien WHERE code = 'PR-1042';`),
    ).rejects.toThrow('nouveau dossier impossible moins de 12 mois après un rejet définitif');
  });

  it('la décision ne se modifie ni ne s’efface par l’API', async () => {
    for (const statement of [
      `UPDATE rejet_definitif SET motif_detail = 'Autre'`,
      `DELETE FROM rejet_definitif`,
    ]) {
      await expect(attempt(`${reject('PR-1042')} ${statement}`)).rejects.toThrow(
        'permission denied for table rejet_definitif',
      );
    }
  });

  it('hors de sa zone, un administrateur ne voit pas la décision (RLS)', async () => {
    const rows =
      await lastRows(`${reject('PR-1042')} ${openContext('regional.kankan@sabou-sante.gn')}
      SELECT count(*)::int AS visibles FROM rejet_definitif;`);
    expect(rows).toEqual([{ visibles: 0 }]);
  });
});
