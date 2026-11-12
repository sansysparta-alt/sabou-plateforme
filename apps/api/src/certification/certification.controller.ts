import {
  BadRequestException,
  Body,
  CanActivate,
  ConflictException,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  dossierCodeSchema,
  dossierDecisionSchema,
  zoneListQuerySchema,
  type DossierDecisionResult,
  type DossierSummary,
  type FieldVerificationItem,
  type PractitionerSummary,
  type ZoneListQuery,
  type ZonePage,
} from '@sabou/types';
import { parse, requireAppOrigin } from '../accounts/accounts.controller';
import { readCookie, SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData, type SessionStore } from '../auth/session.store';
import { ENV, type Env } from '../config/env';
import { ZoneContextError } from '../database/zone';
import {
  CertificationRepository,
  DecisionNotAllowedError,
  DossierNotFoundError,
  FieldVisitRequiredError,
  StaleDossierError,
} from './certification.repository';

type SessionRequest = Request & { session?: SessionData };

// Rôle composite de Keycloak porté par les 4 profils d'administration (§2.20)
const ADMINISTRATOR_ROLE = 'administrateur';

// Réservé aux administrateurs connectés avec leur second facteur (R-ACC-03). La zone n'est
// pas contrôlée ici : la base l'applique (US-011). Une décision ne peut venir que de
// l'application de gestion (en-tête Origin).
@Injectable()
export class AdministratorGuard implements CanActivate {
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

// Refus d'une décision : message rédigé pour l'écran, code pour le client
function decisionError(error: unknown): never {
  if (error instanceof DossierNotFoundError) {
    throw new NotFoundException({
      error: 'not_found',
      message: 'Dossier introuvable dans votre zone.',
    });
  }
  if (error instanceof DecisionNotAllowedError) {
    throw new ForbiddenException({
      error: 'not_allowed',
      message: 'Vous n’êtes pas responsable de cette étape pour ce dossier.',
    });
  }
  if (error instanceof StaleDossierError) {
    throw new ConflictException({
      error: 'stale',
      message: 'Ce dossier a changé d’étape entre-temps. Rechargez la liste.',
    });
  }
  if (error instanceof FieldVisitRequiredError) {
    throw new ConflictException({
      error: 'visit_required',
      message: 'Validation impossible : aucune visite réalisée avec compte rendu signé.',
    });
  }
  throw error;
}

// Listes cloisonnées par zone (US-011) et décisions du workflow de certification (US-042)
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

  // Dossiers en attente de vérification terrain (étape 2), dans la zone du compte
  @Get('dossiers/verification-terrain')
  @Header('Cache-Control', 'no-store')
  fieldVerification(
    @Query() query: unknown,
    @Req() req: SessionRequest,
  ): Promise<ZonePage<FieldVerificationItem>> {
    const parsed = parseQuery(query);
    return inAccountZone(() => this.repository.listFieldVerification(req.session!.sub, parsed));
  }

  // Valider ou rejeter un dossier (US-042 à l'étape 2 ; US-043 et US-044 ensuite)
  @Post('dossiers/:code/decision')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  decide(
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<DossierDecisionResult> {
    const dossier = parse(dossierCodeSchema, code);
    const input = parse(dossierDecisionSchema, body);
    return inAccountZone(() =>
      this.repository.decide(req.session!.sub, req.ip, dossier, input).catch(decisionError),
    );
  }
}
