import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { HcmClientService } from '../hcm-client/hcm-client.service';

@Injectable()
export class ReconciliationService {
  private retryState = new Map<string, { count: number; lastAttempt: Date }>();

  constructor(
    private prisma: PrismaService,
    private hcmClient: HcmClientService,
  ) {}

  private getBackoffMs(count: number): number {
    const delays = [1000, 5000, 30000, 300000, 1800000];
    return delays[Math.min(count, delays.length - 1)];
  }

  @Cron('*/2 * * * *')
  async runReconciliation(): Promise<void> {
    const candidates = await this.prisma.timeOffRequest.findMany({
      where: {
        OR: [
          { hcmSynced: false, status: 'APPROVED' },
          { syncError: true, status: 'APPROVED' },
        ],
      },
    });

    for (const req of candidates) {
      const state = this.retryState.get(req.id) ?? {
        count: 0,
        lastAttempt: new Date(0),
      };
      const backoffMs = this.getBackoffMs(state.count);
      const now = new Date();

      if (now.getTime() - state.lastAttempt.getTime() < backoffMs) continue;

      const hoursElapsed =
        (now.getTime() - req.updatedAt.getTime()) / 3600000;
      if (state.count >= 10 && hoursElapsed > 2) {
        await this.prisma.timeOffRequest.update({
          where: { id: req.id },
          data: { status: 'SYNC_FAILED_MANUAL', syncError: false },
        });
        this.retryState.delete(req.id);
        continue;
      }

      try {
        await this.hcmClient.deductBalance(
          req.employeeId,
          req.locationId,
          req.daysRequested,
          req.idempotencyKey,
        );
        await this.prisma.timeOffRequest.update({
          where: { id: req.id },
          data: {
            hcmSynced: true,
            syncError: false,
            retryCount: state.count + 1,
          },
        });
        this.retryState.delete(req.id);
      } catch (error) {
        this.retryState.set(req.id, {
          count: state.count + 1,
          lastAttempt: now,
        });
        await this.prisma.timeOffRequest.update({
          where: { id: req.id },
          data: { retryCount: state.count + 1, lastRetryAt: now },
        });
      }
    }
  }
}
