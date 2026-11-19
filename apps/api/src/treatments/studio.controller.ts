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
  Put,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  plantProposalSchema,
  treatmentCodeSchema,
  treatmentFieldsSchema,
  treatmentUpdateSchema,
  type StudioReferentials,
  type TreatmentDetail,
  type TreatmentSummary,
} from '@sabou/types';
import { parse } from '../accounts/accounts.controller';
import { ZoneContextError } from '../database/zone';
import { PractitionerGuard } from '../dossiers/dossiers.controller';
import {
  PlantProposalLimitError,
  PlantProposalRefusedError,
  StudioNoProfileError,
  StudioRepository,
  TreatmentIncompleteError,
  TreatmentInvalidError,
  TreatmentLockedError,
  TreatmentNoDossierError,
  TreatmentNotFoundError,
  TreatmentRejectedPractitionerError,
  TreatmentStaleError,
} from './studio.repository';

type PractitionerRequest = Request & { practitioner?: { sub: string } };

export function studioError(error: unknown): never {
  if (error instanceof ZoneContextError) throw new ForbiddenException();
  if (error instanceof PlantProposalRefusedError) {
    throw new ConflictException({ error: 'duplicate', message: error.message });
  }
  if (error instanceof PlantProposalLimitError) {
    throw new ConflictException({ error: 'too_many', message: error.message });
  }
  if (error instanceof StudioNoProfileError) {
    throw new ConflictException({
      error: 'no_profile',
      message: 'Créez d’abord votre fiche de praticien, dans votre dossier de certification.',
    });
  }
  if (error instanceof TreatmentNotFoundError) {
    throw new NotFoundException({ error: 'not_found', message: 'Traitement introuvable.' });
  }
  if (error instanceof TreatmentLockedError) {
    throw new ConflictException({
      error: 'locked',
      message: 'Ce traitement a été soumis : il ne se modifie plus.',
    });
  }
  if (error instanceof TreatmentStaleError) {
    throw new ConflictException({
      error: 'stale',
      message: 'Ce traitement a été modifié entre-temps. Rechargez-le avant de l’enregistrer.',
    });
  }
  if (error instanceof TreatmentNoDossierError) {
    throw new ConflictException({
      error: 'no_dossier',
      message:
        'Ouvrez votre dossier de certification avant de soumettre un traitement : il y sera joint.',
    });
  }
  if (error instanceof TreatmentRejectedPractitionerError) {
    throw new ConflictException({
      error: 'rejected',
      message:
        'Votre certification a été refusée définitivement : ce traitement ne progresse plus.',
    });
  }
  if (error instanceof TreatmentIncompleteError) {
    throw new UnprocessableEntityException({
      error: 'incomplete',
      message: 'Traitement incomplet.',
      gaps: error.gaps,
    });
  }
  if (error instanceof TreatmentInvalidError) {
    throw new BadRequestException({
      error: 'invalid',
      message: 'Saisie refusée. Rechargez la page.',
    });
  }
  throw error;
}

const treatmentCode = (code: string) => parse(treatmentCodeSchema, code);

// Studio web du praticien (US-060, UC-21) : session du site ou jeton de l'application mobile
// (PractitionerGuard) ; toujours ses propres traitements, lus et écrits dans son contexte.
@Controller('api/praticien')
@UseGuards(PractitionerGuard)
export class StudioController {
  constructor(private readonly repository: StudioRepository) {}

  // Listes du formulaire ; peu changeantes : cache privé de 5 minutes
  @Get('studio/referentiels')
  @Header('Cache-Control', 'private, max-age=300')
  referentials(): Promise<StudioReferentials> {
    return this.repository.referentials();
  }

  @Get('traitements')
  @Header('Cache-Control', 'no-store')
  list(@Req() req: PractitionerRequest): Promise<TreatmentSummary[]> {
    return this.repository.list(req.practitioner!.sub).catch(studioError);
  }

  @Get('traitements/:code')
  @Header('Cache-Control', 'no-store')
  detail(@Param('code') code: string, @Req() req: PractitionerRequest): Promise<TreatmentDetail> {
    return this.repository.detail(req.practitioner!.sub, treatmentCode(code)).catch(studioError);
  }

  @Post('traitements')
  @Header('Cache-Control', 'no-store')
  create(@Body() body: unknown, @Req() req: PractitionerRequest): Promise<TreatmentDetail> {
    const fields = parse(treatmentFieldsSchema, body);
    return this.repository
      .save(req.practitioner!.sub, req.ip, null, null, fields)
      .catch(studioError);
  }

  @Put('traitements/:code')
  @Header('Cache-Control', 'no-store')
  update(
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() req: PractitionerRequest,
  ): Promise<TreatmentDetail> {
    const { vueLe, fields } = parse(treatmentUpdateSchema, body);
    return this.repository
      .save(req.practitioner!.sub, req.ip, treatmentCode(code), vueLe, fields)
      .catch(studioError);
  }

  // US-054 : proposer une plante qui manque au Dictionnaire (créée « en revue »)
  @Post('plantes')
  @Header('Cache-Control', 'no-store')
  propose(
    @Body() body: unknown,
    @Req() req: PractitionerRequest,
  ): Promise<StudioReferentials['plantes'][number]> {
    const input = parse(plantProposalSchema, body);
    return this.repository.propose(req.practitioner!.sub, input).catch(studioError);
  }

  @Post('traitements/:code/soumission')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  submit(@Param('code') code: string, @Req() req: PractitionerRequest): Promise<TreatmentDetail> {
    return this.repository
      .submit(req.practitioner!.sub, req.ip, treatmentCode(code))
      .catch(studioError);
  }
}
