// US-061 : faire avancer un traitement (UC-22, UC-42, UC-51, UC-62, R-REC-07). Traitement
// d'essai de Mamadou Diallo (PR-1042, certifié, GOLD, préfecture de Labé), soumis au Studio.
// Chaque cas part du même état (transaction annulée).
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const PRACTITIONER = 'm.diallo@exemple.gn';
const REGIONAL = 'regional.labe@sabou-sante.gn';
const OTHER_REGIONAL = 'regional.kindia@sabou-sante.gn';
const PREFECTORAL = 'prefectoral.labe@sabou-sante.gn';
const COMMITTEE = 'comite@sabou-sante.gn';
const DG = 'dg@sabou-sante.gn';

const FIELDS = {
  maladie: 'MA-001',
  titreFr: 'Circuit d’essai',
  cycleDureeJours: 5,
  cyclePrisesParJour: 1,
  plantes: [{ plante: 'PL-003', partie: 'gousses' }],
  sections: ['preparation', 'consommation', 'cycle', 'effets_indesirables'].map((type) => ({
    type,
    texteFr: `Essai ${type}`,
  })),
  consentement: true,
  visibilite: 'publique',
};
const CODE = `(SELECT code FROM recette WHERE titre_fr = 'Circuit d’essai')`;
const submitted = `${openContext(PRACTITIONER)}
  SELECT traitement_enregistrer(NULL, NULL, '${JSON.stringify(FIELDS).replace(/'/g, "''")}'::jsonb);
  SELECT traitement_soumettre(${CODE});`;
const decide = (email: string, seen: string, decision: 'avance' | 'renvoi', motif = 'NULL') =>
  `${openContext(email)} SELECT traitement_decider(${CODE}, '${seen}', '${decision}', ${motif}) AS statut;`;
const queue = (email: string) =>
  `${openContext(email)} SELECT string_agg(code, ',' ORDER BY code) AS codes FROM traitements_a_decider();`;
const run = (sql: string) => lastRows(db.url.app, sql);

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Le circuit complet : soumis → transmis → expertisé → certifié', () => {
  it('chaque acteur fait avancer le traitement à son tour ; historique et SMS à chaque étape', async () => {
    const rows = await run(`${submitted}
      ${decide(REGIONAL, 'soumise', 'avance')}
      ${decide(COMMITTEE, 'transmise', 'avance')}
      ${decide(DG, 'expertisee', 'avance')}
      SELECT r.statut, r.publiee_le IS NOT NULL AS publie,
             (SELECT string_agg(h.statut_depart || '>' || h.statut_arrivee || ':' || u.role_code, ','
                                ORDER BY h.id)
                FROM recette_historique h JOIN utilisateur u ON u.id = h.acteur_id
               WHERE h.recette_id = r.id) AS historique,
             (SELECT string_agg(n.modele, ',' ORDER BY n.id) FROM notification n
               WHERE n.objet_id = r.code) AS sms,
             (SELECT count(*)::int FROM journal_audit j WHERE j.objet_id = r.code
                 AND j.action LIKE 'recette.%') AS audit
        FROM recette r WHERE r.code = ${CODE};`);
    expect(rows).toEqual([
      {
        statut: 'certifiee',
        publie: true,
        historique:
          'brouillon>soumise:praticien,soumise>transmise:regional,transmise>expertisee:scientifique,expertisee>certifiee:dg',
        sms: 'recette.soumise,recette.transmise,recette.expertisee,recette.certifiee',
        audit: 5,
      },
    ]);
  });
});

describe('Critère : seul le rôle prévu, dans sa zone, peut faire chaque transition', () => {
  it('chaque file ne montre que les traitements qui attendent cet acteur', async () => {
    const labe = await run(`${submitted} ${queue(REGIONAL)}`);
    expect(labe[0]!.codes).toMatch(/^REC-\d{4,}$/);
    // Hors zone : le régional de Kindia ne voit pas le traitement de Labé
    expect(await run(`${submitted} ${queue(OTHER_REGIONAL)}`)).toEqual([{ codes: null }]);
    // Le Comité ne voit que les traitements transmis (REC-2043 du jeu d'exemple)
    expect(await run(`${submitted} ${queue(COMMITTEE)}`)).toEqual([{ codes: 'REC-2043' }]);
    expect(await run(`${submitted} ${queue(DG)}`)).toEqual([{ codes: null }]);
    expect(await run(`${submitted} ${queue(PREFECTORAL)}`)).toEqual([{ codes: null }]);
  });

  it('régional hors zone : traitement introuvable (le cloisonnement le masque)', async () => {
    await expect(
      run(`${submitted} ${decide(OTHER_REGIONAL, 'soumise', 'avance')}`),
    ).rejects.toThrow(/Traitement .* introuvable|null value/);
  });

  it('mauvais rôle : refusé (Comité, DG ou préfectoral sur un traitement soumis)', async () => {
    for (const email of [COMMITTEE, DG, PREFECTORAL]) {
      await expect(run(`${submitted} ${decide(email, 'soumise', 'avance')}`)).rejects.toThrow(
        /interdite pour l'acteur/,
      );
    }
  });

  it('le praticien ne fait pas avancer lui-même son traitement', async () => {
    await expect(run(`${submitted} ${decide(PRACTITIONER, 'soumise', 'avance')}`)).rejects.toThrow(
      /interdite|modifie ses traitements par le Studio/,
    );
  });

  it('statut changé entre-temps : refusé', async () => {
    await expect(
      run(
        `${submitted} ${decide(REGIONAL, 'soumise', 'avance')} ${decide(REGIONAL, 'soumise', 'avance')}`,
      ),
    ).rejects.toThrow(/statut changé entre-temps/);
  });
});

describe('Critère : un rejet exige un motif et renvoie à l’étape précédente', () => {
  it('sans motif : refusé', async () => {
    await expect(
      run(`${submitted} ${decide(REGIONAL, 'soumise', 'renvoi', "'  '")}`),
    ).rejects.toThrow(/motif obligatoire/);
  });

  it('régional : retour au brouillon ; Comité : retour aux soumis ; DG : retour au Comité', async () => {
    const back = (setup: string, email: string, seen: string) =>
      run(
        `${submitted} ${setup} ${decide(email, seen, 'renvoi', "'Partie utilisée à préciser.'")}`,
      );
    expect(await back('', REGIONAL, 'soumise')).toEqual([{ statut: 'brouillon' }]);
    const transmitted = decide(REGIONAL, 'soumise', 'avance');
    expect(await back(transmitted, COMMITTEE, 'transmise')).toEqual([{ statut: 'soumise' }]);
    const expertised = `${transmitted} ${decide(COMMITTEE, 'transmise', 'avance')}`;
    expect(await back(expertised, DG, 'expertisee')).toEqual([{ statut: 'transmise' }]);
  });

  it('le renvoi est historisé avec son motif et notifié par un SMS de renvoi', async () => {
    const rows = await run(`${submitted}
      ${decide(REGIONAL, 'soumise', 'renvoi', "'Partie utilisée à préciser.'")}
      SELECT h.motif, n.modele, n.parametres
        FROM recette r
        JOIN recette_historique h ON h.recette_id = r.id AND h.statut_arrivee = 'brouillon'
        JOIN notification n ON n.objet_id = r.code AND n.modele = 'recette.renvoyee'
       WHERE r.code = ${CODE};`);
    expect(rows).toEqual([
      {
        motif: 'Partie utilisée à préciser.',
        modele: 'recette.renvoyee',
        parametres: { statut: 'brouillon' },
      },
    ]);
  });

  it('renvoyé au brouillon : le praticien le corrige et le soumet de nouveau', async () => {
    const rows = await run(`${submitted}
      ${decide(REGIONAL, 'soumise', 'renvoi', "'Partie utilisée à préciser.'")}
      ${openContext(PRACTITIONER)}
      SELECT traitement_enregistrer(${CODE}, (SELECT updated_at FROM recette WHERE code = ${CODE}),
               '${JSON.stringify({ ...FIELDS, plantes: [{ plante: 'PL-003', partie: 'gousses sèches' }] }).replace(/'/g, "''")}'::jsonb);
      SELECT traitement_soumettre(${CODE}) AS statut;`);
    expect(rows).toEqual([{ statut: 'soumise' }]);
  });
});

describe('Critère : un praticien rejeté définitivement n’a plus de traitement dans les files', () => {
  it('ses traitements n’apparaissent ni chez le régional ni au Comité', async () => {
    // Contexte de la DG d'abord : la fiche n'est pas modifiable dans le contexte du praticien
    const reject = `${openContext(DG)} RESET ROLE; UPDATE praticien SET statut = 'rejete' WHERE code = 'PR-1042';
                    SET LOCAL ROLE sabou_app;`;
    const rows = await lastRows(
      db.url.postgres,
      `SET LOCAL ROLE sabou_app; ${submitted} ${reject} ${queue(REGIONAL)}`,
    );
    expect(rows).toEqual([{ codes: null }]);
    const committee = await lastRows(
      db.url.postgres,
      `RESET ROLE; UPDATE praticien SET statut = 'rejete' WHERE code = 'PR-1045';
       SET LOCAL ROLE sabou_app; ${queue(COMMITTEE)}`,
    );
    // REC-2043 (transmis) appartient à PR-1045
    expect(committee).toEqual([{ codes: null }]);
  });
});
