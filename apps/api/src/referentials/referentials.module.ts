import { Module } from '@nestjs/common';
import { AccountsRepository } from '../accounts/accounts.repository';
import { DirectorGuard } from '../accounts/accounts.controller';
import { AuthModule } from '../auth/auth.module';
import { ReferentialsController } from './referentials.controller';
import { ReferentialsRepository } from './referentials.repository';
import { ReferentialsService } from './referentials.service';

// Référentiels gérés par la DG (lot C : US-020, US-021)
@Module({
  imports: [AuthModule],
  controllers: [ReferentialsController],
  providers: [AccountsRepository, ReferentialsRepository, ReferentialsService, DirectorGuard],
})
export class ReferentialsModule {}
