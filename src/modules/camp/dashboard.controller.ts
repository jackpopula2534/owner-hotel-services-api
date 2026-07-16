import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CampDashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AddonGuard } from '../../common/guards/addon.guard';
import { RequireAddon } from '../../common/decorators/require-addon.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { UserRole } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

const READ_ROLES: UserRole[] = ['admin', 'manager', 'tenant_admin', 'platform_admin', 'staff', 'user'];

@ApiTags('camp-dashboard')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'camp/dashboard', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard, AddonGuard)
@RequireAddon('CAMP_MODULE')
export class CampDashboardController {
  constructor(private readonly service: CampDashboardService) {}

  @Get('stats')
  @ApiOperation({
    summary: 'Management dashboard stats (revenue, occupancy, bookings, inventory, operations)',
  })
  @Roles(...READ_ROLES)
  getStats(
    @Query('campgroundId') campgroundId: string,
    @Query('period') period: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.getStats({ campgroundId, period }, user?.tenantId);
  }
}
