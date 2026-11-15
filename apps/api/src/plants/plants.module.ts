import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdministratorGuard } from '../certification/certification.controller';
import { pieceStorageProvider } from '../dossiers/piece-storage';
import { LocalNamesController } from './local-names.controller';
import { LocalNamesRepository } from './local-names.repository';
import { PlantEditorGuard, PlantsController } from './plants.controller';
import { PlantsRepository } from './plants.repository';

// Fiches plantes du Dictionnaire (US-050) : fiches en base, photos dans le stockage objet ;
// noms locaux saisis par le référent de chaque langue (US-053)
@Module({
  imports: [AuthModule],
  controllers: [PlantsController, LocalNamesController],
  providers: [
    PlantsRepository,
    LocalNamesRepository,
    PlantEditorGuard,
    AdministratorGuard,
    pieceStorageProvider,
  ],
})
export class PlantsModule {}
