import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CrmTicketsService } from './crm-tickets.service';
import {
  CreateTicketDto,
  CsatScoreDto,
  QueryTicketsDto,
  UpdateTicketDto,
} from './dto/create-ticket.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AddonGuard } from '../../common/guards/addon.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireAddon } from '../../common/decorators/require-addon.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('crm/tickets')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'crm/tickets' })
@UseGuards(JwtAuthGuard, RolesGuard, AddonGuard)
@RequireAddon('CRM_MODULE')
export class CrmTicketsController {
  constructor(private readonly tickets: CrmTicketsService) {}

  @Get()
  @ApiOperation({ summary: 'List tickets with filtering' })
  @Roles(
    'admin',
    'manager',
    'tenant_admin',
    'platform_admin',
    'crm_agent',
    'crm_manager',
    'receptionist',
  )
  async findAll(@Query() query: QueryTicketsDto, @CurrentUser() user: { tenantId?: string }) {
    return this.tickets.findAll(query, user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get ticket by ID' })
  @Roles(
    'admin',
    'manager',
    'tenant_admin',
    'platform_admin',
    'crm_agent',
    'crm_manager',
    'receptionist',
  )
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.tickets.findOne(id, user?.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Open a new ticket' })
  @Roles(
    'admin',
    'manager',
    'tenant_admin',
    'platform_admin',
    'crm_agent',
    'crm_manager',
    'receptionist',
  )
  async create(@Body() dto: CreateTicketDto, @CurrentUser() user: { tenantId?: string }) {
    return this.tickets.create(dto, user?.tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update ticket fields / status' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_agent', 'crm_manager')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.tickets.update(id, dto, user?.tenantId);
  }

  @Patch(':id/assign/:userId')
  @ApiOperation({ summary: 'Assign ticket to a user' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async assign(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.tickets.assign(id, userId, user?.tenantId);
  }

  @Patch(':id/resolve')
  @ApiOperation({ summary: 'Mark ticket as resolved' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_agent', 'crm_manager')
  async resolve(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.tickets.resolve(id, user?.tenantId);
  }

  @Patch(':id/close')
  @ApiOperation({ summary: 'Close ticket' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_agent', 'crm_manager')
  async close(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.tickets.close(id, user?.tenantId);
  }

  @Post(':id/csat')
  @ApiOperation({ summary: 'Submit CSAT score (1-5)' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_agent', 'crm_manager', 'user')
  async csat(
    @Param('id') id: string,
    @Body() dto: CsatScoreDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.tickets.recordCsat(id, dto, user?.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a ticket' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.tickets.remove(id, user?.tenantId);
  }
}
