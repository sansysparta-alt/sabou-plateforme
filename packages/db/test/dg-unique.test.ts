// US-024 : un seul compte DG, récupérable par l'administrateur technique. Base réelle (jeu
// d'exemple : une DG active, dg@sabou-sante.gn) ; Keycloak simulé pour le script
// (src/dg-reset.ts), dont le Keycloak réel est exercé par la procédure d'exploitation.
// Critère 1 : la base refuse un second compte DG actif.
// Critère 2 : le script réinitialise le double facteur ou le mot de passe, sans agir à la place
//             de la DG ni créer de compte.
// Critère 3 : chaque réinitialisation est journalisée : qui, quand, pourquoi, motif obligatoire.
// Critère 4 : la DG est alertée par e-mail (Keycloak) et par SMS (file de notifications).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  keycloakAdmin,
  parseResetArgs,
  resetDirector,
  ResetRefusedError,
  type DirectorKeycloak,
} from '../src/dg-reset.ts';
import {
  createSeededDatabase,
  inRolledBackTransaction,
  lastRows,
  runSql,
  type TestDatabase,
} from './helpers.ts';

const DG_KEYCLOAK = '60606060-0000-4000-8000-000000000001';

function fakeKeycloak(fail: 'none' | 'email' = 'none') {
  const calls: string[] = [];
  const keycloak: DirectorKeycloak & { calls: string[] } = {
    adminAccount: 'admin-technique',
    calls,
    async signOut(id) {
      calls.push(`signOut ${id}`);
    },
    async removeOtp(id) {
      calls.push(`removeOtp ${id}`);
      return 1;
    },
    async sendActionsEmail(id, actions) {
      if (fail === 'email') throw new Error('Keycloak injoignable');
      calls.push(`email ${id} ${actions.join(',')}`);
    },
  };
  return keycloak;
}

const REQUEST = {
  motif: 'Téléphone perdu, appel de la DG le 18/11',
  operateur: 'Alpha Bah',
  moyens: ['double-facteur' as const],
};

describe('Critère 1 : un seul compte DG actif', () => {
  let db: TestDatabase;
  beforeEach(async () => {
    db = await createSeededDatabase();
  });

  it('refuse un second compte DG actif', async () => {
    await expect(
      inRolledBackTransaction(
        db.url.app,
        `INSERT INTO utilisateur (email, prenom, nom, role_code, statut, keycloak_id)
         VALUES ('dg2@exemple.invalid', 'Essai', 'Deux', 'dg', 'actif', '${DG_KEYCLOAK}')`,
      ),
    ).rejects.toThrow('ux_utilisateur_dg_unique');
  });

  it('refuse de réactiver une DG suspendue tant qu’une autre est active', async () => {
    await expect(
      inRolledBackTransaction(
        db.url.app,
        `INSERT INTO utilisateur (email, prenom, nom, role_code, statut, keycloak_id)
         VALUES ('dg2@exemple.invalid', 'Essai', 'Deux', 'dg', 'suspendu', '${DG_KEYCLOAK}');
         UPDATE utilisateur SET statut = 'actif' WHERE email = 'dg2@exemple.invalid';`,
      ),
    ).rejects.toThrow('ux_utilisateur_dg_unique');
  });

  it('accepte une nouvelle DG une fois l’ancienne suspendue (passation)', async () => {
    await expect(
      inRolledBackTransaction(
        db.url.app,
        `UPDATE utilisateur SET statut = 'suspendu' WHERE email = 'dg@sabou-sante.gn';
         INSERT INTO utilisateur (email, prenom, nom, role_code, statut, keycloak_id)
         VALUES ('dg2@exemple.invalid', 'Essai', 'Deux', 'dg', 'actif', '${DG_KEYCLOAK}')`,
      ),
    ).resolves.toBeUndefined();
  });
});

describe('Critères 2 à 4 : réinitialisation par l’exploitation (pnpm dg:reinitialiser)', () => {
  let db: TestDatabase;
  beforeEach(async () => {
    db = await createSeededDatabase();
  });

  it('ferme les sessions, retire le double facteur, envoie l’e-mail, journalise, met le SMS en file', async () => {
    const keycloak = fakeKeycloak();
    const result = await resetDirector(db.url.migrator, keycloak, REQUEST);
    const [dg] = (await lastRows(
      db.url.migrator,
      `SELECT id::int, keycloak_id::text FROM utilisateur WHERE email = 'dg@sabou-sante.gn'`,
    )) as { id: number; keycloak_id: string }[];
    expect(result).toEqual({
      dg: { id: dg!.id, email: 'dg@sabou-sante.gn' },
      otpRemoved: 1,
      actions: ['CONFIGURE_TOTP'],
    });
    // Ni mot de passe choisi, ni jeton : seulement fermer, retirer, et laisser la DG agir
    expect(keycloak.calls).toEqual([
      `signOut ${dg!.keycloak_id}`,
      `removeOtp ${dg!.keycloak_id}`,
      `email ${dg!.keycloak_id} CONFIGURE_TOTP`,
    ]);
    const [audit] = await lastRows(
      db.url.migrator,
      `SELECT source, action, objet_id, details, created_at IS NOT NULL AS horodate
         FROM journal_audit WHERE action = 'compte.dg_reinitialise'`,
    );
    expect(audit).toEqual({
      source: 'exploitation',
      action: 'compte.dg_reinitialise',
      objet_id: String(dg!.id),
      details: {
        motif: REQUEST.motif,
        operateur: 'Alpha Bah',
        compteAdministration: 'admin-technique',
        moyens: ['double-facteur'],
      },
      horodate: true,
    });
    const [sms] = await lastRows(
      db.url.migrator,
      `SELECT n.canal, u.telephone FROM notification n JOIN utilisateur u ON u.id = n.destinataire_id
        WHERE n.modele = 'compte.dg_reinitialise'`,
    );
    expect(sms).toEqual({ canal: 'sms', telephone: '+224620000001' });
  });

  it('mot de passe : e-mail de mise à jour, double facteur laissé en place', async () => {
    const keycloak = fakeKeycloak();
    await resetDirector(db.url.migrator, keycloak, { ...REQUEST, moyens: ['mot-de-passe'] });
    expect(keycloak.calls.map((c) => c.split(' ')[0])).toEqual(['signOut', 'email']);
    expect(keycloak.calls.at(-1)).toMatch(/ UPDATE_PASSWORD$/);
  });

  it('Keycloak en échec : rien n’est journalisé ni envoyé', async () => {
    await expect(resetDirector(db.url.migrator, fakeKeycloak('email'), REQUEST)).rejects.toThrow(
      'Keycloak injoignable',
    );
    const [row] = await lastRows(
      db.url.migrator,
      `SELECT (SELECT count(*)::int FROM journal_audit WHERE action = 'compte.dg_reinitialise') AS audit,
              (SELECT count(*)::int FROM notification WHERE modele = 'compte.dg_reinitialise') AS sms`,
    );
    expect(row).toEqual({ audit: 0, sms: 0 });
  });

  it('aucune DG active, ou DG sans téléphone : refus, rien de modifié', async () => {
    await runSql(
      db.url.migrator,
      `UPDATE sabou.utilisateur SET telephone = NULL WHERE role_code = 'dg'`,
    );
    await expect(resetDirector(db.url.migrator, fakeKeycloak(), REQUEST)).rejects.toThrow(
      ResetRefusedError,
    );
    await runSql(
      db.url.migrator,
      `UPDATE sabou.utilisateur SET statut = 'suspendu' WHERE role_code = 'dg'`,
    );
    await expect(resetDirector(db.url.migrator, fakeKeycloak(), REQUEST)).rejects.toThrow(
      'Une seule DG active attendue, trouvé : 0',
    );
  });

  it('la base refuse une ligne de l’exploitation sans opérateur ou sans motif', async () => {
    for (const details of [
      `'{"motif": "Téléphone perdu le 18/11"}'`,
      `'{"operateur": "Alpha Bah", "motif": "court"}'`,
    ]) {
      await expect(
        inRolledBackTransaction(
          db.url.migrator,
          `INSERT INTO journal_audit (source, action, objet_type, details)
           VALUES ('exploitation', 'compte.dg_reinitialise', 'utilisateur', ${details}::jsonb)`,
        ),
      ).rejects.toThrow('ck_audit_exploitation');
    }
  });
});

describe('Arguments du script : motif et opérateur obligatoires', () => {
  it('refuse sans motif ou avec un motif trop court, et sans opérateur', () => {
    expect(() => parseResetArgs(['--operateur', 'Alpha Bah'])).toThrow(/Motif obligatoire/);
    expect(() => parseResetArgs(['--motif', 'perdu', '--operateur', 'Alpha Bah'])).toThrow(
      /Motif obligatoire/,
    );
    expect(() => parseResetArgs(['--motif', 'Téléphone perdu le 18/11'])).toThrow(
      /Opérateur obligatoire/,
    );
  });

  it('double facteur par défaut ; mot de passe sur demande', () => {
    const base = ['--motif', 'Téléphone perdu le 18/11', '--operateur', 'Alpha Bah'];
    expect(parseResetArgs(base).moyens).toEqual(['double-facteur']);
    expect(parseResetArgs([...base, '--mot-de-passe']).moyens).toEqual(['mot-de-passe']);
    expect(parseResetArgs([...base, '--mot-de-passe', '--double-facteur']).moyens).toEqual([
      'double-facteur',
      'mot-de-passe',
    ]);
  });
});

describe('Client Keycloak du script : seulement fermer, retirer et faire envoyer l’e-mail', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('appelle l’API d’administration du domaine « sabou », jamais pour fixer un mot de passe', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const path = url.replace('http://kc.test', '');
        requests.push(`${init.method ?? 'GET'} ${path}${init.body ? ` ${String(init.body)}` : ''}`);
        if (path.endsWith('/token')) return Response.json({ access_token: 'jeton' });
        if (path.endsWith('/credentials')) {
          return Response.json([
            { id: 'p1', type: 'password' },
            { id: 'o1', type: 'otp' },
          ]);
        }
        return new Response(null, { status: 204 });
      }),
    );
    const keycloak = await keycloakAdmin({
      baseUrl: 'http://kc.test',
      username: 'admin',
      password: 'secret',
      adminAppUrl: 'http://localhost:5173',
    });
    await keycloak.signOut('u1');
    expect(await keycloak.removeOtp('u1')).toBe(1);
    await keycloak.sendActionsEmail('u1', ['CONFIGURE_TOTP']);
    expect(requests.slice(1)).toEqual([
      'POST /admin/realms/sabou/users/u1/logout',
      'GET /admin/realms/sabou/users/u1/credentials',
      'DELETE /admin/realms/sabou/users/u1/credentials/o1',
      'PUT /admin/realms/sabou/users/u1/execute-actions-email?client_id=sabou-admin&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2F&lifespan=43200 ["CONFIGURE_TOTP"]',
    ]);
    expect(requests.some((r) => r.includes('reset-password'))).toBe(false);
  });

  it('refus de Keycloak : erreur explicite', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    await expect(
      keycloakAdmin({
        baseUrl: 'http://kc.test',
        username: 'admin',
        password: 'faux',
        adminAppUrl: 'http://localhost:5173',
      }),
    ).rejects.toThrow("connexion d'administration refusée (401)");
  });
});
