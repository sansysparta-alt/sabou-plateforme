import {
  BadRequestException,
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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  treatmentCodeSchema,
  treatmentDecisionSchema,
  zoneListQuerySchema,
  type TreatmentDecisionResult,
  type TreatmentQueueItem,
  type ZonePage,
} from '@sabou/types';
import { parse, type SessionRequest } from '../accounts/accounts.controller';
import { AdministratorGuard } from '../certification/certification.controller';
import { ZoneContextError } from '../database/zone';
import {
  CircuitRepository,
  TreatmentCertificationBlockedError,
  TreatmentChangedError,
  TreatmentDecisionNotAllowedError,
  TreatmentMotifRequiredError,
  TreatmentNotInZoneError,
  TreatmentPractitionerRejectedError,
} from './circuit.repository';

// Refus d'une décision : message rédigé pour l'écran, code pour le client
function circuitError(error: unknown): never {
  if (error instanceof ZoneContextError) throw new ForbiddenException();
  if (error instanceof TreatmentNotInZoneError) {
    throw new NotFoundException({
      error: 'not_found',
      message: 'Traitement introuvable dans votre zone.',
    });
  }
  if (error instanceof TreatmentDecisionNotAllowedError) {
    throw new ForbiddenException({
      error: 'not_allowed',
      message: 'Vous n’êtes pas responsable de cette étape pour ce traitement.',
    });
  }
  if (error instanceof TreatmentChangedError) {
    throw new ConflictException({
      error: 'stale',
      message: 'Ce traitement a changé d’étape entre-temps. Rechargez la liste.',
    });
  }
  if (error instanceof TreatmentMotifRequiredError) {
    throw new BadRequestException({ error: 'motif', message: 'Indiquez le motif du renvoi.' });
  }
  if (error instanceof TreatmentPractitionerRejectedError) {
    throw new ConflictException({
      error: 'rejected',
      message: 'Le praticien a été rejeté définitivement : ce traitement ne progresse plus.',
    });
  }
  if (error instanceof TreatmentCertificationBlockedError) {
    throw new ConflictException({
      error: 'blocked',
      message: 'Certification impossible : le traitement ne remplit pas toutes les conditions.',
    });
  }
  throw error;
}

// Circuit d'un traitement (US-061, R-REC-07) : administrateurs connectés avec leur second
// facteur, depuis l'application de gestion. Le rôle et la zone sont vérifiés par la base.
@Controller('api/traitements')
@UseGuards(AdministratorGuard)
export class CircuitController {
  constructor(private readonly repository: CircuitRepository) {}

  // Traitements qui attendent la décision du compte connecté, dans sa zone
  @Get('a-decider')
  @Header('Cache-Control', 'no-store')
  queue(
    @Query() query: unknown,
    @Req() req: SessionRequest,
  ): Promise<ZonePage<TreatmentQueueItem>> {
    const parsed = parse(zoneListQuerySchema, query);
    return this.repository.queue(req.session!.sub, parsed).catch(circuitError);
  }

  @Post(':code/decision')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  decide(
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<TreatmentDecisionResult> {
    const decision = parse(treatmentDecisionSchema, body);
    return this.repository
      .decide(req.session!.sub, req.ip, parse(treatmentCodeSchema, code), decision)
      .catch(circuitError);
  }
}
