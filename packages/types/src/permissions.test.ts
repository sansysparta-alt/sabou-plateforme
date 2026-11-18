import { describe, expect, it } from 'vitest';
import { ACCOUNT_ROLES } from './accounts.js';
import {
  MATRIX_ROLES,
  PERMISSION_GROUPS,
  PERMISSIONS,
  ROLE_PROFILES,
  grantedRoles,
} from './permissions.js';

// La conformité au serveur des droits développés est prouvée ailleurs (packages/db/test/
// matrice-droits.test.ts, tests de l'API) ; ici, la fidélité du catalogue au §3.2.
describe('Catalogue des droits (US-012b)', () => {
  it('reprend les six profils du §3.2, dont les quatre rôles invitables', () => {
    expect(MATRIX_ROLES).toEqual([
      'praticien',
      'prefectoral',
      'regional',
      'scientifique',
      'dg',
      'citoyen',
    ]);
    for (const role of ACCOUNT_ROLES) expect(MATRIX_ROLES).toContain(role);
    for (const role of MATRIX_ROLES) expect(ROLE_PROFILES[role].mission).not.toBe('');
  });

  it('reprend les vingt lignes de la matrice du cahier des charges, sans source ajoutée', () => {
    const cdc = PERMISSION_GROUPS[0]!;
    expect(cdc.title).toBe('Matrice du cahier des charges (§3.2)');
    expect(cdc.permissions).toHaveLength(20);
    for (const entry of cdc.permissions) expect(entry.source).toBeUndefined();
    // Périmètres écrits dans la matrice, gardés tels quels
    expect(PERMISSIONS.find((entry) => entry.id === 'forum.moderate')!.grants).toEqual({
      prefectoral: 'Local',
      regional: 'Région',
      scientifique: 'Scientifique',
      dg: 'National',
    });
  });

  it('chaque précision cite sa source ; identifiants uniques ; au moins un profil par droit', () => {
    for (const entry of PERMISSION_GROUPS[1]!.permissions) expect(entry.source).toBeTruthy();
    const ids = PERMISSIONS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of PERMISSIONS) expect(grantedRoles(entry.id).length).toBeGreaterThan(0);
    expect(grantedRoles('users.manage')).toEqual(['dg']);
  });
});
