// US-072 : valider les voix de sa langue dans l'atelier linguistique (UC-41, R-GOV-03,
// R-GOV-06, R-GOV-07). Traitement d'essai de Mamadou Diallo (PR-1042, préfecture de Labé,
// région de Labé) : le préfectoral de Labé enregistre et envoie la voix en pular ; le régional
// de Labé valide le pular ; celui de Kankan (malinké, autre région) n'y a aucun droit.
// Chaque cas part du même état (transaction annulée).
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const PRACTITIONER = 'm.diallo@exemple.gn';
const PREFECTORAL = 'prefectoral.labe@sabou-sante.gn';
const REGIONAL = 'regional.labe@sabou-sante.gn';
const OTHER_REGIONAL = 'regional.kankan@sabou-sante.gn';
const DG = 'dg@sabou-sante.gn';

const FIELDS = {
  maladie: 'MA-001',
  titreFr: 'Atelier d’essai',
  cycleDureeJours: 5,
  cyclePrisesParJour: 1,
  plantes: [{ plante: 'PL-003', partie: 'gousses' }],
  sections: ['preparation', 'consommation', 'cycle', 'effets_indesirables'].map((type) => ({
    type,
    texteFr: `Texte : ${type}`,
  })),
  consentement: true,
  visibilite: 'publique',
};
const json = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
const CODE = `(SELECT code FROM recette WHERE titre_fr = 'Atelier d’essai')`;
const processed = `
  SELECT id FROM voix_deposer('voix/originaux/' || gen_random_uuid() || '.webm', 'audio/webm', 9000,
                              '${'a'.repeat(64)}', true);
  SELECT 1 FROM voix_depots_prendre(1);
  SELECT voix_depot_terminer((SELECT max(id) FROM voix_depot), 'voix/' || gen_random_uuid() || '.webm',
                             'voix/' || gen_random_uuid() || '.m4a', 1.2, 4000, 5000, '${'b'.repeat(64)}');`;
// Voix envoyée au régional (« traduit ») dans une langue
const sent = (langue = 'pul') => `${openContext(PRACTITIONER)}
  SELECT traitement_enregistrer(NULL, NULL, ${json(FIELDS)});
  SELECT traitement_soumettre(${CODE});
  ${openContext(PREFECTORAL)} ${processed}
  SELECT traitement_voix_enregistrer(${CODE}, 'preparation', '${langue}', (SELECT max(id) FROM voix_depot));
  SELECT traitement_voix_envoyer(${CODE}, 'preparation', '${langue}');`;
const validate = (email: string, accepte = true, motif = 'NULL', langue = 'pul') =>
  `${openContext(email)}
   SELECT traitement_voix_valider(${CODE}, 'preparation', '${langue}', ${accepte}, ${motif}) AS statut;`;
const state = `
  SELECT v.statut, v.renvoi_motif AS motif, u.role_code AS valideur
    FROM recette_section_voix v JOIN recette_section s ON s.id = v.section_id
    JOIN recette r ON r.id = s.recette_id LEFT JOIN utilisateur u ON u.id = v.valideur_id
   WHERE r.code = ${CODE} AND s.type_code = 'preparation';`;
const run = (sql: string) => lastRows(db.url.app, sql);

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : validation ou renvoi motivé', () => {
  it('le régional de la région valide la voix de sa langue : validé, valideur noté, journalisé', async () => {
    const rows = await run(`${sent()} ${validate(REGIONAL)} ${state}`);
    expect(rows).toEqual([{ statut: 'valide', motif: null, valideur: 'regional' }]);
    const audit = await run(`${sent()} ${validate(REGIONAL)}
      SELECT action FROM journal_audit WHERE objet_id = ${CODE} AND action = 'recette.voix_valide';`);
    expect(audit).toEqual([{ action: 'recette.voix_valide' }]);
  });

  it('renvoi en brouillon avec motif obligatoire ; une voix validée peut aussi être renvoyée', async () => {
    await expect(run(`${sent()} ${validate(REGIONAL, false)}`)).rejects.toThrow(
      'Motif du renvoi obligatoire',
    );
    expect(
      await run(`${sent()} ${validate(REGIONAL, false, "'Mot mal prononcé'")} ${state}`),
    ).toEqual([{ statut: 'brouillon', motif: 'Mot mal prononcé', valideur: null }]);
    expect(
      await run(
        `${sent()} ${validate(REGIONAL)} ${validate(REGIONAL, false, "'Après réécoute'")} ${state}`,
      ),
    ).toEqual([{ statut: 'brouillon', motif: 'Après réécoute', valideur: null }]);
  });

  it('pas de validation d’une voix en brouillon, ni deux fois', async () => {
    await expect(
      run(`${sent()} ${validate(REGIONAL, false, "'À refaire'")} ${validate(REGIONAL)}`),
    ).rejects.toThrow('Transition brouillon → valide impossible');
    await expect(run(`${sent()} ${validate(REGIONAL)} ${validate(REGIONAL)}`)).rejects.toThrow(
      'Transition valide → valide impossible',
    );
  });
});

describe('Critère : seules les voix de ma langue et de ma région', () => {
  it('refusé au régional d’une autre région et sans droit de valider la langue', async () => {
    // Hors de sa région, le traitement ne lui est même pas visible
    await expect(run(`${sent()} ${validate(OTHER_REGIONAL)}`)).rejects.toThrow(
      /Droit de valider en pul absent|introuvable/,
    );
    // Le régional de Labé n'a pas le droit de valider le français
    await expect(run(`${sent('fr')} ${validate(REGIONAL, true, 'NULL', 'fr')}`)).rejects.toThrow(
      'Droit de valider en fr absent',
    );
  });

  it('refusé au préfectoral (il enregistre, il ne valide pas) et au praticien', async () => {
    for (const email of [PREFECTORAL, PRACTITIONER]) {
      await expect(run(`${sent()} ${validate(email)}`)).rejects.toThrow(
        /Droit de valider|introuvable/,
      );
    }
  });

  it('la DG, de zone nationale, valide le français où elle en a le droit', async () => {
    expect(await run(`${sent('fr')} ${validate(DG, true, 'NULL', 'fr')} ${state}`)).toEqual([
      { statut: 'valide', motif: null, valideur: 'dg' },
    ]);
  });
});

describe('Séparation des tâches (R-GOV-07)', () => {
  it('celui qui a enregistré ou envoyé la voix ne la valide pas, même avec le droit', async () => {
    // Voix envoyée par le régional lui-même (cas d'un compte cumulant les droits) : posé
    // directement, avec le compte propriétaire de la base
    await expect(
      lastRows(
        db.url.postgres,
        `${sent()}
         UPDATE recette_section_voix
            SET traducteur_id = (SELECT id FROM utilisateur WHERE email = '${REGIONAL}');
         ${validate(REGIONAL)}`,
      ),
    ).rejects.toThrow('jamais celui qui a enregistré ou envoyé la voix');
  });
});
