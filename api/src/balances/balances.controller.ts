import { Controller, Get, Post, Param, HttpCode } from '@nestjs/common';
import { BalancesService } from './balances.service';
import { BalanceDto } from './balances.dto';

@Controller('balances')
export class BalancesController {
  constructor(private readonly balancesService: BalancesService) {}

  @Get(':employeeId/:locationId')
  async getBalance(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
  ): Promise<BalanceDto> {
    return this.balancesService.getBalance(employeeId, locationId);
  }

  @Post('sync/:employeeId/:locationId')
  @HttpCode(200)
  async forceRealtimeSync(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
  ): Promise<BalanceDto> {
    return this.balancesService.forceRealtimeSync(employeeId, locationId);
  }
}
