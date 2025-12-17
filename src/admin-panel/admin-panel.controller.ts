import { Controller, Get } from '@nestjs/common';
import { AdminPanelService } from './admin-panel.service';

@Controller('admin-panel')
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


