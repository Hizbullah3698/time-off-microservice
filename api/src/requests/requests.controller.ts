import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from './requests.dto';

@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  async createRequest(@Body() dto: CreateRequestDto) {
    return this.requestsService.createRequest(dto);
  }

  @Get()
  async listRequests(@Query() query: { employeeId?: string; status?: string }) {
    return this.requestsService.listRequests(query);
  }

  @Get(':id')
  async getRequest(@Param('id') id: string) {
    return this.requestsService.getRequest(id);
  }

  @Patch(':id/approve')
  async approveRequest(@Param('id') id: string) {
    return this.requestsService.approveRequest(id);
  }

  @Patch(':id/reject')
  async rejectRequest(@Param('id') id: string) {
    return this.requestsService.rejectRequest(id);
  }

  @Patch(':id/cancel')
  async cancelRequest(@Param('id') id: string) {
    return this.requestsService.cancelRequest(id);
  }
}
