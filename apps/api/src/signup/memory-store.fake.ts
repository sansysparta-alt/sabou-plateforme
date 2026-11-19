import { randomBytes } from 'node:crypto';
import { SIGNUP_CODE_ATTEMPTS, type CodeCheck, type SignupStore } from './signup.store';

// Pour les tests : même contrat que ValkeySignupStore, en mémoire (exclu de la compilation
// de production, tsconfig.build.json)
export class MemoryStore implements SignupStore {
  codes = new Map<string, { code: string; attempts: number }>();
  tickets = new Map<string, string>();
  counters = new Map<string, number>();
  async hit(key: string, limit: number, windowSeconds: number) {
    const count = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, count);
    return count > limit ? windowSeconds : null;
  }
  async saveCode(phone: string, code: string) {
    this.codes.set(phone, { code, attempts: 0 });
  }
  async checkCode(phone: string, code: string): Promise<CodeCheck> {
    const entry = this.codes.get(phone);
    if (!entry) return { result: 'expired' };
    if (entry.code === code) {
      this.codes.delete(phone);
      return { result: 'valid' };
    }
    entry.attempts += 1;
    const remainingAttempts = SIGNUP_CODE_ATTEMPTS - entry.attempts;
    if (remainingAttempts <= 0) {
      this.codes.delete(phone);
      return { result: 'expired' };
    }
    return { result: 'invalid', remainingAttempts };
  }
  async issueTicket(phone: string) {
    const ticket = randomBytes(32).toString('base64url');
    this.tickets.set(ticket, phone);
    return ticket;
  }
  async peekTicket(ticket: string) {
    return this.tickets.get(ticket) ?? null;
  }
  async takeTicket(ticket: string) {
    const phone = this.tickets.get(ticket) ?? null;
    this.tickets.delete(ticket);
    return phone;
  }
  async restoreTicket(ticket: string, phone: string) {
    this.tickets.set(ticket, phone);
  }
}
