# Time-Off Service

A NestJS microservice for managing employee time-off requests with integration to an external HCM (Human Capital Management) system.

## Architecture

```
┌─────────────────┐        ┌──────────────────┐
│   NestJS API    │◄──────►│   Mock HCM       │
│   (port 3000)   │  HTTP  │   (port 4000)    │
│                 │        │                  │
│  ┌───────────┐  │        │  Balances Store   │
│  │  SQLite   │  │        │  Idempotency Log  │
│  │  (Prisma) │  │        │  Admin Controls   │
│  └───────────┘  │        └──────────────────┘
└─────────────────┘
```

### Core Modules

| Module | Description |
|--------|-------------|
| `requests/` | Request lifecycle (create → approve → cancel) with balance pre-checks |
| `balances/` | Balance cache with realtime sync and `availableBalance` calculation |
| `sync/` | Batch sync endpoint + webhook receiver with stale-data protection |
| `hcm-client/` | HTTP client for HCM API with custom error classes |
| `reconciliation/` | Cron worker (every 2 min) retries failed HCM syncs with exponential backoff |
| `common/filters/` | GlobalExceptionFilter — wraps errors as `{ success: false, error: {...} }` |
| `common/interceptors/` | ResponseInterceptor — wraps responses as `{ success: true, data: ... }` |

## Prerequisites

- Node.js >= 18
- npm >= 9

## Quick Start

### 1. Install dependencies

```bash
# API
cd api && npm install

# Mock HCM
cd mock-hcm && npm install
```

### 2. Set up the database

```bash
cd api
npx prisma db push
```

### 3. Start servers

```bash
# Terminal 1: Mock HCM server
cd mock-hcm && node server.js

# Terminal 2: NestJS API
cd api && npm run start
```

The API will be available at `http://localhost:3000` and mock HCM at `http://localhost:4000`.

## Environment Variables

Create `api/.env`:

```env
DATABASE_URL="file:../data/time-off.sqlite"
HCM_BASE_URL="http://127.0.0.1:4000"
HCM_TIMEOUT_MS="3000"
```

## API Endpoints

### Requests
| Method | Path | Description |
|--------|------|-------------|
| POST | `/requests` | Create a time-off request |
| GET | `/requests` | List requests (filter by `?employeeId=`) |
| GET | `/requests/:id` | Get request by ID |
| PATCH | `/requests/:id/approve` | Approve a pending request |
| PATCH | `/requests/:id/reject` | Reject a pending request |
| PATCH | `/requests/:id/cancel` | Cancel a pending or approved request |

### Balances
| Method | Path | Description |
|--------|------|-------------|
| GET | `/balances/:employeeId/:locationId` | Get cached balance |
| POST | `/balances/sync/:employeeId/:locationId` | Force realtime sync from HCM |

### Sync
| Method | Path | Description |
|--------|------|-------------|
| POST | `/sync/batch` | Receive batch balance updates (`{ records: [...] }`) |
| POST | `/webhooks/hcm-update` | Receive HCM webhook updates |

## Testing

### Test Tiers

| Tier | Count | Command | Description |
|------|-------|---------|-------------|
| Unit | 18 | `npm test` | Mocked DB + HCM, no servers needed |
| Integration | 10 | `npm run test:integration` | Live API + mock HCM required |
| E2E | 6 | `npm run test:e2e` | Full scenarios including reconciliation |

### Run unit tests (no servers needed)

```bash
cd api && npm test
```

### Run integration tests (both servers must be running)

```bash
# Start servers first (see Quick Start), then:
cd api && npm run test:integration
```

### Run E2E tests (both servers must be running)

```bash
# Start servers first (see Quick Start), then:
cd api && npm run test:e2e
```

> **Note:** E2E-3 (reconciliation test) waits for the cron worker and takes 40-130 seconds.

### Run all tests with coverage

```bash
cd api && npx jest --coverage --testPathPatterns="src|integration" --testTimeout=30000
```

## Project Structure

```
time-off-service/
├── api/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── src/
│   │   ├── balances/         # Balance cache + sync
│   │   ├── common/
│   │   │   ├── filters/      # GlobalExceptionFilter
│   │   │   └── interceptors/ # ResponseInterceptor
│   │   ├── hcm-client/       # HCM HTTP client + errors
│   │   ├── prisma/           # PrismaService
│   │   ├── reconciliation/   # Cron reconciliation worker
│   │   ├── requests/         # Request lifecycle
│   │   └── sync/             # Batch sync + webhooks
│   ├── test/
│   │   ├── integration/      # Integration tests
│   │   └── e2e/              # E2E tests
│   ├── COVERAGE_REPORT.md
│   └── package.json
├── mock-hcm/
│   └── server.js             # Mock HCM with admin endpoints
└── README.md
```
