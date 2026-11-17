import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createLanguageSchema,
  languageCodeSchema,
  createSpecialtySchema,
  createTerritorySchema,
  renameTerritorySchema,
  territoryLevelSchema,
  updateLanguageSchema,
  updateSpecialtySchema,
  type Referentials,
} from '@sabou/types';
import { DirectorGuard, actor, parse, type SessionRequest } from '../accounts/accounts.controller';
import { ReferentialsRepository } from './referentials.repository';
import { ReferentialsService } from './referentials.service';

const languageCode = (code: string) => parse(languageCodeSchema, code);

// Référentiels paramétrés par la DG, sans modifier le code (lot C : US-020, US-021, UC-65).
// Réservé à la DG connectée avec son second facteur ; les décisions ne viennent que de
// l'application de gestion (en-tête Origin, voir DirectorGuard).
@Controller('api/referentiels')
@UseGuards(DirectorGuard)
export class ReferentialsController {
  constructor(
    private readonly service: ReferentialsService,
    private readonly repository: ReferentialsRepository,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  all(): Promise<Referentials> {
    return this.repository.all();
  }

  @Post('langues')
  @HttpCode(204)
  createLanguage(@Body() body: unknown, @Req() req: SessionRequest): Promise<void> {
    return this.service.createLanguage(parse(createLanguageSchema, body), actor(req));
  }

  @Patch('langues/:code')
  @HttpCode(204)
  updateLanguage(
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<void> {
    return this.service.updateLanguage(
      languageCode(code),
      parse(updateLanguageSchema, body),
      actor(req),
    );
  }

  @Post('specialites')
  @HttpCode(204)
  createSpecialty(@Body() body: unknown, @Req() req: SessionRequest): Promise<void> {
    return this.service.createSpecialty(parse(createSpecialtySchema, body), actor(req));
  }

  @Patch('specialites/:id')
  @HttpCode(204)
  updateSpecialty(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<void> {
    return this.service.updateSpecialty(id, parse(updateSpecialtySchema, body), actor(req));
  }

  // US-063 : contre-indications structurées, même règles que les spécialités
  @Post('contre-indications')
  @HttpCode(204)
  createContraindication(@Body() body: unknown, @Req() req: SessionRequest): Promise<void> {
    return this.service.createContraindication(parse(createSpecialtySchema, body), actor(req));
  }

  @Patch('contre-indications/:id')
  @HttpCode(204)
  updateContraindication(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<void> {
    return this.service.updateContraindication(id, parse(updateSpecialtySchema, body), actor(req));
  }

  @Post(':level')
  @HttpCode(204)
  createTerritory(
    @Param('level') level: string,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<void> {
    return this.service.createTerritory(
      parse(territoryLevelSchema, level),
      parse(createTerritorySchema, body),
      actor(req),
    );
  }

  @Patch(':level/:id')
  @HttpCode(204)
  renameTerritory(
    @Param('level') level: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<void> {
    return this.service.renameTerritory(
      parse(territoryLevelSchema, level),
      id,
      parse(renameTerritorySchema, body).name,
      actor(req),
    );
  }
}
