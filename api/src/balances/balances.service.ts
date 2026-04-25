import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { BalanceCache } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HcmClientService } from '../hcm-client/hcm-client.service';
import { HcmUnavailableError } from '../hcm-client/hcm-client.errors';
import { BalanceDto } from './balances.dto';

@Injectable()
export class BalancesService {
  constructor(
    private prisma: PrismaService,
    private hcmClient: HcmClientService,
  ) {}

  async getOrCreate(
    employeeId: string,
    locationId: string,
    tx?: any,
  ): Promise<BalanceCache> {
    const db = tx ?? this.prisma;
    let record = await db.balanceCache.findFirst({
      where: { employeeId, locationId },
    });

    if (!record) {
      record = await db.balanceCache.create({
        data: {
          employeeId,
          locationId,
          totalBalance: 0,
          pendingDeductions: 0,
          version: 1,
        },
      });
    }

    return record;
  }

  async getBalance(
    employeeId: string,
    locationId: string,
  ): Promise<BalanceDto> {
    const record = await this.getOrCreate(employeeId, locationId);
    return {
      employeeId: record.employeeId,
      locationId: record.locationId,
      totalBalance: record.totalBalance,
      pendingDeductions: record.pendingDeductions,
      availableBalance: record.totalBalance - record.pendingDeductions,
      lastSyncedAt: record.lastSyncedAt,
    };
  }

  async forceRealtimeSync(
    employeeId: string,
    locationId: string,
  ): Promise<BalanceDto> {
    try {
      const hcmBalance = await this.hcmClient.getBalance(
        employeeId,
        locationId,
      );
      const existing = await this.getOrCreate(employeeId, locationId);

      const updated = await this.prisma.balanceCache.update({
        where: { id: existing.id },
        data: {
          totalBalance: hcmBalance.balance,
          lastSyncedAt: new Date(),
        },
      });

      await this.prisma.syncLog.create({
        data: {
          type: 'REALTIME',
          employeeId,
          locationId,
          newBalance: hcmBalance.balance,
          previousBalance: existing.totalBalance,
        },
      });

      return {
        employeeId: updated.employeeId,
        locationId: updated.locationId,
        totalBalance: updated.totalBalance,
        pendingDeductions: updated.pendingDeductions,
        availableBalance: updated.totalBalance - updated.pendingDeductions,
        lastSyncedAt: updated.lastSyncedAt,
      };
    } catch (error) {
      if (error instanceof HcmUnavailableError) {
        throw new HttpException('HCM unavailable', HttpStatus.BAD_GATEWAY);
      }
      throw error;
    }
  }
}
