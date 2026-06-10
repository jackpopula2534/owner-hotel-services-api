import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { HrEmployeeDocumentService } from './hr-employee-document.service';
import {
  CreateHrEmployeeDocumentDto,
  UpdateHrEmployeeDocumentDto,
} from './dto/hr-employee-document.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('hr / employee documents')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/employee-documents', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrEmployeeDocumentController {
  constructor(private readonly service: HrEmployeeDocumentService) {}

  @Get()
  @ApiOperation({ summary: 'List employee documents' })
  @ApiQuery({ name: 'employeeId', required: false, type: String })
  @ApiQuery({ name: 'type', required: false, type: String })
  @ApiQuery({ name: 'expiringInDays', required: false, type: Number, description: 'Filter docs expiring within N days' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findAll(@Query() query: Record<string, string>, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findAll(query, user.tenantId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get employee document by ID' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findOne(id, user.tenantId!);
  }

  @Post()
  @ApiOperation({ summary: 'Register an uploaded employee document' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async create(
    @Body() dto: CreateHrEmployeeDocumentDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.service.create(dto, user.tenantId!, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update employee document metadata' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateHrEmployeeDocumentDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.update(id, dto, user.tenantId!);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete an employee document' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string; id?: string }) {
    return this.service.remove(id, user.tenantId!, user.id);
  }
}
