const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// ─── IN-MEMORY STORE ────────────────────────────────────────────────────────

const balances = new Map();       // key: `${employeeId}:${locationId}`, value: number
const idempotencyLog = new Map(); // key: idempotencyKey, value: { result, processedAt }

const SEED_DATA = [
  { employeeId: 'emp1', locationId: 'loc1', balance: 10 },
  { employeeId: 'emp1', locationId: 'loc2', balance: 5 },
  { employeeId: 'emp2', locationId: 'loc1', balance: 20 },
  { employeeId: 'emp3', locationId: 'loc1', balance: 5 },
];

function seedBalances() {
  balances.clear();
  SEED_DATA.forEach(({ employeeId, locationId, balance }) => {
    balances.set(`${employeeId}:${locationId}`, balance);
  });
}
seedBalances();

// ─── MODE FLAGS ─────────────────────────────────────────────────────────────

let silentFailureMode = false; // accept deductions without checking balance
let offlineMode = false;       // return 503 on all non-admin routes

// ─── REQUEST LOGGING MIDDLEWARE ─────────────────────────────────────────────

app.use((req, res, next) => {
  const start = Date.now();
  const originalSend = res.send.bind(res);

  res.send = function (body) {
    const duration = Date.now() - start;
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const truncated = bodyStr && bodyStr.length > 200 ? bodyStr.slice(0, 200) + '...' : bodyStr;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.path} → ${res.statusCode} (${duration}ms) ${truncated || ''}`
    );
    return originalSend(body);
  };

  next();
});

// ─── OFFLINE MIDDLEWARE (skips /admin routes) ───────────────────────────────

app.use((req, res, next) => {
  if (offlineMode && !req.path.startsWith('/admin')) {
    return res.status(503).json({ error: 'HCM offline' });
  }
  next();
});

// ─── BUSINESS ENDPOINTS ────────────────────────────────────────────────────

// GET /balances/:employeeId/:locationId
app.get('/balances/:employeeId/:locationId', (req, res) => {
  try {
    const { employeeId, locationId } = req.params;
    const key = `${employeeId}:${locationId}`;
    if (!balances.has(key)) balances.set(key, 0);
    return res.status(200).json({ balance: balances.get(key) });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

// POST /deductions
app.post('/deductions', (req, res) => {
  try {
    const { employeeId, locationId, days, idempotencyKey } = req.body;

    // Validate required fields
    if (!employeeId || !locationId || !days || !idempotencyKey || days <= 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Idempotency check — return stored result without re-processing
    if (idempotencyLog.has(idempotencyKey)) {
      return res.status(200).json(idempotencyLog.get(idempotencyKey).result);
    }

    const key = `${employeeId}:${locationId}`;
    if (!balances.has(key)) balances.set(key, 0);
    const current = balances.get(key);

    // Balance check (skipped in silent failure mode)
    if (!silentFailureMode && current < days) {
      return res.status(422).json({ error: 'Insufficient balance', currentBalance: current });
    }

    balances.set(key, current - days);
    const result = { remainingBalance: balances.get(key) };
    idempotencyLog.set(idempotencyKey, { result, processedAt: new Date().toISOString() });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

// POST /restorations
app.post('/restorations', (req, res) => {
  try {
    const { employeeId, locationId, days, idempotencyKey } = req.body;

    // Validate required fields
    if (!employeeId || !locationId || days === undefined || !idempotencyKey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Idempotency check
    if (idempotencyLog.has(idempotencyKey)) {
      return res.status(200).json(idempotencyLog.get(idempotencyKey).result);
    }

    const key = `${employeeId}:${locationId}`;
    if (!balances.has(key)) balances.set(key, 0);
    balances.set(key, balances.get(key) + days);
    const result = { restoredBalance: balances.get(key) };
    idempotencyLog.set(idempotencyKey, { result, processedAt: new Date().toISOString() });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

// ─── ADMIN ENDPOINTS (never affected by offlineMode) ───────────────────────

// POST /admin/set-balance
app.post('/admin/set-balance', (req, res) => {
  try {
    const { employeeId, locationId, balance } = req.body;
    balances.set(`${employeeId}:${locationId}`, balance);
    return res.status(200).json({ ok: true, balance });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

// POST /admin/simulate-anniversary
app.post('/admin/simulate-anniversary', (req, res) => {
  try {
    const { employeeId, locationId, bonusDays } = req.body;
    const key = `${employeeId}:${locationId}`;
    if (!balances.has(key)) balances.set(key, 0);
    const newBalance = balances.get(key) + bonusDays;
    balances.set(key, newBalance);
    return res.status(200).json({ ok: true, newBalance });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

// POST /admin/set-silent-failure
app.post('/admin/set-silent-failure', (req, res) => {
  try {
    const { enabled } = req.body;
    silentFailureMode = enabled;
    return res.status(200).json({ silentFailureMode });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

// POST /admin/go-offline
app.post('/admin/go-offline', (req, res) => {
  try {
    const { offline } = req.body;
    offlineMode = offline;
    return res.status(200).json({ offlineMode });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

// POST /admin/reset
app.post('/admin/reset', (req, res) => {
  try {
    seedBalances();
    idempotencyLog.clear();
    silentFailureMode = false;
    offlineMode = false;
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

// GET /admin/state
app.get('/admin/state', (req, res) => {
  try {
    return res.status(200).json({
      balances: Object.fromEntries(balances),
      idempotencyLogSize: idempotencyLog.size,
      silentFailureMode,
      offlineMode,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

// ─── STARTUP ────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 4000;
app.listen(PORT, () => {
  console.log(`Mock HCM server listening on port ${PORT}`);
});
