import { Module } from '@nestjs/common';
import { BalancesService } from './balances.service';
import { BalancesController } from './balances.controller';
import { HcmClientModule } from '../hcm-client/hcm-client.module';

@Module({
  imports: [HcmClientModule],
  providers: [BalancesService],
  controllers: [BalancesController],
  exports: [BalancesService],
})
export class BalancesModule {}
