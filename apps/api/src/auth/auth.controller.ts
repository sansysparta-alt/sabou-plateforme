import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { SessionUser } from '@sabou/types';
import { ENV, type Env } from '../config/env';
import { IDENTITY_PROVIDER, type IdentityProvider } from './identity-provider';
import {
  LOGIN_TRANSACTION_SECONDS,
  SESSION_STORE,
  type SessionData,
  type SessionStore,
} from './session.store';

// Préfixe __Host- : cookie limité à l'hôte exact, Secure et Path=/ imposés par le navigateur
export const SESSION_COOKIE = '__Host-sabou_session';
export const LOGIN_COOKIE = '__Host-sabou_login';

// Rôle porté par les 4 profils d'administration (DG, régional, préfectoral, Comité)
const ADMINISTRATOR_ROLE = 'administrateur';

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=') || undefined;
  }
  return undefined;
}

// Chemin interne seulement : jamais « //hote » ni « /\hote », qui mèneraient hors du site
export function safeReturnTo(value: unknown): string {
  return typeof value === 'string' && /^\/(?![/\\])[\w\-./?=&%#]*$/.test(value) ? value : '/';
}

export function toSessionUser(session: SessionData): SessionUser {
  return {
    username: session.username,
    name: session.name,
    roles: session.roles,
    administrator: session.roles.includes(ADMINISTRATOR_ROLE),
    secondFactor: session.secondFactor,
  };
}

// Connexion à l'application de gestion (US-010). L'API sert d'intermédiaire (« BFF ») :
// elle échange le code d'autorisation, vérifie le jeton d'identité et garde les jetons ;
// le navigateur ne reçoit qu'un cookie de session HttpOnly.
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger('Auth');
  private readonly appOrigin: string;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(IDENTITY_PROVIDER) private readonly idp: IdentityProvider,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
  ) {
    this.appOrigin = new URL(env.ADMIN_APP_URL).origin;
  }

  @Get('login')
  @Header('Cache-Control', 'no-store')
  async login(
    @Query('returnTo') returnTo: unknown,
    @Query('action') action: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const { url, tx } = await this.idp.startLogin(
      safeReturnTo(returnTo),
      action === 'configure-totp' ? 'configure-totp' : undefined,
    );
    await this.sessions.saveLogin(tx);
    // Lie la connexion à ce navigateur : un lien de retour forgé par un tiers est refusé
    res.cookie(LOGIN_COOKIE, tx.state, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: LOGIN_TRANSACTION_SECONDS * 1000,
    });
    res.redirect(303, url);
  }

  @Get('callback')
  @Header('Cache-Control', 'no-store')
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.clearCookie(LOGIN_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    const tx =
      state && state === readCookie(req, LOGIN_COOKIE)
        ? await this.sessions.takeLogin(state)
        : null;
    if (!tx) {
      this.logger.warn(
        'Connexion refusée : transaction absente, expirée ou étrangère à ce navigateur',
      );
      return this.fail(res, 'connexion');
    }
    if (typeof req.query.error === 'string') {
      // Annulation par l'utilisateur ou refus de Keycloak : rien à journaliser de plus ici
      return this.fail(res, req.query.error === 'access_denied' ? 'annulee' : 'connexion');
    }

    let result: Awaited<ReturnType<IdentityProvider['finishLogin']>>;
    try {
      result = await this.idp.finishLogin(new URL(req.originalUrl, this.env.ADMIN_APP_URL), tx);
    } catch (error) {
      this.logger.warn(`Connexion refusée : échange du code impossible (${(error as Error).name})`);
      return this.fail(res, 'connexion');
    }
    const { claims, refreshToken } = result;
    const secondFactor = claims.amr.includes('otp');
    // Défense en profondeur (R-ACC-03) : Keycloak impose déjà le second facteur aux
    // administrateurs ; l'API refuse quand même une connexion qui ne l'a pas utilisé.
    if (claims.roles.includes(ADMINISTRATOR_ROLE) && !secondFactor) {
      this.logger.warn(`Connexion refusée : administrateur ${claims.sub} sans second facteur`);
      await this.idp.logout(refreshToken).catch(() => undefined);
      return this.fail(res, 'double-facteur');
    }

    const id = await this.sessions.create({
      sub: claims.sub,
      username: claims.username,
      name: claims.name,
      roles: claims.roles,
      secondFactor,
      refreshToken,
      createdAt: Date.now(),
    });
    // Cookie de session du navigateur (sans date) ; la durée réelle est tenue par le serveur
    res.cookie(SESSION_COOKIE, id, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    this.logger.log(
      `Connexion : ${claims.sub} (${secondFactor ? 'second facteur' : 'mot de passe seul'})`,
    );
    const target = new URL(tx.returnTo, this.env.ADMIN_APP_URL);
    // Action demandée par l'application (activation du double facteur) menée à bien
    if (req.query.kc_action_status === 'success') target.searchParams.set('info', 'double-facteur');
    res.redirect(303, target.href);
  }

  @Get('session')
  @Header('Cache-Control', 'no-store')
  async session(@Req() req: Request): Promise<SessionUser> {
    const id = readCookie(req, SESSION_COOKIE);
    const session = id ? await this.sessions.touch(id) : null;
    if (!session) throw new UnauthorizedException();
    return toSessionUser(session);
  }

  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    // Protection contre la falsification de requête : seule l'application peut déconnecter
    if (req.headers.origin !== this.appOrigin) throw new ForbiddenException();
    const id = readCookie(req, SESSION_COOKIE);
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    const session = id ? await this.sessions.touch(id) : null;
    if (!id || !session) return;
    await this.sessions.destroy(id);
    // La session de l'API est close quoi qu'il arrive ; un échec de Keycloak est journalisé
    await this.idp.logout(session.refreshToken).catch((error: unknown) => {
      this.logger.error(`Déconnexion Keycloak impossible : ${(error as Error).message}`);
    });
    this.logger.log(`Déconnexion : ${session.sub}`);
  }

  private fail(res: Response, reason: 'connexion' | 'annulee' | 'double-facteur'): void {
    res.redirect(303, new URL(`/?erreur=${reason}`, this.env.ADMIN_APP_URL).href);
  }
}
