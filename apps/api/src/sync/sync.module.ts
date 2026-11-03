import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { PgSyncRepository, SYNC_REPOSITORY } from './sync.repository';

// Synchronisation hors réseau des agents de terrain (US-004, R-DON-04)
@Module({
  controllers: [SyncController],
  providers: [{ provide: SYNC_REPOSITORY, useClass: PgSyncRepository }],
})
export class SyncModule {}
