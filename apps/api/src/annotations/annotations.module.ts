import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdministratorGuard } from '../certification/certification.controller';
import { AnnotationsController, AnnotationsRepository } from './annotations.controller';

// Annotations du Comité scientifique sur un traitement ou une plante (US-064)
@Module({
  imports: [AuthModule],
  controllers: [AnnotationsController],
  providers: [AnnotationsRepository, AdministratorGuard],
})
export class AnnotationsModule {}
