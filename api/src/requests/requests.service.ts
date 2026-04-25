import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TimeOffRequest, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { BalancesService } from '../balances/balances.service';
import { HcmClientService } from '../hcm-client/hcm-client.service';
import {
  HcmValidationError,
  HcmUnavailableError,
} from '../hcm-client/hcm-client.errors';
import { CreateRequestDto } from './requests.dto';

@Injectable()
export class RequestsService {
  constructor(
    private prisma: PrismaService,
    private balancesService: BalancesService,
    private hcmClient: HcmClientService,
  ) {}

  async createRequest(dto: CreateRequestDto): Promise<TimeOffRequest> {
    return await this.prisma.$transaction(async (tx) => {
      const balance = await this.balancesService.getOrCreate(
        dto.employeeId,
        dto.locationId,
        tx,
      );

      const overlap = await tx.timeOffRequest.findFirst({
        where: {
          employeeId: dto.employeeId,
          locationId: dto.locationId,
          status: { in: ['PENDING', 'APPROVED'] },
          AND: [
            { startDate: { lte: dto.endDate } },
            { endDate: { gte: dto.startDate } },
          ],
        },
      });

      if (overlap) {
        throw new ConflictException('Overlapping active request exists');
      }

      const available = balance.totalBalance - balance.pendingDeductions;
      if (available < dto.daysRequested) {
        throw new BadRequestException('Insufficient balance');
      }

      await tx.balanceCache.update({
        where: { id: balance.id },
        data: {
          pendingDeductions: { increment: dto.daysRequested },
          version: { increment: 1 },
        },
      });

      const idempotencyKey = `deduct-${uuidv4()}`;
      return tx.timeOffRequest.create({
        data: {
          employeeId: dto.employeeId,
          locationId: dto.locationId,
          startDate: dto.startDate,
          endDate: dto.endDate,
          daysRequested: dto.daysRequested,
          status: 'PENDING',
          idempotencyKey,
          hcmSynced: false,
          syncError: false,
        },
      });
    });
  }

  async approveRequest(
    id: string,
  ): Promise<TimeOffRequest & { syncPending?: boolean }> {
    const request = await this.prisma.timeOffRequest.findUnique({
      where: { id },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }
    if (request.status !== 'PENDING') {
      throw new BadRequestException('Request is not in PENDING status');
    }

    await this.prisma.timeOffRequest.update({
      where: { id },
      data: { status: 'APPROVED' },
    });

    try {
      await this.hcmClient.deductBalance(
        request.employeeId,
        request.locationId,
        request.daysRequested,
        request.idempotencyKey,
      );

      return await this.prisma.timeOffRequest.update({
        where: { id },
        data: { hcmSynced: true, syncError: false },
      });
    } catch (error) {
      if (error instanceof HcmValidationError) {
        try {
          const hcmBalance = await this.hcmClient.getBalance(
            request.employeeId,
            request.locationId,
          );
          if (hcmBalance.balance < 0) {
            await this.prisma.timeOffRequest.update({
              where: { id },
              data: { status: 'PENDING', syncError: true },
            });
            throw new UnprocessableEntityException(
              'HCM rejected: insufficient balance confirmed',
            );
          }
          return await this.prisma.timeOffRequest.update({
            where: { id },
            data: { hcmSynced: true, syncError: false },
          });
        } catch (innerErr) {
          if (innerErr instanceof HcmUnavailableError) {
            await this.prisma.timeOffRequest.update({
              where: { id },
              data: { hcmSynced: false, syncError: true },
            });
            const updated = await this.prisma.timeOffRequest.findUnique({
              where: { id },
            });
            return { ...updated!, syncPending: true };
          }
          throw innerErr;
        }
      }

      if (error instanceof HcmUnavailableError) {
        await this.prisma.timeOffRequest.update({
          where: { id },
          data: { hcmSynced: false, syncError: true },
        });
        const updated = await this.prisma.timeOffRequest.findUnique({
          where: { id },
        });
        return { ...updated!, syncPending: true };
      }

      throw error;
    }
  }

  async rejectRequest(id: string): Promise<TimeOffRequest> {
    return await this.prisma.$transaction(async (tx) => {
      const req = await tx.timeOffRequest.findUnique({ where: { id } });
      if (!req) throw new NotFoundException('Request not found');
      if (req.status !== 'PENDING') {
        throw new BadRequestException('Only PENDING requests can be rejected');
      }

      await tx.timeOffRequest.update({
        where: { id },
        data: { status: 'REJECTED' },
      });

      const balance = await tx.balanceCache.findFirst({
        where: { employeeId: req.employeeId, locationId: req.locationId },
      });

      if (balance) {
        const newDeductions = Math.max(
          0,
          balance.pendingDeductions - req.daysRequested,
        );
        await tx.balanceCache.update({
          where: { id: balance.id },
          data: { pendingDeductions: newDeductions },
        });
      }

      const result = await tx.timeOffRequest.findUnique({ where: { id } });
      return result!;
    });
  }

  async cancelRequest(id: string): Promise<TimeOffRequest> {
    const req = await this.prisma.timeOffRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Request not found');

    if (req.status === 'PENDING') {
      return await this.prisma.$transaction(async (tx) => {
        const updatedReq = await tx.timeOffRequest.update({
          where: { id },
          data: { status: 'CANCELLED' },
        });
        const balance = await tx.balanceCache.findFirst({
          where: { employeeId: req.employeeId, locationId: req.locationId },
        });
        if (balance) {
          await tx.balanceCache.update({
            where: { id: balance.id },
            data: {
              pendingDeductions: Math.max(
                0,
                balance.pendingDeductions - req.daysRequested,
              ),
            },
          });
        }
        return updatedReq;
      });
    } else if (req.status === 'APPROVED') {
      try {
        const restoreKey = `restore-${uuidv4()}`;
        await this.hcmClient.restoreBalance(
          req.employeeId,
          req.locationId,
          req.daysRequested,
          restoreKey,
        );
        return await this.prisma.$transaction(async (tx) => {
          const updatedReq = await tx.timeOffRequest.update({
            where: { id },
            data: { status: 'CANCELLED' },
          });
          const balance = await tx.balanceCache.findFirst({
            where: { employeeId: req.employeeId, locationId: req.locationId },
          });
          if (balance) {
            await tx.balanceCache.update({
              where: { id: balance.id },
              data: {
                pendingDeductions: Math.max(
                  0,
                  balance.pendingDeductions - req.daysRequested,
                ),
              },
            });
          }
          return updatedReq;
        });
      } catch (err) {
        if (err instanceof HcmUnavailableError) {
          return await this.prisma.timeOffRequest.update({
            where: { id },
            data: { syncError: true },
          });
        }
        throw err;
      }
    } else {
      throw new BadRequestException(
        'Cannot cancel a request in status: ' + req.status,
      );
    }
  }

  async listRequests(query: {
    employeeId?: string;
    status?: any;
  }): Promise<TimeOffRequest[]> {
    const where: any = {};
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;

    return this.prisma.timeOffRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRequest(id: string): Promise<TimeOffRequest> {
    const req = await this.prisma.timeOffRequest.findUnique({
      where: { id },
    });
    if (!req) throw new NotFoundException('Request not found');
    return req;
  }
}
