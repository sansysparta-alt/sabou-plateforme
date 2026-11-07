import { z } from 'zod';
import type { Env } from '../config/env';
import { translateKeycloakError } from '../accounts/identity-admin';
import { KeycloakServiceAccount } from '../keycloak/service-account';

export const CITIZEN_IDENTITY = Symbol('CITIZEN_IDENTITY');

export interface NewCitizen {
  // Identifiant de connexion : les 9 chiffres nationaux du numéro
  username: string;
  firstName: string;
  password: string;
}

// Comptes du domaine Keycloak « sabou-public », seule source des mots de passe des citoyens
export interface CitizenIdentity {
  // Crée le compte avec son mot de passe et le rôle « citoyen » ; renvoie son « sub ».
  // AccountExistsError si le numéro a déjà un compte ; PasswordRejectedError si les règles
  // du domaine refusent le mot de passe.
  createCitizen(citizen: NewCitizen): Promise<string>;
  deleteAccount(id: string): Promise<void>;
}

const roleSchema = z.array(z.object({ id: z.string().min(1), name: z.string() }));
const CITIZEN_ROLE = 'citoyen';

// Compte de service « sabou-inscription » : manage-users et view-users du seul domaine public
export class KeycloakCitizenIdentity implements CitizenIdentity {
  private readonly client: KeycloakServiceAccount;

  constructor(env: Env) {
    this.client = new KeycloakServiceAccount(
      {
        KEYCLOAK_ISSUER: env.PUBLIC_KEYCLOAK_ISSUER,
        KEYCLOAK_INTERNAL_URL: env.KEYCLOAK_INTERNAL_URL,
      },
      env.INSCRIPTION_CLIENT_ID,
      env.INSCRIPTION_CLIENT_SECRET,
    );
  }

  async createCitizen(citizen: NewCitizen): Promise<string> {
    let response: Response;
    try {
      response = await this.client.request('/users', {
        method: 'POST',
        body: {
          username: citizen.username,
          enabled: true,
          firstName: citizen.firstName,
          credentials: [{ type: 'password', value: citizen.password, temporary: false }],
        },
      });
    } catch (error) {
      throw translateKeycloakError(error);
    }
    const id = /\/users\/([0-9a-f-]{36})$/.exec(response.headers.get('location') ?? '')?.[1];
    if (!id) throw new Error('Keycloak : identifiant du compte créé absent');
    try {
      const available = roleSchema.parse(
        await (await this.client.request(`/users/${id}/role-mappings/realm/available`)).json(),
      );
      const role = available.find((candidate) => candidate.name === CITIZEN_ROLE);
      if (!role) throw new Error(`Keycloak : rôle ${CITIZEN_ROLE} introuvable`);
      await this.client.request(`/users/${id}/role-mappings/realm`, {
        method: 'POST',
        body: [{ id: role.id, name: role.name }],
      });
    } catch (error) {
      // Pas de compte sans rôle : il est retiré, l'inscription peut être reprise
      await this.deleteAccount(id).catch(() => undefined);
      throw error;
    }
    return id;
  }

  async deleteAccount(id: string): Promise<void> {
    await this.client.request(`/users/${id}`, { method: 'DELETE' });
  }
}
