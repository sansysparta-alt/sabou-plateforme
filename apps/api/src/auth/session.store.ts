import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

// Durées décidées pour US-010 (05_Choix_Techniques.md §2.20), alignées sur Keycloak
export const SESSION_IDLE_SECONDS = 30 * 60;
export const SESSION_MAX_SECONDS = 10 * 60 * 60;
export const LOGIN_TRANSACTION_SECONDS = 10 * 60;

export interface SessionData {
  sub: string;
  username: string;
  name: string;
  roles: string[];
  // Vrai si la connexion a utilisé un second facteur (claim « amr » du jeton d'identité)
  secondFactor: boolean;
  // Sert à fermer la session Keycloak à la déconnexion ; jamais envoyé au navigateur
  refreshToken: string;
  createdAt: number;
}

// Connexion en cours : de la redirection vers Keycloak au retour sur /auth/callback
export interface LoginTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
}

export const SESSION_STORE = Symbol('SESSION_STORE');

export interface SessionStore {
  create(data: SessionData): Promise<string>;
  // Renvoie la session et prolonge son délai d'inactivité ; null si absente ou expirée
  touch(id: string, now?: number): Promise<SessionData | null>;
  destroy(id: string): Promise<void>;
  saveLogin(tx: LoginTransaction): Promise<void>;
  // Lecture unique : une transaction ne sert qu'une fois
  takeLogin(state: string): Promise<LoginTransaction | null>;
}

// Identifiant de 256 bits ; seule son empreinte est écrite dans Valkey, pour qu'une copie
// de la base de sessions ne donne pas de cookie utilisable.
export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export class ValkeySessionStore implements SessionStore {
  constructor(private readonly valkey: Redis) {}

  async create(data: SessionData): Promise<string> {
    const id = newSessionId();
    await this.valkey.set(
      `sabou:session:${digest(id)}`,
      JSON.stringify(data),
      'EX',
      SESSION_IDLE_SECONDS,
    );
    return id;
  }

  async touch(id: string, now = Date.now()): Promise<SessionData | null> {
    const key = `sabou:session:${digest(id)}`;
    // Prolonge l'inactivité et lit la session en une seule requête
    const raw = await this.valkey.getex(key, 'EX', SESSION_IDLE_SECONDS);
    if (!raw) return null;
    const data = JSON.parse(raw) as SessionData;
    if (now - data.createdAt >= SESSION_MAX_SECONDS * 1000) {
      await this.valkey.del(key);
      return null;
    }
    return data;
  }

  async destroy(id: string): Promise<void> {
    await this.valkey.del(`sabou:session:${digest(id)}`);
  }

  async saveLogin(tx: LoginTransaction): Promise<void> {
    await this.valkey.set(
      `sabou:login:${digest(tx.state)}`,
      JSON.stringify(tx),
      'EX',
      LOGIN_TRANSACTION_SECONDS,
    );
  }

  async takeLogin(state: string): Promise<LoginTransaction | null> {
    const raw = await this.valkey.getdel(`sabou:login:${digest(state)}`);
    return raw ? (JSON.parse(raw) as LoginTransaction) : null;
  }
}
