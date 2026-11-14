import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  diseaseCodeSchema,
  diseaseFieldsSchema,
  diseaseSearchSchema,
  diseaseUpdateSchema,
  type DiseaseDetail,
  type DiseaseSummary,
} from '@sabou/types';
import { parse, type SessionRequest } from '../accounts/accounts.controller';
import { ZoneContextError } from '../database/zone';
import { PlantEditorGuard } from '../plants/plants.controller';
import {
  DiseaseNameTakenError,
  DiseaseNotAllowedError,
  DiseaseNotFoundError,
  DiseasesRepository,
  DiseaseStaleError,
} from './diseases.repository';

function diseaseError(error: unknown): never {
  if (error instanceof ZoneContextError || error instanceof DiseaseNotAllowedError) {
    throw new ForbiddenException({
      error: 'not_allowed',
      message: 'Les fiches maladies sont réservées à la DG et au Comité scientifique.',
    });
  }
  if (error instanceof DiseaseNotFoundError) {
    throw new NotFoundException({ error: 'not_found', message: 'Fiche maladie introuvable.' });
  }
  if (error instanceof DiseaseNameTakenError) {
    throw new ConflictException({
      error: 'name_taken',
      message: `Ce nom français est déjà celui de la fiche ${error.code}.`,
    });
  }
  if (error instanceof DiseaseStaleError) {
    throw new ConflictException({
      error: 'stale',
      message: 'Cette fiche a été modifiée entre-temps. Rechargez-la avant de l’enregistrer.',
    });
  }
  throw error;
}

const diseaseCode = (code: string) => parse(diseaseCodeSchema, code);

// Fiches maladies du Dictionnaire (US-052, UC-05) : mêmes profils que les fiches plantes (DG
// et Comité scientifique, second facteur) ; la base vérifie aussi le rôle.
@Controller('api/maladies')
@UseGuards(PlantEditorGuard)
export class DiseasesController {
  constructor(private readonly repository: DiseasesRepository) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query() query: unknown, @Req() req: SessionRequest): Promise<DiseaseSummary[]> {
    const { q } = parse(diseaseSearchSchema, query);
    return this.repository.list(req.session!.sub, q || undefined).catch(diseaseError);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  create(@Body() body: unknown, @Req() req: SessionRequest): Promise<DiseaseDetail> {
    const fields = parse(diseaseFieldsSchema, body);
    return this.repository.create(req.session!.sub, req.ip, fields).catch(diseaseError);
  }

  @Get(':code')
  @Header('Cache-Control', 'no-store')
  detail(@Param('code') code: string, @Req() req: SessionRequest): Promise<DiseaseDetail> {
    return this.repository.detail(req.session!.sub, diseaseCode(code)).catch(diseaseError);
  }

  @Patch(':code')
  @Header('Cache-Control', 'no-store')
  update(
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<DiseaseDetail> {
    const input = parse(diseaseUpdateSchema, body);
    return this.repository
      .update(req.session!.sub, req.ip, diseaseCode(code), input)
      .catch(diseaseError);
  }
}
