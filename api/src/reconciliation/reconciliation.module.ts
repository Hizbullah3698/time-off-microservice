import { Module } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { HcmClientModule } from '../hcm-client/hcm-client.module';

@Module({
  imports: [HcmClientModule],
  providers: [ReconciliationService],
})
export class ReconciliationModule {}
