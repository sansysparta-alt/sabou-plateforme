// US-082 : l'admin préfectoral numérise sur le terrain la recette orale d'un praticien
// (UC-32, R-GOV-02 ; décisions du maître d'œuvre du 19 novembre 2026, 05 §2.86).
// Exécuté sous le rôle de l'API (sabou_app) ; chaque cas part du même état (transaction annulée).
// Critère 1 : saisie assistée par les fonctions du Studio, rattachée au praticien, voix
//             possible après l'accord du praticien.
// Règle « celui qui enregistre ne vérifie pas » : l'auteur ne révise pas le texte et ne touche
// pas à la voix locale pendant « soumis » ; un autre agent de la préfecture, ou l'agent désigné
// par le régional, le fait.
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
// Agent de Labé et praticien de Labé (PR-1042, Mamadou Diallo) du jeu d'exemple
const AUTHOR = 'prefectoral.labe@sabou-sante.gn';
const KANKAN_AGENT = 'prefectoral.kankan@sabou-sante.gn';
const PRACTITIONER = 'm.diallo@exemple.gn';
const REGIONAL = 'regional.labe@sabou-sante.gn';
const SECOND_ID = '82828282-8282-4082-8082-828282828282';
const SECTIONS = ['preparation', 'consommation', 'cycle', 'effets_indesirables'];

const fields = {
  maladie: 'MA-001',
  titreFr: 'Numérisé sur le terrain',
  cycleDureeJours: 5,
  cyclePrisesParJour: 1,
  plantes: [{ plante: 'PL-003', partie: 'gousses' }],
  sections: SECTIONS.map((type) => ({ type, texteFr: `Saisie de l’agent : ${type}` })),
  consentement: true,
  visibilite: 'publique',
};
const json = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
const CODE = `(SELECT code FROM recette WHERE titre_fr = 'Numérisé sur le terrain')`;
const forPractitioner = (code = 'PR-1042') =>
  `SELECT set_config('sabou.numerisation_praticien', '${code}', true);`;
const save = `SELECT traitement_enregistrer(NULL, NULL, ${json(fields)}) AS code;`;
const numerised = `${openContext(AUTHOR)} ${forPractitioner()} ${save}`;
const submitted = `${numerised} SELECT traitement_soumettre(${CODE});`;
const secondAgent = `
  INSERT INTO utilisateur (email, telephone, prenom, nom, role_code, statut, keycloak_id, prefecture_id)
  VALUES ('prefectoral.second@exemple.test', '+224661240001', 'Fatoumata', 'Bah', 'prefectoral',
          'actif', '${SECOND_ID}', 4);`;
const revise = `SELECT traitement_section_reviser(${CODE}, 'preparation', 'Résumé vérifié') AS r;`;
const run = (sql: string) => lastRows(db.url.app, sql);

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère 1 : recette numérisée par l’agent, rattachée au praticien', () => {
  it('la recette est au nom du praticien, avec la mention de l’agent auteur', async () => {
    const rows = await run(`${numerised}
      SELECT p.code AS praticien, r.statut, u.email AS saisi_par
        FROM recette r JOIN praticien p ON p.id = r.praticien_id
        JOIN utilisateur u ON u.id = r.saisi_par WHERE r.code = ${CODE};`);
    expect(rows).toEqual([{ praticien: 'PR-1042', statut: 'brouillon', saisi_par: AUTHOR }]);
  });

  it('le praticien la retrouve dans son Studio ; sa propre saisie ne porte pas de mention', async () => {
    const rows = await run(`${numerised}
      ${openContext(PRACTITIONER)}
      SELECT traitement_enregistrer(${CODE}, (SELECT updated_at FROM recette WHERE code = ${CODE}),
                                    ${json({ ...fields, titreFr: 'Numérisé sur le terrain' })});
      SELECT r.saisi_par IS NOT NULL AS mention FROM recette r WHERE r.code = ${CODE};`);
    expect(rows).toEqual([{ mention: true }]);
    const own = await run(`${openContext(PRACTITIONER)}
      SELECT traitement_enregistrer(NULL, NULL, ${json({ ...fields, titreFr: 'Saisie du praticien' })});
      SELECT saisi_par FROM recette WHERE titre_fr = 'Saisie du praticien';`);
    expect(own).toEqual([{ saisi_par: null }]);
  });

  it('la mention ne se modifie pas, même par le propriétaire des tables', async () => {
    const rows = await run(`${numerised}
      UPDATE recette SET saisi_par = NULL WHERE code = ${CODE};
      SELECT saisi_par IS NOT NULL AS mention FROM recette WHERE code = ${CODE};`);
    expect(rows).toEqual([{ mention: true }]);
  });

  it('l’agent soumet la recette numérisée : elle entre dans le circuit', async () => {
    const rows = await run(`${submitted} SELECT statut FROM recette WHERE code = ${CODE};`);
    expect(rows).toEqual([{ statut: 'soumise' }]);
  });

  it('l’agent ne numérise que pour un praticien de sa préfecture', async () => {
    await expect(run(`${openContext(KANKAN_AGENT)} ${forPractitioner()} ${save}`)).rejects.toThrow(
      /introuvable dans votre préfecture/,
    );
  });

  it('sans praticien désigné, le Studio reste réservé aux praticiens', async () => {
    await expect(run(`${openContext(AUTHOR)} ${save}`)).rejects.toThrow(/réservé aux praticiens/);
  });

  it('un praticien ne peut pas se faire passer pour un autre par le paramètre', async () => {
    const rows = await run(`${openContext('i.bah@exemple.gn')} ${forPractitioner()}
      SELECT traitement_enregistrer(NULL, NULL, ${json({ ...fields, titreFr: 'Essai' })});
      SELECT p.code FROM recette r JOIN praticien p ON p.id = r.praticien_id WHERE r.titre_fr = 'Essai';`);
    expect(rows).not.toEqual([{ code: 'PR-1042' }]);
  });

  it('lectures de l’API : le praticien visé pour l’agent, le sien pour le praticien', async () => {
    const rows = await run(`${openContext(AUTHOR)} ${forPractitioner()}
      SELECT (SELECT code FROM praticien WHERE id = studio_praticien_id()) AS agent;`);
    expect(rows).toEqual([{ agent: 'PR-1042' }]);
    const own = await run(`${openContext(PRACTITIONER)} ${forPractitioner('PR-1041')}
      SELECT (SELECT code FROM praticien WHERE id = studio_praticien_id()) AS praticien;`);
    expect(own).toEqual([{ praticien: 'PR-1042' }]);
    const none = await run(`${openContext(AUTHOR)} SELECT studio_praticien_id() AS id;`);
    expect(none).toEqual([{ id: null }]);
  });

  it('liste des praticiens rattachables : ceux de la préfecture de l’agent', async () => {
    const rows = await run(`${openContext(AUTHOR)}
      SELECT count(*) FILTER (WHERE code = 'PR-1042')::int AS diallo,
             count(*) FILTER (WHERE statut = 'rejete')::int AS rejetes,
             count(*)::int > 0 AS non_vide
        FROM numerisation_praticiens();`);
    expect(rows).toEqual([{ diallo: 1, rejetes: 0, non_vide: true }]);
    const other = await run(`${openContext(KANKAN_AGENT)}
      SELECT count(*)::int AS n FROM numerisation_praticiens() WHERE code = 'PR-1042';`);
    expect(other).toEqual([{ n: 0 }]);
  });
});

describe('Celui qui enregistre ne vérifie pas', () => {
  it('l’agent auteur ne révise pas le texte de sa propre saisie', async () => {
    await expect(run(`${submitted} ${revise}`)).rejects.toThrow(/réservée/);
  });

  it('un autre agent de la préfecture la révise', async () => {
    const rows = await run(`${secondAgent} ${submitted}
      SELECT contexte_ouvrir('${SECOND_ID}'); ${revise}`);
    expect(rows).toEqual([{ r: true }]);
  });

  it('agent désigné par le régional : lui seul vérifie', async () => {
    // PR-1041 (Labé, dossier DS-1041 en cours) : un agent d'une autre préfecture de la région
    // est désigné sur ce dossier ; le second agent de Labé est alors écarté. La désignation
    // d'essai est écrite par le super-utilisateur, déclencheurs suspendus (sa règle est
    // prouvée par verificateur-designe.test.ts), puis tout passe par le rôle de l'API.
    const VOISIN_ID = '83838383-8383-4083-8083-838383838383';
    const prepared = `SET LOCAL search_path = sabou, public; ${secondAgent}
      INSERT INTO utilisateur (email, telephone, prenom, nom, role_code, statut, keycloak_id, prefecture_id)
      VALUES ('prefectoral.voisin@exemple.test', '+224661240002', 'Oumar', 'Baldé', 'prefectoral', 'actif',
              '${VOISIN_ID}',
              (SELECT id FROM prefecture WHERE region_admin_id = 4 AND id <> 4 ORDER BY id LIMIT 1));
      SET LOCAL session_replication_role = replica;
      UPDATE dossier_certification
         SET verificateur_designe = (SELECT id FROM utilisateur WHERE keycloak_id = '${VOISIN_ID}')
       WHERE code = 'DS-1041';
      SET LOCAL session_replication_role = origin;
      SET LOCAL ROLE sabou_app;
      ${openContext(AUTHOR)} ${forPractitioner('PR-1041')} ${save}
      SELECT traitement_soumettre(${CODE});`;
    await expect(
      lastRows(db.url.postgres, `${prepared} SELECT contexte_ouvrir('${SECOND_ID}'); ${revise}`),
    ).rejects.toThrow(/réservée/);
    const rows = await lastRows(
      db.url.postgres,
      `${prepared} SELECT contexte_ouvrir('${VOISIN_ID}'); ${revise}`,
    );
    expect(rows).toEqual([{ r: true }]);
  });

  it('une saisie du praticien reste révisée par l’agent de la préfecture (inchangé)', async () => {
    const rows = await run(`${openContext(PRACTITIONER)} ${save}
      SELECT traitement_soumettre(${CODE});
      ${openContext(AUTHOR)} ${revise}`);
    expect(rows).toEqual([{ r: true }]);
  });

  it('régional : la règle ne lui ouvre pas la révision', async () => {
    await expect(run(`${submitted} ${openContext(REGIONAL)} ${revise}`)).rejects.toThrow(
      /réservée/,
    );
  });
});
