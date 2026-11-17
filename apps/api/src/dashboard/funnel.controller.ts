import { Controller, ForbiddenException, Get, Header, Req, UseGuards } from '@nestjs/common';
import type { CertificationFunnel } from '@sabou/types';
import { DirectorGuard, type SessionRequest } from '../accounts/accounts.controller';
import { ZoneContextError } from '../database/zone';
import { FunnelRepository } from './funnel.repository';

// Entonnoir des 6 étapes et dossiers bloqués (US-048, UC-67) : DG seule, connectée avec son
// second facteur ; lecture seule
@Controller('api/entonnoir')
@UseGuards(DirectorGuard)
export class FunnelController {
  constructor(private readonly repository: FunnelRepository) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async funnel(@Req() req: SessionRequest): Promise<CertificationFunnel> {
    try {
      return await this.repository.funnel(req.session!.sub);
    } catch (error) {
      // Compte inconnu ou suspendu entre-temps : refus, sans dire lequel des deux
      if (error instanceof ZoneContextError) throw new ForbiddenException();
      throw error;
    }
  }
}
