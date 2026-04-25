import axios from 'axios';
import { HcmClientService } from './hcm-client.service';
import { HcmValidationError, HcmUnavailableError } from './hcm-client.errors';

jest.mock('axios', () => {
  const inst = { get: jest.fn(), post: jest.fn() };
  return {
    create: jest.fn(() => inst),
    isAxiosError: jest.fn((e) => !!e?.response || !!e?.code),
    __inst: inst,
  };
});

describe('HcmClientService', () => {
  let service: HcmClientService;
  let mock: { get: jest.Mock; post: jest.Mock };

  beforeEach(() => {
    mock = (axios as any).__inst;
    mock.get.mockReset();
    mock.post.mockReset();
    const cfg = { get: jest.fn((k: string) => {
      if (k === 'HCM_BASE_URL') return 'http://localhost:4000';
      if (k === 'HCM_TIMEOUT_MS') return '3000';
    })} as any;
    service = new HcmClientService(cfg);
  });

  it('deductBalance sends idempotencyKey in POST body', async () => {
    mock.post.mockResolvedValue({ data: { remainingBalance: 7 } });
    await service.deductBalance('emp1', 'loc1', 3, 'key-abc');
    expect(mock.post).toHaveBeenCalledWith('/deductions', expect.objectContaining({ idempotencyKey: 'key-abc' }));
  });

  it('deductBalance throws HcmValidationError on 422', async () => {
    mock.post.mockRejectedValue({ response: { status: 422, data: { error: 'Insufficient' } } });
    await expect(service.deductBalance('emp1', 'loc1', 3, 'k1')).rejects.toThrow(HcmValidationError);
  });

  it('deductBalance throws HcmUnavailableError on network timeout', async () => {
    mock.post.mockRejectedValue({ code: 'ECONNABORTED', message: 'timeout' });
    await expect(service.deductBalance('emp1', 'loc1', 3, 'k2')).rejects.toThrow(HcmUnavailableError);
  });

  it('deductBalance throws HcmUnavailableError on 503', async () => {
    mock.post.mockRejectedValue({ response: { status: 503, data: {} } });
    await expect(service.deductBalance('emp1', 'loc1', 3, 'k3')).rejects.toThrow(HcmUnavailableError);
  });

  it('restoreBalance throws HcmUnavailableError on 5xx', async () => {
    mock.post.mockRejectedValue({ response: { status: 500, data: {} } });
    await expect(service.restoreBalance('emp1', 'loc1', 3, 'k4')).rejects.toThrow(HcmUnavailableError);
  });
});
