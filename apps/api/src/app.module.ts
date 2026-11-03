import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { SyncModule } from './sync/sync.module';

// Module racine : chaque domaine (certification, dictionnaire, traitements…) y sera importé
@Module({
  imports: [ConfigModule, DatabaseModule, SyncModule],
  controllers: [HealthController],
})
export class AppModule {}
