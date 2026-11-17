// US-062 : la certification d'un traitement est bloquée s'il est incomplet (UC-62, R-REC-06,
// R-REC-08, R-REC-11, R-PLA-06). Traitements d'essai préparés par le super-utilisateur, à
// l'état « expertisé », puis certifiés par la DG (traitement_decider), dans une transaction
// toujours annulée.
//   - PR-1041 : pas encore certifié ; PR-1042 : certifié, GOLD ; PR-1044 : certifié, gratuit,
//     déjà 1 traitement certifié (REC-2044).
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const DG = 'dg@sabou-sante.gn';

interface Recipe {
  code: string;
  praticien: number;
  plante?: number;
  sections?: boolean;
  statut?: 'expertisee' | 'certifiee';
}
// Traitement complet (Néré, validée ; 4 sections ; cycle), sauf indication contraire
const make = ({ code, praticien, plante = 3, sections = true, statut = 'expertisee' }: Recipe) => `
  INSERT INTO recette (code, praticien_id, maladie_id, titre_fr, cycle_duree_jours, cycle_prises_par_jour)
  VALUES ('${code}', ${praticien}, 1, 'Essai ${code}', 3, 2);
  INSERT INTO recette_plante (recette_id, plante_id, ordre)
  SELECT id, ${plante}, 1 FROM recette WHERE code = '${code}';
  INSERT INTO recette_section (recette_id, type_code, texte_fr)
  SELECT r.id, t.code, 'Essai' FROM recette r CROSS JOIN section_type t
   WHERE r.code = '${code}' AND t.obligatoire ${sections ? '' : "AND t.code <> 'effets_indesirables'"};
  UPDATE recette SET statut = '${statut}' WHERE code = '${code}';`;
// Préparation par le super-utilisateur, puis certification par la DG dans son contexte
const certify = (setup: string, code: string) =>
  lastRows(
    db.url.postgres,
    `${setup} SET LOCAL ROLE sabou_app; ${openContext(DG)}
     SELECT sabou.recette_blocages(id) AS avant FROM sabou.recette WHERE code = '${code}';
     SELECT traitement_decider('${code}', 'expertisee', 'avance', NULL) AS statut;`,
  );
const blockers = (setup: string, code: string) =>
  lastRows(
    db.url.postgres,
    `${setup} SET LOCAL ROLE sabou_app; ${openContext(DG)}
     SELECT recette_blocages(id) AS blocages FROM recette WHERE code = '${code}';`,
  );

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : refus si une plante n’est pas validée, si une section obligatoire manque', () => {
  it('plante « en revue » : certification refusée, motif lisible avant la décision', async () => {
    const setup = make({ code: 'REC-9501', praticien: 2, plante: 5 });
    expect(await blockers(setup, 'REC-9501')).toEqual([{ blocages: ['plante_en_revue'] }]);
    await expect(certify(setup, 'REC-9501')).rejects.toThrow(
      'toutes les plantes doivent être validées par le Comité',
    );
  });

  it('section « effets indésirables » absente : certification refusée', async () => {
    const setup = make({ code: 'REC-9502', praticien: 2, sections: false });
    expect(await blockers(setup, 'REC-9502')).toEqual([{ blocages: ['sections'] }]);
    await expect(certify(setup, 'REC-9502')).rejects.toThrow('sections obligatoires manquantes');
  });

  it('traitement complet d’un praticien certifié : certifié, aucun motif', async () => {
    const setup = make({ code: 'REC-9503', praticien: 2 });
    expect(await blockers(setup, 'REC-9503')).toEqual([{ blocages: [] }]);
    expect(await certify(setup, 'REC-9503')).toEqual([{ statut: 'certifiee' }]);
  });
});

describe('Critère : refus si le praticien n’a pas de certificat actif', () => {
  it('praticien pas encore certifié (dossier en cours) : refusé', async () => {
    const setup = make({ code: 'REC-9504', praticien: 1 });
    expect(await blockers(setup, 'REC-9504')).toEqual([{ blocages: ['certificat'] }]);
    await expect(certify(setup, 'REC-9504')).rejects.toThrow(
      'le praticien doit être certifié avec un certificat actif',
    );
  });

  it('certificat expiré : refusé', async () => {
    const setup = `${make({ code: 'REC-9505', praticien: 2 })}
      UPDATE certificat SET expire_le = current_date - 1 WHERE praticien_id = 2;`;
    await expect(certify(setup, 'REC-9505')).rejects.toThrow('certificat actif');
  });
});

describe('Critère : au-delà de 3 traitements certifiés en formule gratuite (après la grâce de 30 jours)', () => {
  // PR-1044 (gratuit) a déjà REC-2044 certifié : 2 de plus font 3
  const three = `${make({ code: 'REC-9510', praticien: 4, statut: 'certifiee' })}
                 ${make({ code: 'REC-9511', praticien: 4, statut: 'certifiee' })}`;

  it('formule gratuite : le 3e passe, le 4e est refusé', async () => {
    const third = `${make({ code: 'REC-9510', praticien: 4, statut: 'certifiee' })}
                   ${make({ code: 'REC-9512', praticien: 4 })}`;
    expect(await certify(third, 'REC-9512')).toEqual([{ statut: 'certifiee' }]);
    const fourth = `${three} ${make({ code: 'REC-9512', praticien: 4 })}`;
    expect(await blockers(fourth, 'REC-9512')).toEqual([{ blocages: ['quota'] }]);
    await expect(certify(fourth, 'REC-9512')).rejects.toThrow(
      'la formule gratuite est limitée à 3 traitements certifiés',
    );
  });

  // PR-1042 (GOLD) avec 3 traitements certifiés (REC-2042 et deux d'essai)
  const goldEndedDaysAgo = (days: number) => `
    ${make({ code: 'REC-9520', praticien: 2, statut: 'certifiee' })}
    ${make({ code: 'REC-9521', praticien: 2, statut: 'certifiee' })}
    UPDATE abonnement SET fin = current_date - ${days} WHERE praticien_id = 2;
    ${make({ code: 'REC-9522', praticien: 2 })}`;

  it('GOLD expiré depuis moins de 30 jours (grâce) : le 4e est encore certifié', async () => {
    expect(await certify(goldEndedDaysAgo(10), 'REC-9522')).toEqual([{ statut: 'certifiee' }]);
    expect(await certify(goldEndedDaysAgo(30), 'REC-9522')).toEqual([{ statut: 'certifiee' }]);
  });

  it('GOLD expiré depuis plus de 30 jours : retour à la formule gratuite, le 4e est refusé', async () => {
    await expect(certify(goldEndedDaysAgo(31), 'REC-9522')).rejects.toThrow(
      'formule gratuite est limitée à 3',
    );
  });

  it('les traitements déjà certifiés restent publiés à la fin du GOLD (R-REC-11)', async () => {
    const rows = await lastRows(
      db.url.postgres,
      `${goldEndedDaysAgo(60)}
       SELECT string_agg(code, ',' ORDER BY code) AS certifies FROM sabou.recette
        WHERE praticien_id = 2 AND statut = 'certifiee';`,
    );
    expect(rows).toEqual([{ certifies: 'REC-2042,REC-9520,REC-9521' }]);
  });

  it('un traitement suspendu puis rétabli ne compte pas comme une nouvelle certification', async () => {
    const setup = `${three}
      UPDATE recette SET statut = 'suspendue' WHERE code = 'REC-9511';
      ${make({ code: 'REC-9512', praticien: 4, statut: 'certifiee' })}
      UPDATE recette SET statut = 'certifiee' WHERE code = 'REC-9511';
      SELECT statut FROM recette WHERE code = 'REC-9511';`;
    expect(await lastRows(db.url.postgres, `SET search_path = sabou, public; ${setup}`)).toEqual([
      { statut: 'certifiee' },
    ]);
  });
});
