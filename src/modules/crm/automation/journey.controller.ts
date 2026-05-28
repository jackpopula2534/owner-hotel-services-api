import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JourneyService } from './journey.service';
import { CreateJourneyDto, UpdateJourneyDto } from './dto/journey.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

@ApiTags('crm/journeys')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'crm/journeys' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class JourneyController {
  constructor(private readonly journeys: JourneyService) {}

  @Get()
  @ApiOperation({ summary: 'List journey flows' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'crm_agent')
  async findAll(@CurrentUser() user: { tenantId?: string }) {
    return this.journeys.findAll(user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get journey by ID' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'crm_agent')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.journeys.findOne(id, user?.tenantId);
  }

  @Get(':id/enrollments')
  @ApiOperation({ summary: 'List enrollments for a journey' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'crm_agent')
  async enrollments(@Param('id') id: string, @CurrentUser() user: { tenantId: string }) {
    return this.journeys.getEnrollments(id, user.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a journey flow' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async create(
    @Body() dto: CreateJourneyDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.journeys.create(dto, user?.tenantId, user?.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a journey flow' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateJourneyDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.journeys.update(id, dto, user?.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a journey flow' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId: string }) {
    return this.journeys.remove(id, user.tenantId);
  }

  @Post('enrollments/:id/cancel')
  @ApiOperation({ summary: 'Cancel an active enrollment' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async cancelEnrollment(@Param('id') id: string, @CurrentUser() user: { tenantId: string }) {
    return this.journeys.cancelEnrollment(id, user.tenantId);
  }
}
