import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  healthReportDecisionSchema,
  healthReportReferenceSchema,
  healthReportRequestSchema,
  suspensionLiftSchema,
  treatmentCodeSchema,
  zoneListQuerySchema,
  type HealthReportItem,
  type HealthReportReceipt,
  type SuspendedTreatment,
  type ZonePage,
} from '@sabou/types';
import { parse, type SessionRequest } from '../accounts/accounts.controller';
import { AdministratorGuard } from '../certification/certification.controller';
import { ENV, type Env } from '../config/env';
import { ZoneContextError } from '../database/zone';
import { parseBody, requireSiteOrApp, withRetryAfter } from '../signup/public-http';
import { SignupHttpError } from '../signup/signup.service';
import type { SignupStore } from '../signup/signup.store';
import {
  HealthReportClosedError,
  HealthReportDecisionRefusedError,
  HealthReportNotAllowedError,
  HealthReportNotFoundError,
  HealthReportsRepository,
  HealthReportUnknownObjectError,
  SuspensionLiftBlockedError,
} from './health-reports.repository';

// Limite par adresse IP du dépôt public (05 §2.83). Assez large pour une adresse partagée par
// beaucoup d'abonnés mobiles (traduction d'adresses des opérateurs), assez basse pour qu'un
// robot ne remplisse pas la file du Comité.
export const REPORT_LIMIT = { limit: 10, windowSeconds: 60 * 60 } as const;
export const HEALTH_REPORT_STORE = Symbol('HEALTH_REPORT_STORE');

// Signaler un danger ou un effet indésirable (US-100, R-SAN-01, R-SAN-02) : ouvert à tous,
// sans compte, depuis le site. Protection sans service externe : origine du site, limite par
// adresse IP, leurre (champ caché rempli seulement par les robots : réponse identique, rien
// n'est enregistré).
@Controller('api/signalements')
export class PublicHealthReportsController {
  private readonly siteOrigin: string;

  constructor(
    @Inject(ENV) env: Env,
    @Inject(HEALTH_REPORT_STORE) private readonly store: SignupStore,
    private readonly repository: HealthReportsRepository,
  ) {
    this.siteOrigin = new URL(env.SITE_URL).origin;
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async deposit(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthReportReceipt> {
    requireSiteOrApp(req, this.siteOrigin);
    const { site, ...report } = parseBody(healthReportRequestSchema, body);
    return withRetryAfter(res, async () => {
      const retryAfter = await this.store.hit(
        `ip:${req.ip ?? 'inconnue'}`,
        REPORT_LIMIT.limit,
        REPORT_LIMIT.windowSeconds,
      );
      if (retryAfter !== null) {
        throw new SignupHttpError(
          HttpStatus.TOO_MANY_REQUESTS,
          { error: 'too_many', message: 'Trop de signalements envoyés. Réessayez plus tard.' },
          retryAfter,
        );
      }
      if (site) return { reference: `SIG-${String(randomInt(1, 100_000)).padStart(5, '0')}` };
      try {
        return { reference: await this.repository.deposit(report) };
      } catch (error) {
        if (error instanceof HealthReportUnknownObjectError) {
          throw new SignupHttpError(HttpStatus.BAD_REQUEST, {
            error: 'invalid',
            message: 'Aucun traitement ni aucune plante publiés ne portent ce code. Vérifiez-le.',
          });
        }
        throw error;
      }
    });
  }
}

function committeeError(error: unknown): never {
  if (error instanceof ZoneContextError || error instanceof HealthReportNotAllowedError) {
    throw new ForbiddenException({
      error: 'not_allowed',
      message: 'Réservé au Comité scientifique.',
    });
  }
  if (error instanceof HealthReportNotFoundError) {
    throw new NotFoundException({
      error: 'not_found',
      message: 'Introuvable. Rechargez la liste.',
    });
  }
  if (error instanceof HealthReportClosedError) {
    throw new ConflictException({
      error: 'stale',
      message: 'Ce signalement est déjà traité. Rechargez la liste.',
    });
  }
  if (error instanceof HealthReportDecisionRefusedError) {
    throw new ConflictException({
      error: 'refused',
      message:
        'Décision impossible sur cet objet : une plante ne se suspend ni ne se retire, et un traitement retiré ne change plus.',
    });
  }
  if (error instanceof SuspensionLiftBlockedError) {
    throw new ConflictException({
      error: 'blocked',
      message:
        'Le traitement ne remplit plus les conditions de certification (certificat du praticien, plantes, sections) : il ne peut pas revenir en ligne.',
    });
  }
  throw error;
}

// File et décisions du Comité scientifique (US-100, R-SAN-03) : administrateurs connectés,
// depuis l'application de gestion ; le rôle est vérifié par la base.
@Controller('api/signalements')
@UseGuards(AdministratorGuard)
export class HealthReportsController {
  constructor(private readonly repository: HealthReportsRepository) {}

  @Get('a-traiter')
  @Header('Cache-Control', 'no-store')
  queue(@Query() query: unknown, @Req() req: SessionRequest): Promise<ZonePage<HealthReportItem>> {
    const parsed = parse(zoneListQuerySchema, query);
    return this.repository.queue(req.session!.sub, parsed).catch(committeeError);
  }

  @Post(':reference/decision')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async decide(
    @Param('reference') reference: string,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<void> {
    const { decision, motif } = parse(healthReportDecisionSchema, body);
    await this.repository
      .decide(
        req.session!.sub,
        req.ip,
        parse(healthReportReferenceSchema, reference),
        decision,
        motif,
      )
      .catch(committeeError);
  }

  @Get('suspendus')
  @Header('Cache-Control', 'no-store')
  suspended(@Req() req: SessionRequest): Promise<SuspendedTreatment[]> {
    return this.repository.suspended(req.session!.sub).catch(committeeError);
  }

  @Post('suspendus/:code/levee')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async lift(
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<void> {
    const { motif } = parse(suspensionLiftSchema, body);
    await this.repository
      .liftSuspension(req.session!.sub, req.ip, parse(treatmentCodeSchema, code), motif)
      .catch(committeeError);
  }
}
