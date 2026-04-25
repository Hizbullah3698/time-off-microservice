const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.balanceCache.upsert({
    where: { employeeId_locationId: { employeeId: 'emp1', locationId: 'loc1' } },
    update: { totalBalance: 10, pendingDeductions: 0 },
    create: { employeeId: 'emp1', locationId: 'loc1', totalBalance: 10, pendingDeductions: 0 },
  });
  console.log('Seeded emp1:loc1');
}

main().catch(console.error).finally(() => prisma.$disconnect());
