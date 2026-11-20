import { Controller, Get, Header, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { FieldPractitioner } from '@sabou/types';
import type { SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { studioError } from './studio.controller';
import { StudioRepository } from './studio.repository';

type SessionRequest = Request & { session?: SessionData };

// US-082 : praticiens de sa préfecture auxquels l'agent préfectoral rattache une recette
// numérisée (application mobile, jeton « sabou-terrain » avec second facteur). La base ne
// rend rien à un autre profil (numerisation_praticiens()).
@Controller('api/terrain')
@UseGuards(AdministratorGuard)
export class FieldPractitionersController {
  constructor(private readonly repository: StudioRepository) {}

  @Get('praticiens')
  @Header('Cache-Control', 'no-store')
  list(@Req() req: SessionRequest): Promise<FieldPractitioner[]> {
    return this.repository.fieldPractitioners(req.session!.sub).catch(studioError);
  }
}
