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
  // Relance demandant le niveau 2 seul (second facteur juste activé, §2.28) : une seule par
  // connexion ; au retour, l'application affiche « double facteur activé »
  stepUp?: boolean;
}

export const SESSION_STORE = Symbol('SESSION_STORE');

export interface SessionStore {
  create(data: SessionData): Promise<string>;
  // Renvoie la session et prolonge son délai d'inactivité ; null si absente ou expirée
  touch(id: string, now?: number): Promise<SessionData | null>;
  destroy(id: string): Promise<void>;
  // Suspension (US-013) : ferme toutes les sessions du compte et refuse les suivantes,
  // y compris celle d'une connexion en cours au moment de la suspension
  revokeAccount(sub: string): Promise<void>;
  // Réactivation : le compte peut de nouveau ouvrir une session
  restoreAccount(sub: string): Promise<void>;
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

const sessionKey = (hash: string) => `sabou:session:${hash}`;
// Empreintes des sessions d'un compte, pour les fermer toutes à la suspension
const accountSessionsKey = (sub: string) => `sabou:compte:${sub}:sessions`;
// Présente tant que le compte est suspendu (sans expiration)
const suspendedKey = (sub: string) => `sabou:compte:${sub}:suspendu`;

export class ValkeySessionStore implements SessionStore {
  constructor(private readonly valkey: Redis) {}

  async create(data: SessionData): Promise<string> {
    const id = newSessionId();
    const hash = digest(id);
    await this.valkey
      .multi()
      .set(sessionKey(hash), JSON.stringify(data), 'EX', SESSION_IDLE_SECONDS)
      .sadd(accountSessionsKey(data.sub), hash)
      // Aucune session ne vit plus de 10 heures : l'index non plus
      .expire(accountSessionsKey(data.sub), SESSION_MAX_SECONDS)
      .exec();
    return id;
  }

  async touch(id: string, now = Date.now()): Promise<SessionData | null> {
    const key = sessionKey(digest(id));
    // Prolonge l'inactivité et lit la session en une seule requête
    const raw = await this.valkey.getex(key, 'EX', SESSION_IDLE_SECONDS);
    if (!raw) return null;
    const data = JSON.parse(raw) as SessionData;
    if (
      now - data.createdAt >= SESSION_MAX_SECONDS * 1000 ||
      (await this.valkey.exists(suspendedKey(data.sub))) === 1
    ) {
      await this.valkey.del(key);
      return null;
    }
    return data;
  }

  async revokeAccount(sub: string): Promise<void> {
    // La marque d'abord : une session créée entre les deux étapes est refusée quand même
    await this.valkey.set(suspendedKey(sub), '1');
    const hashes = await this.valkey.smembers(accountSessionsKey(sub));
    await this.valkey.del(accountSessionsKey(sub), ...hashes.map(sessionKey));
  }

  async restoreAccount(sub: string): Promise<void> {
    await this.valkey.del(suspendedKey(sub));
  }

  async destroy(id: string): Promise<void> {
    await this.valkey.del(sessionKey(digest(id)));
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
