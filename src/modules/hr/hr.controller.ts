import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { HrService } from './hr.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('hr')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class HrController {
  constructor(private readonly hrService: HrService) {}

  @Get()
  @ApiOperation({ summary: 'Get all employees' })
  @ApiResponse({ status: 200, description: 'List of employees' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff', 'user')
  async findAll(@Query() query: any, @CurrentUser() user: { tenantId?: string }) {
    return this.hrService.findAll(query, user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get employee by ID' })
  @ApiResponse({ status: 200, description: 'Employee details' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff', 'user')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.hrService.findOne(id, user?.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new employee' })
  @ApiResponse({ status: 201, description: 'Employee created successfully' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
  async create(
    @Body() createEmployeeDto: CreateEmployeeDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.hrService.create(createEmployeeDto, user?.tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update employee' })
  @ApiResponse({ status: 200, description: 'Employee updated successfully' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
  async update(
    @Param('id') id: string,
    @Body() updateEmployeeDto: UpdateEmployeeDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.hrService.update(id, updateEmployeeDto, user?.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete employee' })
  @ApiResponse({ status: 200, description: 'Employee deleted successfully' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.hrService.remove(id, user?.tenantId);
  }
}

