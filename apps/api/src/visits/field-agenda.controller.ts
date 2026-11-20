import { Controller, ForbiddenException, Get, Header, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { FieldAgendaItem } from '@sabou/types';
import type { SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { ZoneContextError } from '../database/zone';
import { VisitsRepository } from './visits.repository';

type SessionRequest = Request & { session?: SessionData };

// Agenda de l'agent préfectoral (US-083, UC-30), lu par l'application mobile avec le jeton du
// client « sabou-terrain » (second facteur, §2.86) ou par la gestion. La base ne rend rien à
// un autre profil que le préfectoral actif, et seulement les dossiers de sa préfecture.
@Controller('api/terrain/visites')
@UseGuards(AdministratorGuard)
export class FieldAgendaController {
  constructor(private readonly repository: VisitsRepository) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async agenda(@Req() req: SessionRequest): Promise<FieldAgendaItem[]> {
    try {
      return await this.repository.agenda(req.session!.sub);
    } catch (error) {
      if (error instanceof ZoneContextError) throw new ForbiddenException();
      throw error;
    }
  }
}
