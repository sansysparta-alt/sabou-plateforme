import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlantEditorGuard } from '../plants/plants.controller';
import { DiseasesController } from './diseases.controller';
import { DiseasesRepository } from './diseases.repository';

// Fiches maladies du Dictionnaire (US-052)
@Module({
  imports: [AuthModule],
  controllers: [DiseasesController],
  providers: [DiseasesRepository, PlantEditorGuard],
})
export class DiseasesModule {}
