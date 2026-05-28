import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CrmContactsService } from './crm-contacts.service';
import { CreateContactDto, QueryContactsDto, UpdateContactDto } from './dto/create-contact.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('crm/contacts')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'crm/contacts' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class CrmContactsController {
  constructor(private readonly contacts: CrmContactsService) {}

  @Get()
  @ApiOperation({ summary: 'List CRM contacts with filtering' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_agent', 'crm_manager')
  async findAll(@Query() query: QueryContactsDto, @CurrentUser() user: { tenantId?: string }) {
    return this.contacts.findAll(query, user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get CRM contact by ID' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_agent', 'crm_manager')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.contacts.findOne(id, user?.tenantId);
  }

  @Get(':id/stay-history')
  @ApiOperation({ summary: 'Get linked booking history for a contact' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_agent', 'crm_manager')
  async stayHistory(@Param('id') id: string, @CurrentUser() user: { tenantId: string }) {
    return this.contacts.getStayHistory(id, user.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a CRM contact (optionally linked to a Guest)' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async create(@Body() dto: CreateContactDto, @CurrentUser() user: { tenantId?: string }) {
    return this.contacts.create(dto, user?.tenantId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update CRM contact (PUT)' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async updatePut(
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.contacts.update(id, dto, user?.tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update CRM contact (PATCH)' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async updatePatch(
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.contacts.update(id, dto, user?.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a CRM contact' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.contacts.remove(id, user?.tenantId);
  }
}
