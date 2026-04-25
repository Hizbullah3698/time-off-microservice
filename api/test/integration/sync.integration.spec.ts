import request from 'supertest';
import axios from 'axios';

const APP_URL = 'http://localhost:3000';
const HCM_URL = 'http://localhost:4000';

describe('Sync Integration', () => {
  beforeEach(async () => {
    await axios.post(`${HCM_URL}/admin/reset`);
  });

  it('partial batch failure rolls back entire batch', async () => {
    const beforeRes = await request(APP_URL).get('/balances/emp1/loc1').expect(200);
    const balanceBefore = beforeRes.body.data.totalBalance;

    const now = new Date().toISOString();
    const batchRes = await request(APP_URL)
      .post('/sync/batch')
      .send([
        { employeeId: 'emp1', locationId: 'loc1', totalBalance: 99, lastUpdatedAt: now },
        { employeeId: 'emp1', locationId: 'loc2', totalBalance: 50, lastUpdatedAt: now },
        { employeeId: null, locationId: null, totalBalance: null, lastUpdatedAt: now },
      ]);

    expect([400, 500]).toContain(batchRes.status);

    const afterRes = await request(APP_URL).get('/balances/emp1/loc1').expect(200);
    expect(afterRes.body.data.totalBalance).toBe(balanceBefore);
  });
});
