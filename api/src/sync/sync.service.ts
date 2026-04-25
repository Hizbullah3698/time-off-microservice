import { Injectable } from '@nestjs/common';
import { BalanceCache } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SyncService {
  constructor(private prisma: PrismaService) {}

  async receiveBatch(
    records: Array<{
      employeeId: string;
      locationId: string;
      totalBalance: number;
      lastUpdatedAt: string;
    }>,
  ): Promise<{ processed: number; flagged: number }> {
    let processed = 0;
    let flagged = 0;

    await this.prisma.$transaction(
      async (tx) => {
        for (const record of records) {
          const existing = await tx.balanceCache.findFirst({
            where: {
              employeeId: record.employeeId,
              locationId: record.locationId,
            },
          });

          if (
            existing?.lastSyncedAt &&
            new Date(record.lastUpdatedAt) < existing.lastSyncedAt
          ) {
            console.warn(
              `Stale batch record skipped for ${record.employeeId}/${record.locationId}`,
            );
            continue;
          }

          const previousBalance = existing?.totalBalance ?? 0;
          let cache: BalanceCache;

          if (!existing) {
            cache = await tx.balanceCache.create({
              data: {
                employeeId: record.employeeId,
                locationId: record.locationId,
                totalBalance: record.totalBalance,
                pendingDeductions: 0,
                lastSyncedAt: new Date(record.lastUpdatedAt),
              },
            });
          } else {
            cache = await tx.balanceCache.update({
              where: { id: existing.id },
              data: {
                totalBalance: record.totalBalance,
                lastSyncedAt: new Date(record.lastUpdatedAt),
              },
            });
          }

          await tx.syncLog.create({
            data: {
              type: 'BATCH',
              employeeId: record.employeeId,
              locationId: record.locationId,
              previousBalance,
              newBalance: record.totalBalance,
            },
          });

          const available = cache.totalBalance - cache.pendingDeductions;
          if (available < 0) flagged++;
          processed++;
        }
      },
    );

    return { processed, flagged };
  }

  async receiveWebhook(payload: {
    employeeId: string;
    locationId: string;
    newBalance: number;
    eventType: string;
    eventId: string;
  }): Promise<void> {
    const existingLog = await this.prisma.syncLog.findFirst({
      where: { eventId: payload.eventId },
    });
    if (existingLog) return;

    const balance = await this.prisma.balanceCache.findFirst({
      where: {
        employeeId: payload.employeeId,
        locationId: payload.locationId,
      },
    });
    const previousBalance = balance?.totalBalance ?? 0;

    await this.prisma.$transaction(async (tx) => {
      await tx.balanceCache.upsert({
        where: {
          employeeId_locationId: {
            employeeId: payload.employeeId,
            locationId: payload.locationId,
          },
        },
        update: { totalBalance: payload.newBalance, lastSyncedAt: new Date() },
        create: {
          employeeId: payload.employeeId,
          locationId: payload.locationId,
          totalBalance: payload.newBalance,
          pendingDeductions: 0,
          lastSyncedAt: new Date(),
        },
      });
      await tx.syncLog.create({
        data: {
          type: 'WEBHOOK',
          employeeId: payload.employeeId,
          locationId: payload.locationId,
          previousBalance,
          newBalance: payload.newBalance,
          eventId: payload.eventId,
        },
      });
    });
  }
}
