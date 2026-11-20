import { Controller, ForbiddenException, Get, Header, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { DashboardSummary, PractitionerDashboard } from '@sabou/types';
import type { SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { ZoneContextError } from '../database/zone';
import { PractitionerGuard } from '../dossiers/dossiers.controller';
import { DashboardRepository } from './dashboard.repository';

type SessionRequest = Request & { session?: SessionData };
type PractitionerRequest = Request & { practitioner?: { sub: string } };

// Compte inconnu, suspendu ou d'un autre profil : refus, sans dire lequel
function refuse(error: unknown): never {
  if (error instanceof ZoneContextError) throw new ForbiddenException();
  throw error;
}

// Tableau de bord d'accueil (US-016, US-090) : administrateurs avec second facteur, chiffres de
// leur zone et indicateurs de leur profil
@Controller('api/tableau-de-bord')
@UseGuards(AdministratorGuard)
export class DashboardController {
  constructor(private readonly repository: DashboardRepository) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async summary(@Req() req: SessionRequest): Promise<DashboardSummary> {
    return this.repository.summary(req.session!.sub).catch(refuse);
  }
}

// Tableau de bord du praticien (US-090, §6.6) : application mobile, jeton du praticien
@Controller('api/praticien/tableau-de-bord')
@UseGuards(PractitionerGuard)
export class PractitionerDashboardController {
  constructor(private readonly repository: DashboardRepository) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async mine(@Req() req: PractitionerRequest): Promise<PractitionerDashboard> {
    return this.repository.practitioner(req.practitioner!.sub).catch(refuse);
  }
}
