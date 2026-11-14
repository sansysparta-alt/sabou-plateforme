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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  practitionerCodeSchema,
  rejectionSchema,
  rejectionSearchSchema,
  type RejectionCandidate,
  type RejectionResult,
} from '@sabou/types';
import { DirectorGuard, parse, type SessionRequest } from '../accounts/accounts.controller';
import { ZoneContextError } from '../database/zone';
import {
  AlreadyRejectedError,
  PractitionerNotFoundError,
  RejectionNotAllowedError,
  RejectionsRepository,
  StalePractitionerError,
} from './rejections.repository';

// Refus rédigés pour l'écran, avec un code pour le client
function rejectionError(error: unknown): never {
  // Compte suspendu ou inconnu de la base, ou rôle refusé par la base : sans dire lequel
  if (error instanceof ZoneContextError || error instanceof RejectionNotAllowedError) {
    throw new ForbiddenException({
      error: 'not_allowed',
      message: 'Le rejet définitif est réservé à la Direction Générale.',
    });
  }
  if (error instanceof PractitionerNotFoundError) {
    throw new NotFoundException({ error: 'not_found', message: 'Praticien introuvable.' });
  }
  if (error instanceof AlreadyRejectedError) {
    throw new ConflictException({
      error: 'already_rejected',
      message: 'Ce praticien est déjà rejeté définitivement.',
    });
  }
  if (error instanceof StalePractitionerError) {
    throw new ConflictException({
      error: 'stale',
      message: 'La situation de ce praticien a changé entre-temps. Relancez la recherche.',
    });
  }
  throw error;
}

// Rejet définitif d'un praticien (US-047, UC-61, R-CER-04) : DG seule, connectée avec son
// second facteur (contrôlé ici, puis par la base) ; décision depuis l'application de gestion
// seulement (en-tête Origin)
@Controller('api/praticiens')
@UseGuards(DirectorGuard)
export class RejectionsController {
  constructor(private readonly repository: RejectionsRepository) {}

  @Get('recherche')
  @Header('Cache-Control', 'no-store')
  search(@Query() query: unknown, @Req() req: SessionRequest): Promise<RejectionCandidate[]> {
    const { q } = parse(rejectionSearchSchema, query);
    return this.repository.search(req.session!.sub, q).catch(rejectionError);
  }

  @Post(':code/rejet-definitif')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  reject(
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<RejectionResult> {
    const practitioner = parse(practitionerCodeSchema, code);
    const input = parse(rejectionSchema, body);
    return this.repository
      .reject(req.session!.sub, req.ip, practitioner, input)
      .catch(rejectionError);
  }
}
