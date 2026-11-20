import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdministratorGuard } from '../certification/certification.controller';
import { pieceStorageProvider } from '../dossiers/piece-storage';
import { FieldAgendaController } from './field-agenda.controller';
import { VisitsController } from './visits.controller';
import { VisitsRepository } from './visits.repository';

// Visites terrain de l'admin préfectoral (US-041). Le rappel de la veille est mis en file
// par la relève des SMS (sms/sms-dispatcher.ts). Agenda de l'agent sur le téléphone (US-083).
@Module({
  imports: [AuthModule],
  controllers: [VisitsController, FieldAgendaController],
  providers: [VisitsRepository, AdministratorGuard, pieceStorageProvider],
})
export class VisitsModule {}
