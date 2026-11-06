import {
  BadRequestException,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Injectable,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  zoneListQuerySchema,
  type DossierSummary,
  type PractitionerSummary,
  type ZoneListQuery,
  type ZonePage,
} from '@sabou/types';
import { readCookie, SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData, type SessionStore } from '../auth/session.store';
import { ZoneContextError } from '../database/zone';
import { CertificationRepository } from './certification.repository';

type SessionRequest = Request & { session?: SessionData };

// Rôle composite de Keycloak porté par les 4 profils d'administration (§2.20)
const ADMINISTRATOR_ROLE = 'administrateur';

// Réservé aux administrateurs connectés avec leur second facteur (R-ACC-03). La zone n'est
// pas contrôlée ici : la base l'applique (US-011).
@Injectable()
export class AdministratorGuard implements CanActivate {
  constructor(@Inject(SESSION_STORE) private readonly sessions: SessionStore) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<SessionRequest>();
    const id = readCookie(req, SESSION_COOKIE);
    const session = id ? await this.sessions.touch(id) : null;
    if (!session) throw new UnauthorizedException();
    if (!session.roles.includes(ADMINISTRATOR_ROLE) || !session.secondFactor) {
      throw new ForbiddenException();
    }
    req.session = session;
    return true;
  }
}

function parseQuery(query: unknown): ZoneListQuery {
  const result = zoneListQuerySchema.safeParse(query);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((issue) => issue.message));
  }
  return result.data;
}

// Compte inconnu ou suspendu entre-temps : refus, sans dire lequel des deux
async function inAccountZone<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ZoneContextError) throw new ForbiddenException();
    throw error;
  }
}

// Listes cloisonnées par zone (US-011). Les écrans arrivent avec les récits du workflow
// de certification (S2).
@Controller('api')
@UseGuards(AdministratorGuard)
export class CertificationController {
  constructor(private readonly repository: CertificationRepository) {}

  @Get('praticiens')
  @Header('Cache-Control', 'no-store')
  practitioners(
    @Query() query: unknown,
    @Req() req: SessionRequest,
  ): Promise<ZonePage<PractitionerSummary>> {
    const parsed = parseQuery(query);
    return inAccountZone(() => this.repository.listPractitioners(req.session!.sub, parsed));
  }

  @Get('dossiers')
  @Header('Cache-Control', 'no-store')
  dossiers(@Query() query: unknown, @Req() req: SessionRequest): Promise<ZonePage<DossierSummary>> {
    const parsed = parseQuery(query);
    return inAccountZone(() => this.repository.listDossiers(req.session!.sub, parsed));
  }
}
