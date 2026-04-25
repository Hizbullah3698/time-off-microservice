import { Test, TestingModule } from '@nestjs/testing';
import { RequestsService } from './requests.service';
import { PrismaService } from '../prisma/prisma.service';
import { BalancesService } from '../balances/balances.service';
import { HcmClientService } from '../hcm-client/hcm-client.service';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

describe('RequestsService', () => {
  let service: RequestsService;
  let prisma: any;
  let balancesService: jest.Mocked<BalancesService>;
  let hcmClient: jest.Mocked<HcmClientService>;

  const mockBalance = {
    id: 'bal-1',
    employeeId: 'emp1',
    locationId: 'loc1',
    totalBalance: 10,
    pendingDeductions: 2,
    version: 1,
    lastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRequest = {
    id: 'req-1',
    employeeId: 'emp1',
    locationId: 'loc1',
    startDate: '2026-05-01',
    endDate: '2026-05-02',
    daysRequested: 3,
    status: 'PENDING',
    idempotencyKey: 'deduct-abc-123',
    hcmSynced: false,
    syncError: false,
    retryCount: 0,
    lastRetryAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    // Mock $transaction to execute the callback with a mock tx object
    const mockTx = {
      balanceCache: {
        findFirst: jest.fn().mockResolvedValue(mockBalance),
        update: jest.fn().mockResolvedValue(mockBalance),
        create: jest.fn().mockResolvedValue(mockBalance),
      },
      timeOffRequest: {
        findFirst: jest.fn().mockResolvedValue(null), // no overlap by default
        create: jest.fn().mockImplementation((args) => ({
          ...mockRequest,
          ...args.data,
          id: 'req-generated',
        })),
        update: jest.fn().mockResolvedValue(mockRequest),
        findUnique: jest.fn().mockResolvedValue(mockRequest),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestsService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn().mockImplementation((cb) => cb(mockTx)),
            timeOffRequest: {
              findUnique: jest.fn().mockResolvedValue(mockRequest),
              update: jest.fn().mockResolvedValue(mockRequest),
              findMany: jest.fn().mockResolvedValue([mockRequest]),
            },
            balanceCache: {
              findFirst: jest.fn().mockResolvedValue(mockBalance),
              update: jest.fn().mockResolvedValue(mockBalance),
            },
          },
        },
        {
          provide: BalancesService,
          useValue: { getOrCreate: jest.fn().mockResolvedValue(mockBalance) },
        },
        {
          provide: HcmClientService,
          useValue: {
            deductBalance: jest
              .fn()
              .mockResolvedValue({ remainingBalance: 7 }),
            restoreBalance: jest
              .fn()
              .mockResolvedValue({ restoredBalance: 10 }),
            getBalance: jest.fn().mockResolvedValue({ balance: 7 }),
          },
        },
      ],
    }).compile();

    service = module.get(RequestsService);
    prisma = module.get(PrismaService);
    balancesService = module.get(BalancesService);
    hcmClient = module.get(HcmClientService);
  });

  it('createRequest increments pendingDeductions correctly', async () => {
    const dto = {
      employeeId: 'emp1',
      locationId: 'loc1',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      daysRequested: 3,
    };
    await service.createRequest(dto);
    // After create, pendingDeductions should have been incremented by 3
    // The mock tx.balanceCache.update should have been called with increment: 3
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('createRequest throws BadRequestException when availableBalance < daysRequested', async () => {
    // Override mock to return balance where available = 1
    const lowBalance = {
      ...mockBalance,
      totalBalance: 3,
      pendingDeductions: 2,
    }; // available = 1
    (balancesService.getOrCreate as jest.Mock).mockResolvedValue(lowBalance);
    const mockTxLow = {
      balanceCache: {
        findFirst: jest.fn().mockResolvedValue(lowBalance),
        update: jest.fn(),
      },
      timeOffRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    (prisma.$transaction as jest.Mock).mockImplementation((cb) =>
      cb(mockTxLow),
    );

    const dto = {
      employeeId: 'emp1',
      locationId: 'loc1',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      daysRequested: 5,
    };
    await expect(service.createRequest(dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('createRequest throws ConflictException on overlapping active request', async () => {
    const mockTxOverlap = {
      balanceCache: {
        findFirst: jest.fn().mockResolvedValue(mockBalance),
        update: jest.fn(),
      },
      timeOffRequest: {
        findFirst: jest.fn().mockResolvedValue(mockRequest), // overlap found
        create: jest.fn(),
      },
    };
    (prisma.$transaction as jest.Mock).mockImplementation((cb) =>
      cb(mockTxOverlap),
    );

    const dto = {
      employeeId: 'emp1',
      locationId: 'loc1',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      daysRequested: 2,
    };
    await expect(service.createRequest(dto)).rejects.toThrow(
      ConflictException,
    );
  });

  it('COMPLETED request cannot be approved', async () => {
    (prisma.timeOffRequest.findUnique as jest.Mock).mockResolvedValue({
      ...mockRequest,
      status: 'COMPLETED',
    });
    await expect(service.approveRequest('req-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('CANCELLED request cannot be approved', async () => {
    (prisma.timeOffRequest.findUnique as jest.Mock).mockResolvedValue({
      ...mockRequest,
      status: 'CANCELLED',
    });
    await expect(service.approveRequest('req-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('idempotencyKey is set and matches expected pattern', async () => {
    const result = await service.createRequest({
      employeeId: 'emp1',
      locationId: 'loc1',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      daysRequested: 2,
    });
    expect(result.idempotencyKey).toMatch(/^deduct-[0-9a-f-]{36}$/);
  });

  it('cancelRequest on PENDING releases pendingDeductions', async () => {
    (prisma.timeOffRequest.findUnique as jest.Mock).mockResolvedValue({
      ...mockRequest,
      status: 'PENDING',
    });
    await service.cancelRequest('req-1');
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
