import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

// Durées et limites de l'inscription (lot D, §2.25)
export const SIGNUP_CODE_SECONDS = 10 * 60;
export const SIGNUP_CODE_ATTEMPTS = 5;
export const SIGNUP_TICKET_SECONDS = 15 * 60;

export const SIGNUP_STORE = Symbol('SIGNUP_STORE');

export type CodeCheck =
  | { result: 'valid' }
  | { result: 'invalid'; remainingAttempts: number }
  // Expiré, épuisé ou jamais demandé
  | { result: 'expired' };

export interface SignupStore {
  // Compte une demande dans une fenêtre fixe ; renvoie le délai d'attente (secondes) si la
  // limite est dépassée, null sinon
  hit(key: string, limit: number, windowSeconds: number): Promise<number | null>;
  // Un nouveau code remplace le précédent (et remet les essais à zéro)
  saveCode(phone: string, code: string): Promise<void>;
  // Lecture et décompte des essais en une seule opération ; un bon code ne sert qu'une fois
  checkCode(phone: string, code: string): Promise<CodeCheck>;
  // Ticket d'inscription remis après le bon code ; renvoie le ticket (256 bits)
  issueTicket(phone: string): Promise<string>;
  // Numéro lié au ticket, sans le consommer (contrôle du mot de passe)
  peekTicket(ticket: string): Promise<string | null>;
  // Lecture unique : le ticket ne sert qu'une fois
  takeTicket(ticket: string): Promise<string | null>;
  // Ticket rendu après un mot de passe refusé par Keycloak
  restoreTicket(ticket: string, phone: string): Promise<void>;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

// Vérification atomique du code : comparaison des empreintes, décompte des essais, code
// effacé au premier succès ou au dernier essai. Renvoie {1} si valide, {0, restants} sinon,
// {-1} si aucun code n'est en cours.
const CHECK_CODE = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {-1} end
local data = cjson.decode(raw)
if data.hash == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return {1}
end
data.attempts = data.attempts + 1
local remaining = tonumber(ARGV[2]) - data.attempts
if remaining <= 0 then
  redis.call('DEL', KEYS[1])
  return {0, 0}
end
redis.call('SET', KEYS[1], cjson.encode(data), 'KEEPTTL')
return {0, remaining}
`;

// Codes, tickets et compteurs dans Valkey : seules des empreintes SHA-256 y sont écrites
// (le numéro est lié au code dans l'empreinte, un code ne vaut que pour son numéro).
// Un espace de clés par usage : inscription (US-014) ou mot de passe oublié (US-069). Un code
// ou un ticket de l'un ne vaut rien pour l'autre ; leurs limites se comptent à part.
// US-100 : « signalement » ne sert qu'aux compteurs de la limite par adresse IP
export type StoreNamespace = 'inscription' | 'mot-de-passe' | 'signalement';

export class ValkeySignupStore implements SignupStore {
  constructor(
    private readonly valkey: Redis,
    private readonly namespace: StoreNamespace = 'inscription',
  ) {}

  private codeKey(phone: string): string {
    return `sabou:${this.namespace}:code:${phone}`;
  }

  private ticketKey(ticket: string): string {
    return `sabou:${this.namespace}:ticket:${digest(ticket)}`;
  }

  async hit(key: string, limit: number, windowSeconds: number): Promise<number | null> {
    const fullKey = `sabou:${this.namespace}:limite:${key}`;
    const [[, count], , [, ttl]] = (await this.valkey
      .multi()
      .incr(fullKey)
      .expire(fullKey, windowSeconds, 'NX')
      .ttl(fullKey)
      .exec()) as [[null, number], [null, number], [null, number]];
    return count > limit ? Math.max(ttl, 1) : null;
  }

  async saveCode(phone: string, code: string): Promise<void> {
    await this.valkey.set(
      this.codeKey(phone),
      JSON.stringify({ hash: digest(`${phone}:${code}`), attempts: 0 }),
      'EX',
      SIGNUP_CODE_SECONDS,
    );
  }

  async checkCode(phone: string, code: string): Promise<CodeCheck> {
    const [status, remaining] = (await this.valkey.eval(
      CHECK_CODE,
      1,
      this.codeKey(phone),
      digest(`${phone}:${code}`),
      SIGNUP_CODE_ATTEMPTS,
    )) as [number, number?];
    if (status === 1) return { result: 'valid' };
    if (status === -1 || !remaining) return { result: 'expired' };
    return { result: 'invalid', remainingAttempts: remaining };
  }

  async issueTicket(phone: string): Promise<string> {
    const ticket = randomBytes(32).toString('base64url');
    await this.valkey.set(this.ticketKey(ticket), phone, 'EX', SIGNUP_TICKET_SECONDS);
    return ticket;
  }

  peekTicket(ticket: string): Promise<string | null> {
    return this.valkey.get(this.ticketKey(ticket));
  }

  takeTicket(ticket: string): Promise<string | null> {
    return this.valkey.getdel(this.ticketKey(ticket));
  }

  async restoreTicket(ticket: string, phone: string): Promise<void> {
    await this.valkey.set(this.ticketKey(ticket), phone, 'EX', SIGNUP_TICKET_SECONDS);
  }
}
