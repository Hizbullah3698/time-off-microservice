import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { BalancesModule } from '../balances/balances.module';
import { HcmClientModule } from '../hcm-client/hcm-client.module';

@Module({
  imports: [BalancesModule, HcmClientModule],
  providers: [RequestsService],
  controllers: [RequestsController],
})
export class RequestsModule {}
