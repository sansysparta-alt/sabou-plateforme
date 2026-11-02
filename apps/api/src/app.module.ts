import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';

// Module racine : chaque domaine (certification, dictionnaire, traitements…) y sera importé
@Module({
  controllers: [HealthController],
})
export class AppModule {}
