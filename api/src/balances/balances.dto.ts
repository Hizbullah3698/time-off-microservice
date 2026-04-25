export class BalanceDto {
  employeeId: string;
  locationId: string;
  totalBalance: number;
  pendingDeductions: number;
  availableBalance: number;
  lastSyncedAt: Date | null;
}
