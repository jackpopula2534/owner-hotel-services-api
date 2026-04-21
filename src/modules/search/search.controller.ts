import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SearchService } from './search.service';

interface CurrentUserType {
  tenantId?: string;
}

interface GlobalSearchResponse {
  guests: Array<{
    id: string;
    name: string;
    email: string;
    phone: string;
    type: 'guest';
  }>;
  bookings: Array<{
    id: string;
    guestName: string;
    roomNumber: string;
    status: string;
    checkIn: Date;
    type: 'booking';
  }>;
  rooms: Array<{
    id: string;
    number: string;
    roomType: string;
    status: string;
    floor: number;
    type: 'room';
  }>;
}

@ApiTags('Search')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'search', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('global')
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'receptionist', 'staff', 'user')
  @ApiOperation({ summary: 'Global search across guests, bookings, rooms' })
  @ApiQuery({
    name: 'q',
    required: true,
    type: 'string',
    description: 'Search query (minimum 2 characters)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: 'number',
    description: 'Max results per category (default: 10)',
  })
  @ApiResponse({ status: 200, description: 'Search results retrieved successfully' })
  async globalSearch(
    @CurrentUser() user: CurrentUserType,
    @Query('q') query: string,
    @Query('limit') limit?: string,
  ): Promise<GlobalSearchResponse> {
    return this.searchService.globalSearch(user.tenantId, query, limit ? parseInt(limit, 10) : 10);
  }
}
