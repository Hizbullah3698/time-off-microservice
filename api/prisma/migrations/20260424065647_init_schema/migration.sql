-- CreateTable
CREATE TABLE "TimeOffRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "daysRequested" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "hcmSynced" BOOLEAN NOT NULL DEFAULT false,
    "syncError" BOOLEAN NOT NULL DEFAULT false,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastRetryAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BalanceCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "totalBalance" REAL NOT NULL DEFAULT 0,
    "pendingDeductions" REAL NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "employeeId" TEXT,
    "locationId" TEXT,
    "previousBalance" REAL,
    "newBalance" REAL,
    "eventId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "TimeOffRequest_idempotencyKey_key" ON "TimeOffRequest"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "BalanceCache_employeeId_locationId_key" ON "BalanceCache"("employeeId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncLog_eventId_key" ON "SyncLog"("eventId");
