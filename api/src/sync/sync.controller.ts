import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { SyncService } from './sync.service';

@Controller()
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('sync/batch')
  @HttpCode(200)
  async receiveBatch(@Body() body: any) {
    const records = Array.isArray(body) ? body : body.records;
    return this.syncService.receiveBatch(records);
  }

  @Post('webhooks/hcm-update')
  @HttpCode(200)
  async receiveWebhook(@Body() body: any) {
    return this.syncService.receiveWebhook(body);
  }
}
