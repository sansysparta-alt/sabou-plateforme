import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  localNameCreateSchema,
  plantCodeSchema,
  plantSearchSchema,
  type LocalNamesPlant,
  type LocalNamesPlantSummary,
  type RecordingLanguage,
} from '@sabou/types';
import { parse, type SessionRequest } from '../accounts/accounts.controller';
import { AdministratorGuard } from '../certification/certification.controller';
import { ZoneContextError } from '../database/zone';
import {
  LocalNameNotAllowedError,
  LocalNameNotFoundError,
  LocalNamePlantNotFoundError,
  LocalNamesRepository,
  LocalNameTakenError,
  LocalNameVoiceError,
} from './local-names.repository';

function localNameError(error: unknown): never {
  if (error instanceof ZoneContextError || error instanceof LocalNameNotAllowedError) {
    throw new ForbiddenException({
      error: 'not_allowed',
      message: 'Les noms d’une langue sont saisis par le référent de cette langue.',
    });
  }
  if (error instanceof LocalNamePlantNotFoundError) {
    throw new NotFoundException({ error: 'not_found', message: 'Fiche plante introuvable.' });
  }
  if (error instanceof LocalNameNotFoundError) {
    throw new NotFoundException({ error: 'name_not_found', message: 'Nom local introuvable.' });
  }
  if (error instanceof LocalNameTakenError) {
    throw new ConflictException({
      error: 'name_taken',
      message: 'Ce nom est déjà saisi pour cette plante et cette langue.',
    });
  }
  if (error instanceof LocalNameVoiceError) {
    throw new ConflictException({
      error: 'voice_not_ready',
      message: 'La voix n’est pas encore traitée, ou elle a été déposée par un autre compte.',
    });
  }
  throw error;
}

function plantCode(code: string): string {
  const result = plantCodeSchema.safeParse(code);
  if (!result.success) {
    throw new BadRequestException({ error: 'invalid_code', message: 'Code de plante invalide.' });
  }
  return result.data;
}

// Noms locaux des plantes (US-053, UC-12) : ouverts à tout administrateur connecté avec son
// second facteur ; la base n'accepte l'écriture que du référent de la langue (droit
// d'enregistrer, R-GOV-06). Une modification ne vient que de l'application de gestion.
@Controller('api/noms-locaux')
@UseGuards(AdministratorGuard)
export class LocalNamesController {
  constructor(private readonly repository: LocalNamesRepository) {}

  @Get('langues')
  @Header('Cache-Control', 'no-store')
  languages(@Req() req: SessionRequest): Promise<RecordingLanguage[]> {
    return this.repository.languages(req.session!.sub).catch(localNameError);
  }

  @Get('plantes')
  @Header('Cache-Control', 'no-store')
  plants(@Query() query: unknown, @Req() req: SessionRequest): Promise<LocalNamesPlantSummary[]> {
    const { q } = parse(plantSearchSchema, query);
    return this.repository.plants(req.session!.sub, q || undefined).catch(localNameError);
  }

  @Get('plantes/:code')
  @Header('Cache-Control', 'no-store')
  plant(@Param('code') code: string, @Req() req: SessionRequest): Promise<LocalNamesPlant> {
    return this.repository.plant(req.session!.sub, plantCode(code)).catch(localNameError);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  add(@Body() body: unknown, @Req() req: SessionRequest): Promise<LocalNamesPlant> {
    const input = parse(localNameCreateSchema, body);
    return this.repository.add(req.session!.sub, req.ip, input).catch(localNameError);
  }

  @Post(':id/principal')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  makePrincipal(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: SessionRequest,
  ): Promise<LocalNamesPlant> {
    return this.repository.makePrincipal(req.session!.sub, req.ip, id).catch(localNameError);
  }

  @Delete(':id')
  @Header('Cache-Control', 'no-store')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: SessionRequest,
  ): Promise<LocalNamesPlant> {
    return this.repository.remove(req.session!.sub, req.ip, id).catch(localNameError);
  }
}
