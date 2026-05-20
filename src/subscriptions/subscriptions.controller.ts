import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

// JwtAuthGuard MUST be wired here. TenantGuard is registered globally in
// AppModule and rejects any request that hits a route with a `:tenantId` URL
// param when `request.user` is missing — without the JWT guard decoding the
// bearer token, `request.user` stays undefined and TenantGuard throws 403
// (TENANT_REQUIRED). Symptom: the dashboard renders the "บริษัทยังไม่มี
// แพ็กเกจการใช้งาน" lock card even for active tenants.
@Controller('subscriptions')
@SkipSubscriptionCheck()
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post()
  create(@Body() createSubscriptionDto: CreateSubscriptionDto) {
    return this.subscriptionsService.create(createSubscriptionDto);
  }

  @Get()
  findAll() {
    return this.subscriptionsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.subscriptionsService.findOne(id);
  }

  @Get('tenant/:tenantId')
  findByTenantId(@Param('tenantId') tenantId: string) {
    return this.subscriptionsService.findByTenantId(tenantId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSubscriptionDto: UpdateSubscriptionDto) {
    return this.subscriptionsService.update(id, updateSubscriptionDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.subscriptionsService.remove(id);
  }
}
