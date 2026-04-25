import { Test, TestingModule } from '@nestjs/testing';
import { BalancesService } from './balances.service';
import { PrismaService } from '../prisma/prisma.service';
import { HcmClientService } from '../hcm-client/hcm-client.service';
import { HcmUnavailableError } from '../hcm-client/hcm-client.errors';
import { HttpException } from '@nestjs/common';

describe('BalancesService', () => {
  let service: BalancesService;
  let prisma: jest.Mocked<PrismaService>;
  let hcmClient: jest.Mocked<HcmClientService>;

  const mockBalance = {
    id: 'bal-1',
    employeeId: 'emp1',
    locationId: 'loc1',
    totalBalance: 10,
    pendingDeductions: 3,
    version: 1,
    lastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BalancesService,
        {
          provide: PrismaService,
          useValue: {
            balanceCache: {
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              upsert: jest.fn(),
            },
            syncLog: { create: jest.fn() },
          },
        },
        {
          provide: HcmClientService,
          useValue: { getBalance: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(BalancesService);
    prisma = module.get(PrismaService);
    hcmClient = module.get(HcmClientService);
  });

  it('availableBalance = totalBalance - pendingDeductions', async () => {
    (prisma.balanceCache.findFirst as jest.Mock).mockResolvedValue(mockBalance);
    const result = await service.getBalance('emp1', 'loc1');
    expect(result.availableBalance).toBe(7); // 10 - 3
  });

  it('availableBalance with zero pendingDeductions', async () => {
    (prisma.balanceCache.findFirst as jest.Mock).mockResolvedValue({
      ...mockBalance,
      pendingDeductions: 0,
    });
    const result = await service.getBalance('emp1', 'loc1');
    expect(result.availableBalance).toBe(10);
  });

  it('getOrCreate creates new row when none exists', async () => {
    (prisma.balanceCache.findFirst as jest.Mock).mockResolvedValue(null);
    const created = { ...mockBalance, totalBalance: 0, pendingDeductions: 0 };
    (prisma.balanceCache.create as jest.Mock).mockResolvedValue(created);
    const result = await service.getOrCreate('emp1', 'loc1');
    expect(prisma.balanceCache.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalBalance: 0,
          pendingDeductions: 0,
        }),
      }),
    );
    expect(result.totalBalance).toBe(0);
  });

  it('forceRealtimeSync writes SyncLog entry on HCM success', async () => {
    (hcmClient.getBalance as jest.Mock).mockResolvedValue({ balance: 15 });
    (prisma.balanceCache.findFirst as jest.Mock).mockResolvedValue(mockBalance);
    (prisma.balanceCache.update as jest.Mock).mockResolvedValue({
      ...mockBalance,
      totalBalance: 15,
    });
    (prisma.syncLog.create as jest.Mock).mockResolvedValue({});
    await service.forceRealtimeSync('emp1', 'loc1');
    expect(prisma.syncLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'REALTIME', newBalance: 15 }),
      }),
    );
  });

  it('forceRealtimeSync throws 502 when HCM unavailable', async () => {
    (hcmClient.getBalance as jest.Mock).mockRejectedValue(
      new HcmUnavailableError('down'),
    );
    await expect(service.forceRealtimeSync('emp1', 'loc1')).rejects.toThrow(
      HttpException,
    );
  });
});
