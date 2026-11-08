import { Controller, ForbiddenException, Get, Header, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { DashboardSummary } from '@sabou/types';
import type { SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { ZoneContextError } from '../database/zone';
import { DashboardRepository } from './dashboard.repository';

type SessionRequest = Request & { session?: SessionData };

// Tableau de bord d'accueil (US-016) : administrateurs avec second facteur, chiffres de leur zone
@Controller('api/tableau-de-bord')
@UseGuards(AdministratorGuard)
export class DashboardController {
  constructor(private readonly repository: DashboardRepository) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async summary(@Req() req: SessionRequest): Promise<DashboardSummary> {
    try {
      return await this.repository.summary(req.session!.sub);
    } catch (error) {
      // Compte inconnu ou suspendu entre-temps : refus, sans dire lequel des deux
      if (error instanceof ZoneContextError) throw new ForbiddenException();
      throw error;
    }
  }
}
