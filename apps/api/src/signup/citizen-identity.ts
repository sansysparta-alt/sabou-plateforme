import { z } from 'zod';
import type { SignupProfile } from '@sabou/types';
import type { Env } from '../config/env';
import { translateKeycloakError } from '../accounts/identity-admin';
import { KeycloakServiceAccount } from '../keycloak/service-account';

export const CITIZEN_IDENTITY = Symbol('CITIZEN_IDENTITY');

export interface NewCitizen {
  // Identifiant de connexion : les 9 chiffres nationaux du numéro
  username: string;
  firstName: string;
  // Praticien seulement (porté par le certificat)
  lastName?: string;
  password: string;
  role: SignupProfile;
}

// Comptes du domaine Keycloak « sabou-public », seule source des mots de passe des citoyens
// et des praticiens
export interface CitizenIdentity {
  // Crée le compte avec son mot de passe et son rôle (citoyen ou praticien) ; renvoie son « sub ».
  // AccountExistsError si le numéro a déjà un compte ; PasswordRejectedError si les règles
  // du domaine refusent le mot de passe.
  createAccount(citizen: NewCitizen): Promise<string>;
  deleteAccount(id: string): Promise<void>;
}

const roleSchema = z.array(z.object({ id: z.string().min(1), name: z.string() }));

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

  async createAccount(citizen: NewCitizen): Promise<string> {
    let response: Response;
    try {
      response = await this.client.request('/users', {
        method: 'POST',
        body: {
          username: citizen.username,
          enabled: true,
          firstName: citizen.firstName,
          ...(citizen.lastName ? { lastName: citizen.lastName } : {}),
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
      const role = available.find((candidate) => candidate.name === citizen.role);
      if (!role) throw new Error(`Keycloak : rôle ${citizen.role} introuvable`);
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
