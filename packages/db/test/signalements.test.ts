// US-100 : traiter les signalements de danger et d'effets indésirables (UC-08, UC-54,
// R-SAN-01 à 03). Jeu d'exemple : REC-2041 certifié (Labé), PL-001 validée, PL-005 en revue ;
// deux signalements déjà ouverts (SIG-00001 grave, SIG-00002 faible). Chaque cas part du même
// état (transaction annulée).
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const COMMITTEE = 'comite@sabou-sante.gn';
const DG = 'dg@sabou-sante.gn';
const REGIONAL = 'regional.labe@sabou-sante.gn';

const run = (sql: string) => lastRows(db.url.app, sql);
const deposit = (code: string, gravite = 'grave', contact = 'NULL') =>
  `SELECT signalement_deposer('danger', '${code}', '${gravite}',
     'Vomissements répétés après la première prise.', ${contact}) AS reference;`;
// Les numéros ne reviennent pas en arrière à l'annulation d'une transaction : le dernier
// signalement déposé se désigne par « dernier »
const LAST = '(SELECT signalement_reference(max(id)) FROM signalement_sanitaire)';
const decide = (reference: string, decision: string, motif = "'Examen du Comité'") =>
  `${openContext(COMMITTEE)} SELECT signalement_decider(${
    reference === 'dernier' ? LAST : `'${reference}'`
  }, '${decision}', ${motif}) AS decision;`;
const recipe = `SELECT r.statut,
  (SELECT string_agg(n.modele || ':' || (n.parametres->>'statut'), ',' ORDER BY n.id)
     FROM notification n WHERE n.objet_id = r.code) AS sms
  FROM recette r WHERE r.code = 'REC-2041';`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Dépôt public, sans compte', () => {
  it('traitement publié ou plante validée : référence remise, prefecture du praticien, contact gardé', async () => {
    const rows = await run(`${deposit('rec-2041', 'grave', "' 622 00 00 00 '")}
      ${deposit('PL-001', 'faible')}
      ${openContext(COMMITTEE)}
      SELECT signalement_reference(id) ~ '^SIG-[0-9]{5}$' AS reference, objet_type, gravite, statut, contact,
             prefecture_id IS NOT NULL AS zone, auteur_id
        FROM signalement_sanitaire WHERE id > 2 ORDER BY id;`);
    expect(rows).toEqual([
      {
        reference: true,
        objet_type: 'recette',
        gravite: 'grave',
        statut: 'recu',
        contact: '622 00 00 00',
        zone: true,
        auteur_id: null,
      },
      {
        reference: true,
        objet_type: 'plante',
        gravite: 'faible',
        statut: 'recu',
        contact: null,
        zone: false,
        auteur_id: null,
      },
    ]);
  });

  it('refusé : code inconnu, traitement non publié, plante en revue, description trop courte', async () => {
    await expect(run(deposit('REC-9999'))).rejects.toThrow(/code REC-9999 inconnu/);
    await expect(run(deposit('REC-2043'))).rejects.toThrow(/inconnu/); // transmis, pas publié
    await expect(run(deposit('PL-005'))).rejects.toThrow(/inconnu/);
    await expect(
      run(`SELECT signalement_deposer('danger', 'REC-2041', 'grave', 'Court')`),
    ).rejects.toThrow(/10 à 2000 caractères/);
    await expect(
      run(`SELECT signalement_deposer('autre', 'REC-2041', 'grave', 'Description assez longue')`),
    ).rejects.toThrow(/type invalide/);
  });

  it('l’API n’écrit pas en direct, et seul le Comité lit les signalements (contact compris)', async () => {
    await expect(
      run(`INSERT INTO signalement_sanitaire (type, objet_type, objet_id, description)
           VALUES ('danger', 'recette', 1, 'Écrit en direct')`),
    ).rejects.toThrow(/permission denied/);
    const count = (email: string) =>
      run(`${openContext(email)} SELECT count(*)::int AS n FROM signalement_sanitaire;`);
    expect(await count(COMMITTEE)).toEqual([{ n: 2 }]);
    expect(await count(DG)).toEqual([{ n: 0 }]);
    expect(await count(REGIONAL)).toEqual([{ n: 0 }]);
    expect(await run('SELECT count(*)::int AS n FROM signalement_sanitaire;')).toEqual([{ n: 0 }]);
  });
});

// Le site public n'affiche que les traitements certifiés (R-REC-08) : « en ligne » = certifié
describe('Critère : décision motivée (aucune action, révision, suspension, retrait)', () => {
  it('suspension : le traitement quitte le site aussitôt ; signalement clos, SMS au praticien', async () => {
    const rows = await run(`${decide('SIG-00001', 'suspension')}
      SELECT (SELECT statut = 'certifiee' FROM recette WHERE code = 'REC-2041') AS en_ligne,
             (SELECT statut || ':' || decision || ':' || motif_decision
                FROM signalement_sanitaire WHERE id = 1) AS signalement;
      `);
    expect(rows).toEqual([{ en_ligne: false, signalement: 'clos:suspension:Examen du Comité' }]);
    await expect(
      run(`${decide('SIG-00001', 'suspension')} ${decide('SIG-00001', 'retrait')}`),
    ).rejects.toThrow(/déjà clos/);
  });

  it('révision : retour au praticien en brouillon, SMS de renvoi', async () => {
    expect(await run(`${decide('SIG-00001', 'revision')} ${recipe}`)).toEqual([
      { statut: 'brouillon', sms: 'recette.renvoyee:brouillon' },
    ]);
  });

  it('retrait : définitif, aucune transition ne le ramène', async () => {
    expect(await run(`${decide('SIG-00001', 'retrait')} ${recipe}`)).toEqual([
      { statut: 'retiree', sms: 'recette.retiree:retiree' },
    ]);
    await expect(
      run(`${decide('SIG-00001', 'retrait')}
           SELECT traitement_suspension_lever('REC-2041', 'Essai');`),
    ).rejects.toThrow(/introuvable/);
  });

  it('aucune action : le traitement reste en ligne ; motif obligatoire', async () => {
    expect(await run(`${decide('SIG-00001', 'aucune_action')} ${recipe}`)).toEqual([
      { statut: 'certifiee', sms: null },
    ]);
    await expect(run(decide('SIG-00001', 'aucune_action', "'  '"))).rejects.toThrow(
      /motif obligatoire/,
    );
  });

  it('plante : la révision la renvoie à la revue du Comité ; suspension et retrait sans objet', async () => {
    const plant = `${deposit('PL-001', 'moyenne')}`;
    expect(
      await run(`${plant} ${decide('dernier', 'revision')}
        SELECT statut FROM plante WHERE code = 'PL-001';`),
    ).toEqual([{ statut: 'en_revue' }]);
    await expect(run(`${plant} ${decide('dernier', 'suspension')}`)).rejects.toThrow(
      /sans objet pour une plante/,
    );
  });

  it('réservée au Comité : la DG ne décide pas d’un signalement', async () => {
    await expect(
      run(`${openContext(DG)} SELECT signalement_decider('SIG-00001', 'retrait', 'Essai');`),
    ).rejects.toThrow(/réservée au Comité scientifique/);
  });
});

describe('Levée d’une suspension par le Comité, avec un motif', () => {
  it('le traitement revient en ligne ; SMS de levée distinct d’une certification', async () => {
    const rows = await run(`${decide('SIG-00001', 'suspension')}
      SELECT traitement_suspension_lever('REC-2041', 'Effet sans lien avec le traitement');
      SELECT r.statut,
             (SELECT n.parametres->>'de' FROM notification n
               WHERE n.objet_id = r.code ORDER BY n.id DESC LIMIT 1) AS sms_de,
             r.publiee_le IS NOT NULL AS publie
        FROM recette r WHERE r.code = 'REC-2041';`);
    expect(rows).toEqual([{ statut: 'certifiee', sms_de: 'suspendue', publie: true }]);
  });

  it('motif obligatoire ; la DG ne lève pas par cette voie', async () => {
    await expect(
      run(`${decide('SIG-00001', 'suspension')}
           SELECT traitement_suspension_lever('REC-2041', '');`),
    ).rejects.toThrow(/motif obligatoire/);
    await expect(
      run(`${decide('SIG-00001', 'suspension')} ${openContext(DG)}
           SELECT traitement_suspension_lever('REC-2041', 'Essai');`),
    ).rejects.toThrow(/réservée au Comité/);
  });
});

describe('Contact effacé 12 mois après la clôture', () => {
  it('seuls les signalements clos depuis plus de 12 mois perdent leur contact', async () => {
    const rows = await lastRows(
      db.url.postgres,
      `UPDATE signalement_sanitaire SET contact = '622 11 11 11', statut = 'clos',
              decision = 'aucune_action', motif_decision = 'Essai', traite_par = 4,
              traite_le = CASE id WHEN 1 THEN now() - interval '13 months'
                                  ELSE now() - interval '11 months' END;
       CREATE TEMP TABLE effaces AS SELECT signalements_effacer_contacts() AS n;
       SELECT (SELECT n FROM effaces) AS effaces,
              string_agg(id || ':' || COALESCE(contact, '-'), ',' ORDER BY id) AS contacts
         FROM signalement_sanitaire;`,
    );
    expect(rows).toEqual([{ effaces: 1, contacts: '1:-,2:622 11 11 11' }]);
  });
});
