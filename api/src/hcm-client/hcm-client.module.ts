import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HcmClientService } from './hcm-client.service';
import { HcmClientController } from './hcm-client.controller';

@Module({
  imports: [ConfigModule],
  providers: [HcmClientService],
  controllers: [HcmClientController],
  exports: [HcmClientService],
})
export class HcmClientModule {}
