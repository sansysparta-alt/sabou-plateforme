// US-024 : récupération du compte DG par l'administrateur technique (décision du maître
// d'ouvrage du 18 novembre 2026 : script d'exploitation, aucun écran).
//   pnpm dg:reinitialiser --motif "Téléphone perdu, appel de la DG le 18/11 à 9 h" \
//     --operateur "Nom de l'administrateur technique" [--double-facteur] [--mot-de-passe]
// Sans option de moyen : le double facteur (cas du téléphone perdu).
//
// Ce que fait le script, et ce qu'il ne fait jamais :
// - il ferme les sessions de la DG, retire son double facteur si demandé, et demande à
//   Keycloak d'envoyer à la DG un e-mail avec un lien pour reconfigurer elle-même son double
//   facteur et/ou choisir un nouveau mot de passe : l'opérateur ne connaît jamais ses codes,
//   n'obtient aucun jeton et ne peut pas agir à sa place dans SABOU ;
// - il ne crée aucun compte (la base refuse d'ailleurs un second compte DG actif) ;
// - il journalise la réinitialisation (source « exploitation » : qui, quand, pourquoi) et met
//   en file un SMS d'alerte pour la DG, dans une transaction validée seulement si Keycloak a
//   tout accepté.
import pg from 'pg';

export type ResetMeans = 'double-facteur' | 'mot-de-passe';

export interface ResetRequest {
  motif: string;
  operateur: string;
  moyens: ResetMeans[];
}

// Opérations de Keycloak utilisées ; remplaçables dans les tests
export interface DirectorKeycloak {
  // Identifiant du compte qui obtient le jeton d'administration (pour le journal)
  readonly adminAccount: string;
  removeOtp(userId: string): Promise<number>;
  signOut(userId: string): Promise<void>;
  sendActionsEmail(userId: string, actions: string[]): Promise<void>;
}

export class ResetRefusedError extends Error {}

export function parseResetArgs(argv: string[]): ResetRequest {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? (argv[index + 1] ?? '') : '';
  };
  const motif = value('--motif').trim();
  const operateur = value('--operateur').trim();
  if (motif.length < 10) {
    throw new ResetRefusedError(
      'Motif obligatoire (10 caractères au moins) : --motif "pourquoi, à la demande de qui".',
    );
  }
  if (operateur.length < 2) {
    throw new ResetRefusedError('Opérateur obligatoire : --operateur "votre nom".');
  }
  const moyens: ResetMeans[] = [];
  if (argv.includes('--double-facteur')) moyens.push('double-facteur');
  if (argv.includes('--mot-de-passe')) moyens.push('mot-de-passe');
  return { motif, operateur, moyens: moyens.length > 0 ? moyens : ['double-facteur'] };
}

export interface ResetResult {
  dg: { id: number; email: string };
  otpRemoved: number;
  actions: string[];
}

// Réinitialise le compte de l'unique DG active. url : connexion de l'exploitation (migrateur).
export async function resetDirector(
  url: string,
  keycloak: DirectorKeycloak,
  request: ResetRequest,
): Promise<ResetResult> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      id: number;
      keycloak_id: string;
      email: string;
      telephone: string | null;
    }>(
      `SELECT id::int, keycloak_id::text, email, telephone FROM sabou.utilisateur
        WHERE role_code = 'dg' AND statut = 'actif' FOR UPDATE`,
    );
    if (rows.length !== 1) {
      throw new ResetRefusedError(
        `Une seule DG active attendue, trouvé : ${rows.length}. Rien n'a été modifié.`,
      );
    }
    const dg = rows[0]!;
    if (!dg.telephone) {
      // Téléphone obligatoire (US-012b) : l'alerte par SMS fait partie de la procédure
      throw new ResetRefusedError(
        'La DG n’a pas de téléphone enregistré : alerte par SMS impossible. Rien n’a été modifié.',
      );
    }
    const actions = [
      ...(request.moyens.includes('double-facteur') ? ['CONFIGURE_TOTP'] : []),
      ...(request.moyens.includes('mot-de-passe') ? ['UPDATE_PASSWORD'] : []),
    ];
    await client.query(
      `INSERT INTO sabou.journal_audit (source, utilisateur_id, action, objet_type, objet_id, details)
       VALUES ('exploitation', $1, 'compte.dg_reinitialise', 'utilisateur', $2, $3)`,
      [
        dg.id,
        String(dg.id),
        {
          motif: request.motif,
          operateur: request.operateur,
          compteAdministration: keycloak.adminAccount,
          moyens: request.moyens,
        },
      ],
    );
    await client.query(
      `INSERT INTO sabou.notification (destinataire_id, canal, modele, objet_type, objet_id, parametres)
       VALUES ($1, 'sms', 'compte.dg_reinitialise', 'utilisateur', $2, '{}'::jsonb)`,
      [dg.id, String(dg.id)],
    );
    // Keycloak : sessions fermées, double facteur retiré si demandé, e-mail d'actions à la DG
    await keycloak.signOut(dg.keycloak_id);
    const otpRemoved = request.moyens.includes('double-facteur')
      ? await keycloak.removeOtp(dg.keycloak_id)
      : 0;
    await keycloak.sendActionsEmail(dg.keycloak_id, actions);
    await client.query('COMMIT');
    return { dg: { id: dg.id, email: dg.email }, otpRemoved, actions };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

// Keycloak réel : jeton d'administration du domaine « master » (compte d'amorçage), puis API
// d'administration du domaine « sabou ». Lien de l'e-mail : retour vers l'application de gestion.
export async function keycloakAdmin(options: {
  baseUrl: string;
  username: string;
  password: string;
  adminAppUrl: string;
}): Promise<DirectorKeycloak> {
  const tokenResponse = await fetch(
    `${options.baseUrl}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: options.username,
        password: options.password,
      }),
    },
  );
  if (!tokenResponse.ok) {
    throw new Error(`Keycloak : connexion d'administration refusée (${tokenResponse.status}).`);
  }
  const { access_token: token } = (await tokenResponse.json()) as { access_token: string };
  const api = async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const response = await fetch(`${options.baseUrl}/admin/realms/sabou${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    if (!response.ok) {
      throw new Error(`Keycloak : ${init.method ?? 'GET'} ${path} refusé (${response.status}).`);
    }
    return response;
  };
  return {
    adminAccount: options.username,
    async removeOtp(userId) {
      const credentials = (await (await api(`/users/${userId}/credentials`)).json()) as {
        id: string;
        type: string;
      }[];
      const otp = credentials.filter((credential) => credential.type === 'otp');
      for (const credential of otp) {
        await api(`/users/${userId}/credentials/${credential.id}`, { method: 'DELETE' });
      }
      return otp.length;
    },
    async signOut(userId) {
      await api(`/users/${userId}/logout`, { method: 'POST' });
    },
    async sendActionsEmail(userId, actions) {
      const query = new URLSearchParams({
        client_id: 'sabou-admin',
        redirect_uri: `${options.adminAppUrl.replace(/\/$/, '')}/`,
        lifespan: String(12 * 3600),
      });
      await api(`/users/${userId}/execute-actions-email?${query.toString()}`, {
        method: 'PUT',
        body: actions,
      });
    },
  };
}
