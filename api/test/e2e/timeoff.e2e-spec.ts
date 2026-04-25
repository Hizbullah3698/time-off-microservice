import request from 'supertest';
import axios from 'axios';

const APP_URL = 'http://localhost:3000';
const HCM_URL = 'http://localhost:4000';

async function resetHcm() {
  await axios.post(`${HCM_URL}/admin/reset`);
}

async function setHcmBalance(
  employeeId: string,
  locationId: string,
  balance: number,
) {
  await axios.post(`${HCM_URL}/admin/set-balance`, {
    employeeId,
    locationId,
    balance,
  });
}

async function getHcmBalance(
  employeeId: string,
  locationId: string,
): Promise<number> {
  const res = await axios.get(
    `${HCM_URL}/balances/${employeeId}/${locationId}`,
  );
  return res.data.balance;
}

async function syncBalance(employeeId: string, locationId: string) {
  await request(APP_URL).post(`/balances/sync/${employeeId}/${locationId}`);
}

describe('E2E: Time-Off Service', () => {
  beforeEach(async () => {
    await resetHcm();
  });

  // -----------------------------------------------------------------------
  // Each test uses UNIQUE employeeId + locationId to avoid data collisions
  // since SQLite cannot be reset between tests without server restart.
  // -----------------------------------------------------------------------

  it('E2E-1: full wire check — microservice and HCM balances agree', async () => {
    await setHcmBalance('e2e1-emp', 'e2e1-loc', 10);
    await syncBalance('e2e1-emp', 'e2e1-loc');

    const createRes = await request(APP_URL)
      .post('/requests')
      .send({
        employeeId: 'e2e1-emp',
        locationId: 'e2e1-loc',
        startDate: '2026-07-01',
        endDate: '2026-07-02',
        daysRequested: 2,
      })
      .expect(201);

    const id = createRes.body.data.id;

    await request(APP_URL).patch(`/requests/${id}/approve`).expect(200);

    const serviceBalance = await request(APP_URL)
      .get('/balances/e2e1-emp/e2e1-loc')
      .expect(200);
    const hcmBalance = await getHcmBalance('e2e1-emp', 'e2e1-loc');

    console.log(
      'Service availableBalance:',
      serviceBalance.body.data.availableBalance,
    );
    console.log('HCM balance:', hcmBalance);

    expect(serviceBalance.body.data.availableBalance).toBe(8);
    expect(hcmBalance).toBe(8);
    expect(serviceBalance.body.data.availableBalance).toBe(hcmBalance);
  });

  // -----------------------------------------------------------------------
  it('E2E-2: local pre-check prevents overspend even when HCM in silent failure mode', async () => {
    await setHcmBalance('e2e2-emp', 'e2e2-loc', 2);
    await syncBalance('e2e2-emp', 'e2e2-loc');
    await axios.post(`${HCM_URL}/admin/set-silent-failure`, { enabled: true });

    // First request: uses full balance
    const createRes = await request(APP_URL)
      .post('/requests')
      .send({
        employeeId: 'e2e2-emp',
        locationId: 'e2e2-loc',
        startDate: '2026-07-01',
        endDate: '2026-07-02',
        daysRequested: 2,
      })
      .expect(201);
    const id = createRes.body.data.id;

    const approveRes = await request(APP_URL)
      .patch(`/requests/${id}/approve`)
      .expect(200);
    expect(approveRes.body.data.status).toBe('APPROVED');
    expect(approveRes.body.data.hcmSynced).toBe(true);

    // Second request: local available = 0, must be rejected by local pre-check
    await request(APP_URL)
      .post('/requests')
      .send({
        employeeId: 'e2e2-emp',
        locationId: 'e2e2-loc',
        startDate: '2026-07-10',
        endDate: '2026-07-11',
        daysRequested: 1,
      })
      .expect(400);

    await axios.post(`${HCM_URL}/admin/set-silent-failure`, { enabled: false });
  });

  // -----------------------------------------------------------------------
  it(
    'E2E-3: HCM downtime — approval queued, reconciliation resolves it',
    async () => {
      await setHcmBalance('e2e3-emp', 'e2e3-loc', 10);
      await syncBalance('e2e3-emp', 'e2e3-loc');

      // Take HCM offline
      await axios.post(`${HCM_URL}/admin/go-offline`, { offline: true });

      const createRes = await request(APP_URL)
        .post('/requests')
        .send({
          employeeId: 'e2e3-emp',
          locationId: 'e2e3-loc',
          startDate: '2026-07-01',
          endDate: '2026-07-03',
          daysRequested: 3,
        })
        .expect(201);
      const id = createRes.body.data.id;

      // Approve while HCM is offline
      const approveRes = await request(APP_URL)
        .patch(`/requests/${id}/approve`)
        .expect(200);
      expect(approveRes.body.data.status).toBe('APPROVED');
      expect(approveRes.body.data.hcmSynced).toBe(false);

      // Bring HCM back online
      await axios.post(`${HCM_URL}/admin/go-offline`, { offline: false });

      // Wait for reconciliation worker (runs every 2 minutes — wait up to 130s)
      console.log('Waiting for reconciliation worker (up to 130s)...');
      let resolved = false;
      for (let i = 0; i < 26; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const checkRes = await request(APP_URL)
          .get(`/requests/${id}`)
          .expect(200);
        if (checkRes.body.data.hcmSynced === true) {
          resolved = true;
          console.log(`Reconciliation resolved after ${(i + 1) * 5}s`);
          break;
        }
      }

      expect(resolved).toBe(true);

      const hcmBalance = await getHcmBalance('e2e3-emp', 'e2e3-loc');
      expect(hcmBalance).toBe(7);
      console.log('HCM balance after reconciliation:', hcmBalance);
    },
    150000,
  ); // 150 second timeout for this test

  // -----------------------------------------------------------------------
  it('E2E-4: work anniversary during active request — full healing loop', async () => {
    await setHcmBalance('e2e4-emp', 'e2e4-loc', 10);
    await syncBalance('e2e4-emp', 'e2e4-loc');

    // Step 1: Create and approve 8-day request
    const createRes = await request(APP_URL)
      .post('/requests')
      .send({
        employeeId: 'e2e4-emp',
        locationId: 'e2e4-loc',
        startDate: '2026-08-01',
        endDate: '2026-08-08',
        daysRequested: 8,
      })
      .expect(201);
    const id = createRes.body.data.id;

    await request(APP_URL).patch(`/requests/${id}/approve`).expect(200);

    // HCM balance is now 2 (10 - 8)
    const hcmAfterApprove = await getHcmBalance('e2e4-emp', 'e2e4-loc');
    expect(hcmAfterApprove).toBe(2);

    // Step 2: Work anniversary fires in HCM — +5 days bonus
    await axios.post(`${HCM_URL}/admin/simulate-anniversary`, {
      employeeId: 'e2e4-emp',
      locationId: 'e2e4-loc',
      bonusDays: 5,
    });
    // HCM balance now 7, but service doesn't know yet

    // Step 3: Batch sync arrives with post-anniversary balance
    const now1 = new Date().toISOString();
    const syncRes = await request(APP_URL)
      .post('/sync/batch')
      .send({
        records: [
          {
            employeeId: 'e2e4-emp',
            locationId: 'e2e4-loc',
            totalBalance: 7,
            lastUpdatedAt: now1,
          },
        ],
      })
      .expect(200);

    // pendingDeductions=8, totalBalance=7 → available=-1 → flagged
    expect(syncRes.body.data.flagged).toBe(1);

    const balanceAfterSync = await request(APP_URL)
      .get('/balances/e2e4-emp/e2e4-loc')
      .expect(200);
    expect(balanceAfterSync.body.data.totalBalance).toBe(7);
    expect(balanceAfterSync.body.data.availableBalance).toBe(-1);

    // Step 4: New request must be rejected (available=-1)
    await request(APP_URL)
      .post('/requests')
      .send({
        employeeId: 'e2e4-emp',
        locationId: 'e2e4-loc',
        startDate: '2026-09-01',
        endDate: '2026-09-02',
        daysRequested: 2,
      })
      .expect(400);

    // Step 5: Another anniversary bonus resolves the deficit
    await axios.post(`${HCM_URL}/admin/simulate-anniversary`, {
      employeeId: 'e2e4-emp',
      locationId: 'e2e4-loc',
      bonusDays: 5,
    });

    const now2 = new Date().toISOString();
    await request(APP_URL)
      .post('/sync/batch')
      .send({
        records: [
          {
            employeeId: 'e2e4-emp',
            locationId: 'e2e4-loc',
            totalBalance: 12,
            lastUpdatedAt: now2,
          },
        ],
      })
      .expect(200);

    const balanceHealed = await request(APP_URL)
      .get('/balances/e2e4-emp/e2e4-loc')
      .expect(200);
    expect(balanceHealed.body.data.totalBalance).toBe(12);
    expect(balanceHealed.body.data.availableBalance).toBe(4); // 12 - 8 pending

    // Step 6: New 2-day request now succeeds
    await request(APP_URL)
      .post('/requests')
      .send({
        employeeId: 'e2e4-emp',
        locationId: 'e2e4-loc',
        startDate: '2026-09-01',
        endDate: '2026-09-02',
        daysRequested: 2,
      })
      .expect(201);
  });

  // -----------------------------------------------------------------------
  it('E2E-5: idempotency — same deduction key does not double-deduct', async () => {
    await setHcmBalance('e2e5-emp', 'e2e5-loc', 10);

    const idemKey = `deduct-test-${Date.now()}`;

    // POST the same deduction twice directly to mock HCM
    const res1 = await axios.post(`${HCM_URL}/deductions`, {
      employeeId: 'e2e5-emp',
      locationId: 'e2e5-loc',
      days: 3,
      idempotencyKey: idemKey,
    });
    const res2 = await axios.post(`${HCM_URL}/deductions`, {
      employeeId: 'e2e5-emp',
      locationId: 'e2e5-loc',
      days: 3,
      idempotencyKey: idemKey,
    });

    expect(res1.data.remainingBalance).toBe(7);
    expect(res2.data.remainingBalance).toBe(7); // same result — not 4

    const finalBalance = await getHcmBalance('e2e5-emp', 'e2e5-loc');
    expect(finalBalance).toBe(7); // deducted exactly once
    console.log(
      'Final HCM balance after duplicate deduction attempt:',
      finalBalance,
    );
  });

  // -----------------------------------------------------------------------
  it('E2E-6: partial batch failure — entire batch rolled back', async () => {
    // Set a known baseline for this test
    await setHcmBalance('e2e6-emp', 'e2e6-loc', 20);
    await syncBalance('e2e6-emp', 'e2e6-loc');

    // Record state before
    const before = await request(APP_URL)
      .get('/balances/e2e6-emp/e2e6-loc')
      .expect(200);
    const totalBefore = before.body.data.totalBalance;

    const now = new Date().toISOString();

    // Send batch with invalid third record
    const batchRes = await request(APP_URL)
      .post('/sync/batch')
      .send({
        records: [
          {
            employeeId: 'e2e6-emp',
            locationId: 'e2e6-loc',
            totalBalance: 99,
            lastUpdatedAt: now,
          },
          {
            employeeId: 'e2e6-emp',
            locationId: 'e2e6-loc2',
            totalBalance: 55,
            lastUpdatedAt: now,
          },
          {
            employeeId: null,
            locationId: null,
            totalBalance: null,
            lastUpdatedAt: now,
          },
        ],
      });

    expect([400, 500]).toContain(batchRes.status);

    // e2e6-emp/e2e6-loc must be unchanged
    const after = await request(APP_URL)
      .get('/balances/e2e6-emp/e2e6-loc')
      .expect(200);
    expect(after.body.data.totalBalance).toBe(totalBefore);

    console.log('Balance before invalid batch:', totalBefore);
    console.log('Balance after rollback:', after.body.data.totalBalance);
  });
});
