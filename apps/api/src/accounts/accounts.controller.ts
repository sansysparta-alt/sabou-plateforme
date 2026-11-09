import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Inject,
  Injectable,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  acceptInvitationSchema,
  invitationTokenSchema,
  inviteRequestSchema,
  type AccountReferences,
  type AccountSummary,
  type InvitationLink,
  type InvitationPreview,
} from '@sabou/types';
import { readCookie, SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData, type SessionStore } from '../auth/session.store';
import { ENV, type Env } from '../config/env';
import { AccountsRepository } from './accounts.repository';
import { AccountsService, type Actor } from './accounts.service';

export type SessionRequest = Request & { session?: SessionData };

// Requête qui modifie quelque chose : seule l'application de gestion peut l'envoyer
// (protection contre la falsification de requête, en plus du cookie SameSite=Lax)
export function requireAppOrigin(req: Request, env: Env): void {
  if (req.method !== 'GET' && req.headers.origin !== new URL(env.ADMIN_APP_URL).origin) {
    throw new ForbiddenException();
  }
}

// Réservé à la Direction Générale (UC-65, R-ACC-04), connectée avec son second facteur
@Injectable()
export class DirectorGuard implements CanActivate {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<SessionRequest>();
    requireAppOrigin(req, this.env);
    const id = readCookie(req, SESSION_COOKIE);
    const session = id ? await this.sessions.touch(id) : null;
    if (!session) throw new UnauthorizedException();
    if (!session.roles.includes('dg') || !session.secondFactor) throw new ForbiddenException();
    req.session = session;
    return true;
  }
}

export function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((issue) => issue.message));
  }
  return result.data;
}

export const actor = (req: SessionRequest): Actor => ({ sub: req.session!.sub, ip: req.ip });

// Gestion des comptes par la DG (lot A : US-012, US-013)
@Controller('api/comptes')
@UseGuards(DirectorGuard)
export class AccountsController {
  constructor(
    private readonly service: AccountsService,
    private readonly repository: AccountsRepository,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() req: SessionRequest): Promise<AccountSummary[]> {
    return this.repository.list(req.session!.sub);
  }

  @Get('referentiels')
  @Header('Cache-Control', 'no-store')
  references(): Promise<AccountReferences> {
    return this.repository.references();
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  invite(@Body() body: unknown, @Req() req: SessionRequest): Promise<InvitationLink> {
    return this.service.invite(parse(inviteRequestSchema, body), actor(req));
  }

  @Post(':id/invitation')
  @Header('Cache-Control', 'no-store')
  renew(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: SessionRequest,
  ): Promise<InvitationLink> {
    return this.service.renewInvitation(id, actor(req));
  }

  @Post(':id/suspension')
  @HttpCode(204)
  suspend(@Param('id', ParseIntPipe) id: number, @Req() req: SessionRequest): Promise<void> {
    return this.service.suspend(id, actor(req));
  }

  @Post(':id/reactivation')
  @HttpCode(204)
  reactivate(@Param('id', ParseIntPipe) id: number, @Req() req: SessionRequest): Promise<void> {
    return this.service.reactivate(id, actor(req));
  }
}

// Acceptation d'une invitation, sans session. Le jeton voyage dans le corps de la requête
// (POST), jamais dans l'adresse : il n'apparaît pas dans les journaux des mandataires.
@Controller('api/invitation')
export class InvitationController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly service: AccountsService,
  ) {}

  @Post('consultation')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  preview(@Body() body: unknown, @Req() req: Request): Promise<InvitationPreview> {
    requireAppOrigin(req, this.env);
    const token = parse(invitationTokenSchema, (body as { token?: unknown } | null)?.token);
    return this.service.preview(token);
  }

  @Post('acceptation')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  accept(@Body() body: unknown, @Req() req: Request): Promise<void> {
    requireAppOrigin(req, this.env);
    const { token, password } = parse(acceptInvitationSchema, body);
    return this.service.accept(token, password, req.ip);
  }
}
