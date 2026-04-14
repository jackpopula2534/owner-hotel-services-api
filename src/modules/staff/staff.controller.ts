import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Patch,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { StaffService } from './staff.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { LinkEmployeeDto } from './dto/link-employee.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Staff')
@ApiBearerAuth()
@Controller({ path: 'staff', version: '1' })
@UseGuards(JwtAuthGuard)
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  @ApiOperation({ summary: 'Get all staff members' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'department', required: false, type: String })
  @ApiQuery({ name: 'role', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'List of staff members',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'staff-123',
            firstName: 'John',
            lastName: 'Doe',
            email: 'john@example.com',
            role: 'housekeeper',
            status: 'active',
            tasksToday: 5,
            completedToday: 3,
          },
        ],
        meta: {
          page: 1,
          limit: 20,
          total: 100,
        },
      },
    },
  })
  async findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
    @Query('department') department?: string,
    @Query('role') role?: string,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const result = await this.staffService.findAll(
      { page, limit, status, department, role },
      user?.tenantId,
    );

    return {
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total,
      },
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new staff member' })
  @ApiResponse({
    status: 201,
    description: 'Staff member created',
    schema: {
      example: {
        success: true,
        data: {
          id: 'staff-123',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          role: 'housekeeper',
          status: 'active',
        },
      },
    },
  })
  async create(
    @Body() createStaffDto: CreateStaffDto,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const staff = await this.staffService.create(createStaffDto, user?.tenantId, user?.id);

    return {
      success: true,
      data: staff,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a staff member by ID' })
  @ApiParam({ name: 'id', description: 'Staff ID' })
  @ApiResponse({
    status: 200,
    description: 'Staff member details',
    schema: {
      example: {
        success: true,
        data: {
          id: 'staff-123',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          role: 'housekeeper',
          status: 'active',
        },
      },
    },
  })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const staff = await this.staffService.findOne(id, user?.tenantId);

    return {
      success: true,
      data: staff,
    };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a staff member' })
  @ApiParam({ name: 'id', description: 'Staff ID' })
  @ApiResponse({
    status: 200,
    description: 'Staff member updated',
    schema: {
      example: {
        success: true,
        data: {
          id: 'staff-123',
          firstName: 'John',
          lastName: 'Doe',
          status: 'inactive',
        },
      },
    },
  })
  async update(
    @Param('id') id: string,
    @Body() updateStaffDto: UpdateStaffDto,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const staff = await this.staffService.update(id, updateStaffDto, user?.tenantId, user?.id);

    return {
      success: true,
      data: staff,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a staff member' })
  @ApiParam({ name: 'id', description: 'Staff ID' })
  @ApiResponse({
    status: 204,
    description: 'Staff member deleted',
  })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user?: any,
  ): Promise<void> {
    await this.staffService.remove(id, user?.tenantId);
  }

  @Get(':id/performance')
  @ApiOperation({ summary: 'Get staff performance metrics' })
  @ApiParam({ name: 'id', description: 'Staff ID' })
  @ApiQuery({ name: 'period', required: false, enum: ['week', 'month', 'year'], example: 'month' })
  @ApiResponse({
    status: 200,
    description: 'Staff performance data',
    schema: {
      example: {
        success: true,
        data: {
          tasksCompleted: 45,
          averageCompletionTime: 32,
          rating: 4.5,
          efficiency: 95,
          completedByDate: [
            { date: '2024-01-01', count: 5 },
            { date: '2024-01-02', count: 6 },
          ],
        },
      },
    },
  })
  async getPerformance(
    @Param('id') id: string,
    @Query('period') period: 'week' | 'month' | 'year' = 'month',
    @CurrentUser() user?: any,
  ): Promise<any> {
    const performance = await this.staffService.getPerformance(id, user?.tenantId, period);

    return {
      success: true,
      data: performance,
    };
  }

  // ─── HR Add-on bridge endpoints ─────────────────────────────────────────────
  // Require HrAddonGuard — tenant must have active HR_MODULE subscription add-on

  @Post(':id/link-employee')
  @UseGuards(HrAddonGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Link an Employee record to this Staff (requires HR add-on)',
    description:
      'Creates a relationship between a Staff member and an HR Employee. ' +
      'Both must belong to the same tenant. Requires active HR_MODULE add-on.',
  })
  @ApiParam({ name: 'id', description: 'Staff ID' })
  @ApiResponse({ status: 200, description: 'Employee linked successfully' })
  @ApiResponse({ status: 403, description: 'HR add-on not active' })
  @ApiResponse({ status: 404, description: 'Staff or Employee not found' })
  @ApiResponse({ status: 409, description: 'Already linked' })
  async linkEmployee(
    @Param('id') id: string,
    @Body() dto: LinkEmployeeDto,
    @CurrentUser() user?: any,
  ): Promise<any> {
    return this.staffService.linkEmployee(id, dto, user?.tenantId);
  }

  @Delete(':id/link-employee')
  @UseGuards(HrAddonGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove HR Employee link from Staff (requires HR add-on)',
    description:
      'Removes the HR link. Staff record is preserved with all operational data; ' +
      'only the employeeId FK is cleared.',
  })
  @ApiParam({ name: 'id', description: 'Staff ID' })
  @ApiResponse({ status: 200, description: 'Link removed successfully' })
  @ApiResponse({ status: 403, description: 'HR add-on not active' })
  @ApiResponse({ status: 400, description: 'Staff is not linked to any employee' })
  async unlinkEmployee(
    @Param('id') id: string,
    @CurrentUser() user?: any,
  ): Promise<any> {
    return this.staffService.unlinkEmployee(id, user?.tenantId);
  }

  @Get(':id/employee')
  @UseGuards(HrAddonGuard)
  @ApiOperation({
    summary: 'Get the HR Employee record linked to this Staff (requires HR add-on)',
  })
  @ApiParam({ name: 'id', description: 'Staff ID' })
  @ApiResponse({ status: 200, description: 'Linked Employee record (or null if not linked)' })
  @ApiResponse({ status: 403, description: 'HR add-on not active' })
  @ApiResponse({ status: 404, description: 'Staff not found' })
  async getLinkedEmployee(
    @Param('id') id: string,
    @CurrentUser() user?: any,
  ): Promise<any> {
    return this.staffService.getLinkedEmployee(id, user?.tenantId);
  }
}
