import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RequestsModule } from './requests/requests.module';
import { BalancesModule } from './balances/balances.module';
import { SyncModule } from './sync/sync.module';
import { HcmClientModule } from './hcm-client/hcm-client.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RequestsModule,
    BalancesModule,
    SyncModule,
    HcmClientModule,
    ReconciliationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
