import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { pieceStorageProvider } from '../dossiers/piece-storage';
import { PlantEditorGuard, PlantsController } from './plants.controller';
import { PlantsRepository } from './plants.repository';

// Fiches plantes du Dictionnaire (US-050) : fiches en base, photos dans le stockage objet
@Module({
  imports: [AuthModule],
  controllers: [PlantsController],
  providers: [PlantsRepository, PlantEditorGuard, pieceStorageProvider],
})
export class PlantsModule {}
