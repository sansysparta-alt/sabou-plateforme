// US-082 (décision du maître d'œuvre du 19 novembre 2026) : l'agent préfectoral accède aux
// routes d'administration depuis l'application mobile avec un jeton « Bearer » du client
// « sabou-terrain », second facteur exigé. Le chemin de la gestion (cookie) est inchangé.
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  InvalidMobileTokenError,
  type MobileIdentity,
  type MobileTokenVerifier,
} from '../auth/mobile-token';
import type { SessionData, SessionStore } from '../auth/session.store';
import type { Env } from '../config/env';
import { AdministratorGuard } from './certification.controller';

const env = { ADMIN_APP_URL: 'http://localhost:5173' } as Env;
const SUB = '60606060-6060-4060-8060-606060606060';
const TOKEN = 'aaa.bbb.ccc';

const agent: MobileIdentity = {
  sub: SUB,
  roles: ['administrateur', 'admin_prefectoral'],
  amr: ['pwd', 'otp'],
};

function verifier(identity: MobileIdentity | Error): MobileTokenVerifier {
  return {
    verify: (token) => {
      expect(token).toBe(TOKEN);
      return identity instanceof Error ? Promise.reject(identity) : Promise.resolve(identity);
    },
  };
}

const noSession = { touch: () => Promise.resolve(null) } as unknown as SessionStore;

function context(headers: Record<string, string>, method = 'POST') {
  const req: { headers: Record<string, string>; method: string; session?: SessionData } = {
    headers,
    method,
  };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as ExecutionContext;
  return { req, ctx };
}

describe('AdministratorGuard : agent préfectoral dans l’application mobile', () => {
  it('accepte le jeton de l’agent avec second facteur, sans contrôle d’origine', async () => {
    const guard = new AdministratorGuard(env, noSession, verifier(agent));
    const { req, ctx } = context({ authorization: `Bearer ${TOKEN}` });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.session).toMatchObject({ sub: SUB, secondFactor: true });
  });

  it('refuse un jeton sans second facteur (« otp » absent de « amr »)', async () => {
    const guard = new AdministratorGuard(env, noSession, verifier({ ...agent, amr: ['pwd'] }));
    const { ctx } = context({ authorization: `Bearer ${TOKEN}` });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    ['admin régional', ['administrateur', 'admin_regional']],
    ['Comité', ['administrateur', 'comite']],
    ['DG', ['administrateur', 'dg']],
    ['préfectoral sans le rôle composite', ['admin_prefectoral']],
  ])('refuse un autre profil : %s', async (_label, roles) => {
    const guard = new AdministratorGuard(env, noSession, verifier({ ...agent, roles }));
    const { ctx } = context({ authorization: `Bearer ${TOKEN}` });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuse un jeton invalide (401), sans retomber sur le cookie', async () => {
    const sessions = {
      touch: () => Promise.resolve({ roles: ['administrateur'], secondFactor: true }),
    } as unknown as SessionStore;
    const guard = new AdministratorGuard(env, sessions, verifier(new InvalidMobileTokenError()));
    const { ctx } = context({
      authorization: `Bearer ${TOKEN}`,
      cookie: '__Host-sabou_session=x',
      origin: 'http://localhost:5173',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuse un en-tête mal formé et l’absence de vérificateur', async () => {
    const guard = new AdministratorGuard(env, noSession, verifier(agent));
    await expect(
      guard.canActivate(context({ authorization: 'Basic abc' }).ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const bare = new AdministratorGuard(env, noSession);
    await expect(
      bare.canActivate(context({ authorization: `Bearer ${TOKEN}` }).ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('laisse remonter une panne des clés (503 plutôt que 401)', async () => {
    const guard = new AdministratorGuard(env, noSession, verifier(new Error('ECONNREFUSED')));
    await expect(
      guard.canActivate(context({ authorization: `Bearer ${TOKEN}` }).ctx),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('garde le contrôle d’origine pour la session de la gestion', async () => {
    const sessions = {
      touch: () => Promise.resolve({ roles: ['administrateur'], secondFactor: true }),
    } as unknown as SessionStore;
    const guard = new AdministratorGuard(env, sessions, verifier(agent));
    const { ctx } = context({ cookie: '__Host-sabou_session=x', origin: 'http://evil.test' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
