import { Controller, Get, UseGuards } from '@nestjs/common';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('renewal-status')
  @UseGuards(JwtAuthGuard)
  async getRenewalStatus(@CurrentUser() user: any) {
    const subscription = await this.subscriptionsService.findByTenantId(user.tenantId);
    
    // Logic to get payment history would go here
    // For now, return basic info and empty payment history
    return {
      status: subscription?.status || 'inactive',
      endDate: subscription?.endDate || null,
      autoRenew: (subscription as any)?.autoRenew || false,
      paymentHistory: [], // Would fetch from Invoices/Payments
    };
  }
}
