import { Controller, Post, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { StaffCallService } from './staff-call.service';
import { CreateStaffCallDto, CallSourceDto } from './dto/create-staff-call.dto';

@ApiTags('Staff Calls (Public)')
@Controller({ path: 'public/restaurants/:restaurantId/staff-calls', version: '1' })
export class StaffCallPublicController {
  constructor(private readonly staffCallService: StaffCallService) {}

  // ─── Customer creates a staff call via QR scan page ─────────────────────────
  @Post()
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 calls per minute per IP
  @ApiOperation({ summary: 'Create a staff call from customer QR page (no auth)' })
  @ApiResponse({ status: 201, description: 'Call created' })
  @ApiResponse({ status: 400, description: 'Duplicate pending call' })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  async create(@Param('restaurantId') restaurantId: string, @Body() dto: CreateStaffCallDto) {
    // Resolve tenantId from restaurant
    // For public endpoints we need to look up the tenant from the restaurant
    const call = await this.staffCallService.createPublic(restaurantId, {
      ...dto,
      source: CallSourceDto.CUSTOMER,
    });

    return { success: true, data: { id: call.id, status: call.status } };
  }
}
