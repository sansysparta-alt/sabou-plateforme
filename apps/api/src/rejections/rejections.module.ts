import { Module } from '@nestjs/common';
import { DirectorGuard } from '../accounts/accounts.controller';
import { AuthModule } from '../auth/auth.module';
import { RejectionsController } from './rejections.controller';
import { RejectionsRepository } from './rejections.repository';

// Rejet définitif d'un praticien par la DG (US-047)
@Module({
  imports: [AuthModule],
  controllers: [RejectionsController],
  providers: [RejectionsRepository, DirectorGuard],
})
export class RejectionsModule {}
