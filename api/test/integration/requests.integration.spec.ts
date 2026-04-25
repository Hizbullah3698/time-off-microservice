import request from 'supertest';
import axios from 'axios';

const APP_URL = 'http://localhost:3000';
const HCM_URL = 'http://localhost:4000';

async function resetHcm() {
  await axios.post(`${HCM_URL}/admin/reset`);
}

async function setHcmBalance(employeeId: string, locationId: string, balance: number) {
  await axios.post(`${HCM_URL}/admin/set-balance`, { employeeId, locationId, balance });
}

async function getHcmBalance(employeeId: string, locationId: string): Promise<number> {
  const res = await axios.get(`${HCM_URL}/balances/${employeeId}/${locationId}`);
  return res.data.balance;
}

describe('Requests Integration', () => {
  beforeEach(async () => {
    await resetHcm();
  });

  it('full create → approve lifecycle', async () => {
    await setHcmBalance('emp1', 'loc1', 10);
    await request(APP_URL).post('/balances/sync/emp1/loc1').expect(200);

    const createRes = await request(APP_URL)
      .post('/requests')
      .send({ employeeId: 'emp1', locationId: 'loc1', startDate: '2026-06-01', endDate: '2026-06-02', daysRequested: 2 })
      .expect(201);

    expect(createRes.body.data.status).toBe('PENDING');
    const id = createRes.body.data.id;

    const approveRes = await request(APP_URL).patch(`/requests/${id}/approve`).expect(200);
    expect(approveRes.body.data.status).toBe('APPROVED');
    expect(approveRes.body.data.hcmSynced).toBe(true);

    const hcmBalance = await getHcmBalance('emp1', 'loc1');
    expect(hcmBalance).toBe(8);

    const balanceRes = await request(APP_URL).get('/balances/emp1/loc1').expect(200);
    expect(balanceRes.body.data.availableBalance).toBe(8);
  });

  it('rejects request when balance insufficient', async () => {
    await setHcmBalance('emp2', 'loc1', 1);
    await request(APP_URL).post('/balances/sync/emp2/loc1').expect(200);

    await request(APP_URL)
      .post('/requests')
      .send({ employeeId: 'emp2', locationId: 'loc1', startDate: '2026-06-01', endDate: '2026-06-05', daysRequested: 5 })
      .expect(400);
  });

  it('concurrent requests — double-spend prevention', async () => {
    await setHcmBalance('emp3', 'loc1', 5);
    await request(APP_URL).post('/balances/sync/emp3/loc1').expect(200);

    const [res1, res2] = await Promise.all([
      request(APP_URL).post('/requests').send({
        employeeId: 'emp3', locationId: 'loc1',
        startDate: '2026-07-01', endDate: '2026-07-04', daysRequested: 4,
      }),
      request(APP_URL).post('/requests').send({
        employeeId: 'emp3', locationId: 'loc1',
        startDate: '2026-07-10', endDate: '2026-07-13', daysRequested: 4,
      }),
    ]);

    const statuses = [res1.status, res2.status];
    expect(statuses).toContain(201);
    const failures = statuses.filter((s) => s === 400 || s === 409);
    expect(failures.length).toBeGreaterThanOrEqual(1);

    const balanceRes = await request(APP_URL).get('/balances/emp3/loc1').expect(200);
    expect(balanceRes.body.data.pendingDeductions).toBeLessThanOrEqual(5);
  });

  it('cancel APPROVED request restores HCM balance', async () => {
    await setHcmBalance('emp1', 'loc1', 10);
    await request(APP_URL).post('/balances/sync/emp1/loc1').expect(200);

    const createRes = await request(APP_URL)
      .post('/requests')
      .send({ employeeId: 'emp1', locationId: 'loc1', startDate: '2026-08-01', endDate: '2026-08-03', daysRequested: 3 })
      .expect(201);
    const id = createRes.body.data.id;

    await request(APP_URL).patch(`/requests/${id}/approve`).expect(200);
    expect(await getHcmBalance('emp1', 'loc1')).toBe(7);

    await request(APP_URL).patch(`/requests/${id}/cancel`).expect(200);
    expect(await getHcmBalance('emp1', 'loc1')).toBe(10);
  });

  it('batch sync updates balance_cache', async () => {
    const now = new Date().toISOString();
    const syncRes = await request(APP_URL)
      .post('/sync/batch')
      .send([{ employeeId: 'emp1', locationId: 'loc1', totalBalance: 15, lastUpdatedAt: now }])
      .expect(200);

    expect(syncRes.body.data.processed).toBe(1);
    expect(syncRes.body.data.flagged).toBe(0);

    const balanceRes = await request(APP_URL).get('/balances/emp1/loc1').expect(200);
    expect(balanceRes.body.data.totalBalance).toBe(15);
  });

  it('batch sync flags negative availableBalance', async () => {
    await setHcmBalance('emp1', 'loc1', 10);
    await request(APP_URL).post('/balances/sync/emp1/loc1').expect(200);

    await request(APP_URL).post('/requests')
      .send({ employeeId: 'emp1', locationId: 'loc1', startDate: '2026-09-01', endDate: '2026-09-04', daysRequested: 4 })
      .expect(201);
    await request(APP_URL).post('/requests')
      .send({ employeeId: 'emp1', locationId: 'loc1', startDate: '2026-09-10', endDate: '2026-09-13', daysRequested: 4 })
      .expect(201);

    const now = new Date().toISOString();
    const syncRes = await request(APP_URL)
      .post('/sync/batch')
      .send([{ employeeId: 'emp1', locationId: 'loc1', totalBalance: 5, lastUpdatedAt: now }])
      .expect(200);

    expect(syncRes.body.data.flagged).toBe(1);

    const listRes = await request(APP_URL).get('/requests?employeeId=emp1').expect(200);
    const pending = listRes.body.data.filter((r: any) => r.status === 'PENDING');
    expect(pending.length).toBe(2);
  });

  it('webhook updates balance', async () => {
    const webhookRes = await request(APP_URL)
      .post('/webhooks/hcm-update')
      .send({ employeeId: 'emp1', locationId: 'loc1', newBalance: 12, eventType: 'ANNIVERSARY', eventId: 'evt-001' });
    expect([200, 201]).toContain(webhookRes.status);

    const balanceRes = await request(APP_URL).get('/balances/emp1/loc1').expect(200);
    expect(balanceRes.body.data.totalBalance).toBe(12);
  });

  it('duplicate webhook is idempotent', async () => {
    const payload = { employeeId: 'emp1', locationId: 'loc1', newBalance: 12, eventType: 'BONUS', eventId: 'evt-dup-1' };
    await request(APP_URL).post('/webhooks/hcm-update').send(payload);
    const secondRes = await request(APP_URL).post('/webhooks/hcm-update').send(payload);
    expect([200, 201]).toContain(secondRes.status);

    const balanceRes = await request(APP_URL).get('/balances/emp1/loc1').expect(200);
    expect(balanceRes.body.data.totalBalance).toBe(12);
  });

  it('stale batch does not overwrite newer webhook', async () => {
    await request(APP_URL)
      .post('/webhooks/hcm-update')
      .send({ employeeId: 'emp1', locationId: 'loc1', newBalance: 20, eventType: 'BONUS', eventId: 'evt-fresh-1' });

    const after = await request(APP_URL).get('/balances/emp1/loc1').expect(200);
    expect(after.body.data.totalBalance).toBe(20);

    const stale = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await request(APP_URL)
      .post('/sync/batch')
      .send([{ employeeId: 'emp1', locationId: 'loc1', totalBalance: 8, lastUpdatedAt: stale }]);

    const afterStale = await request(APP_URL).get('/balances/emp1/loc1').expect(200);
    expect(afterStale.body.data.totalBalance).toBe(20);
  });
});
