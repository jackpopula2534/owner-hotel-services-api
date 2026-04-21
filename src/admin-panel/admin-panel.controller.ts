import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminPanelService } from './admin-panel.service';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('admin-panel')
@SkipSubscriptionCheck()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('platform_admin')
export class AdminPanelController {
  constructor(private readonly adminPanelService: AdminPanelService) {}

  /**
   * 9️⃣ SaaS Admin Panel Dashboard
   * GET /admin-panel/dashboard
   */
  @Get('dashboard')
  async getDashboard() {
    return this.adminPanelService.getDashboard();
  }

  /**
   * GET /admin-panel/hotels
   */
  @Get('hotels')
  async getAllHotels() {
    return this.adminPanelService.getAllHotels();
  }

  /**
   * GET /admin-panel/pending-payments
   */
  @Get('pending-payments')
  async getPendingPaymentsWithDetails() {
    return this.adminPanelService.getPendingPaymentsWithDetails();
  }
}
