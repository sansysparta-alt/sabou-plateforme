// US-012b : la matrice des droits affichée à la DG (catalogue @sabou/types/permissions, repris
// du §3.2 du cahier des charges) est celle que la base applique. Chaque droit développé est
// essayé avec le praticien et les quatre rôles d'administration, sur le jeu d'exemple, dans une
// transaction annulée : l'action réussit pour les profils du catalogue et pour eux seuls.
// Comptes de Labé, la zone des dossiers d'essai : un refus vient du rôle, jamais de la zone.
// Les droits appliqués par l'API (comptes, fiches plantes) sont prouvés par ses propres tests ;
// le citoyen n'a aucun compte dans ces circuits.
import { beforeAll, describe, expect, it } from 'vitest';
import { PERMISSIONS, grantedRoles, type MatrixRole } from '@sabou/types/permissions';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;

type TriedRole = Exclude<MatrixRole, 'citoyen'>;
const ACCOUNTS: Record<TriedRole, string> = {
  praticien: 's.kourouma@exemple.gn', // titulaire du dossier DS-1041
  dg: 'dg@sabou-sante.gn',
  regional: 'regional.labe@sabou-sante.gn',
  prefectoral: 'prefectoral.labe@sabou-sante.gn',
  scientifique: 'comite@sabou-sante.gn',
};
const TRIED = Object.keys(ACCOUNTS) as TriedRole[];

// Dossier DS-1041 (praticien de Labé) mené jusqu'à l'étape voulue par les bons acteurs
const step = (email: string) =>
  `${openContext(email)} SELECT dossier_transition(1, 'valide', contexte_utilisateur());`;
const submitted = `${openContext(ACCOUNTS.praticien)}
  SELECT dossier_transition(1, 'soumis', contexte_utilisateur());
  ${openContext(ACCOUNTS.prefectoral)}
  SELECT visite_realiser(1, contexte_utilisateur(), vt.id, current_date, 'Lieu conforme.',
                         'favorable', repeat('b', 64))
    FROM visite_terrain vt WHERE vt.dossier_id = 1 AND vt.statut = 'planifiee';`;
const atStep3 = `${submitted} ${step(ACCOUNTS.prefectoral)}`;
const atStep4 = `${atStep3} ${step(ACCOUNTS.regional)}`;
const atStep5 = `${atStep4} ${step(ACCOUNTS.scientifique)}`;

// Traitement d'essai de Mamadou Diallo (Labé), soumis au Studio puis avancé par les bons acteurs
const FIELDS = {
  maladie: 'MA-001',
  titreFr: 'Matrice d’essai',
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
const CODE = `(SELECT code FROM recette WHERE titre_fr = 'Matrice d’essai')`;
const advance = (email: string, seen: string) =>
  `${openContext(email)} SELECT traitement_decider(${CODE}, '${seen}', 'avance', NULL);`;
const treatmentSubmitted = `${openContext('m.diallo@exemple.gn')}
  SELECT traitement_enregistrer(NULL, NULL, '${JSON.stringify(FIELDS).replace(/'/g, "''")}'::jsonb);
  SELECT traitement_soumettre(${CODE});`;
const treatmentSent = `${treatmentSubmitted} ${advance(ACCOUNTS.regional, 'soumise')}`;
const treatmentReviewed = `${treatmentSent} ${advance(ACCOUNTS.scientifique, 'transmise')}`;

// Pour chaque droit appliqué par la base : l'état de départ, puis l'action essayée (dans le
// contexte du compte essayé), qui renvoie une ligne quand elle réussit
const PROBES: Record<string, { setup: string; action: string }> = {
  'dossier.submit': {
    setup: '',
    action: `SELECT dossier_transition(1, 'soumis', contexte_utilisateur());`,
  },
  'practitioner.field-check': {
    setup: submitted,
    action: `SELECT dossier_transition(1, 'valide', contexte_utilisateur());`,
  },
  'dossiers.consolidate': {
    setup: atStep3,
    action: `SELECT dossier_transition(1, 'valide', contexte_utilisateur());`,
  },
  'dossier.review': {
    setup: atStep4,
    action: `SELECT dossier_transition(1, 'valide', contexte_utilisateur());`,
  },
  'certification.approve': {
    setup: atStep5,
    action: `SELECT * FROM certificat_preparer(1, contexte_utilisateur());`,
  },
  'practitioner.reject': {
    setup: '',
    action: `SELECT praticien_rejeter(p.id, contexte_utilisateur(), 'fraude_documentaire',
                                     'Diplôme falsifié') FROM praticien p WHERE p.code = 'PR-1042';`,
  },
  'treatment.forward': {
    setup: treatmentSubmitted,
    action: `SELECT traitement_decider(${CODE}, 'soumise', 'avance', NULL);`,
  },
  'recipe.review': {
    setup: treatmentSent,
    action: `SELECT traitement_decider(${CODE}, 'transmise', 'avance', NULL);`,
  },
  'treatment.certify': {
    setup: treatmentReviewed,
    action: `SELECT traitement_decider(${CODE}, 'expertisee', 'avance', NULL);`,
  },
  'treatment.suspend': {
    setup: '',
    action: `SELECT recette_transition(r.id, 'suspendue', contexte_utilisateur(), 'Effet signalé')
               FROM recette r WHERE r.code = 'REC-2042';`,
  },
  'content.annotate': {
    setup: '',
    action: `SELECT * FROM annotation_ajouter('recette', 'REC-2043', 'reserve', 'À préciser.');`,
  },
};

// Droits développés prouvés par les tests de l'API, pas par la base
const PROVEN_BY_API = ['users.manage', 'plants.edit'];

async function succeeds(id: string, role: TriedRole): Promise<boolean> {
  const probe = PROBES[id]!;
  try {
    const rows = await lastRows(
      db.url.app,
      `${probe.setup} ${openContext(ACCOUNTS[role])} ${probe.action}`,
    );
    return rows.length > 0;
  } catch {
    // Refus de la base. Chaque droit a au moins un profil autorisé, essayé sur le même état
    // de départ : un état de départ cassé ferait donc échouer le test, pas le masquer.
    return false;
  }
}

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Matrice des droits : la base applique exactement le catalogue (US-012b)', () => {
  it('chaque droit développé du catalogue est essayé ici ou par l’API, et rien d’autre', () => {
    const available = PERMISSIONS.filter((entry) => entry.available).map((entry) => entry.id);
    expect([...Object.keys(PROBES), ...PROVEN_BY_API].sort()).toEqual(available.sort());
  });

  it.each(Object.keys(PROBES))('%s', async (id) => {
    const results: Record<string, boolean> = {};
    for (const role of TRIED) results[role] = await succeeds(id, role);
    const granted: string[] = grantedRoles(id);
    expect(results).toEqual(
      Object.fromEntries(TRIED.map((role) => [role, granted.includes(role)])),
    );
  });
});
