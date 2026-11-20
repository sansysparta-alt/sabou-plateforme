import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  alertCloseSchema,
  alertDeclareSchema,
  alertIdSchema,
  type AlertReferentials,
  type TerritorialAlert,
} from '@sabou/types';
import { parse } from '../accounts/accounts.controller';
import type { SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { ZoneContextError } from '../database/zone';
import {
  AlertNotAllowedError,
  AlertNotFoundError,
  AlertRefusedError,
  AlertsRepository,
} from './alerts.repository';

type SessionRequest = Request & { session?: SessionData };

function alertError(error: unknown): never {
  if (error instanceof ZoneContextError) throw new ForbiddenException();
  if (error instanceof AlertNotFoundError) {
    throw new NotFoundException({
      error: 'not_found',
      message: 'Alerte introuvable dans votre zone.',
    });
  }
  if (error instanceof AlertNotAllowedError) {
    throw new ForbiddenException({
      error: 'not_allowed',
      message:
        'Action réservée : le préfectoral et la DG déclarent une hausse de pathologie ; le régional et la DG relancent et closent.',
    });
  }
  if (error instanceof AlertRefusedError) {
    throw new ConflictException({ error: error.code, message: error.message });
  }
  throw error;
}

// Alertes territoriales (US-102, UC-44) dans l'application de gestion : administration
// connectée avec son second facteur ; la base choisit les alertes visibles et les actions.
@Controller('api/alertes')
@UseGuards(AdministratorGuard)
export class AlertsController {
  constructor(private readonly repository: AlertsRepository) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() req: SessionRequest): Promise<TerritorialAlert[]> {
    return this.repository.list(req.session!.sub).catch(alertError);
  }

  @Get('referentiels')
  @Header('Cache-Control', 'no-store')
  referentials(@Req() req: SessionRequest): Promise<AlertReferentials> {
    return this.repository.referentials(req.session!.sub).catch(alertError);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  declare(@Body() body: unknown, @Req() req: SessionRequest): Promise<{ id: number }> {
    return this.repository
      .declare(req.session!.sub, req.ip, parse(alertDeclareSchema, body))
      .catch(alertError);
  }

  @Post(':id/accuse')
  @HttpCode(204)
  acknowledge(@Param('id') id: string, @Req() req: SessionRequest): Promise<void> {
    return this.repository
      .acknowledge(req.session!.sub, req.ip, parse(alertIdSchema, id))
      .catch(alertError);
  }

  @Post(':id/relance')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  relaunch(@Param('id') id: string, @Req() req: SessionRequest): Promise<{ prevenus: number }> {
    return this.repository
      .relaunch(req.session!.sub, req.ip, parse(alertIdSchema, id))
      .catch(alertError);
  }

  @Post(':id/cloture')
  @HttpCode(204)
  close(@Param('id') id: string, @Body() body: unknown, @Req() req: SessionRequest): Promise<void> {
    const { motif } = parse(alertCloseSchema, body);
    return this.repository
      .close(req.session!.sub, req.ip, parse(alertIdSchema, id), motif)
      .catch(alertError);
  }
}
