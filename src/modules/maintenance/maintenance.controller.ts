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
import { MaintenanceService } from './maintenance.service';
import { CreateMaintenanceTaskDto } from './dto/create-maintenance-task.dto';
import { UpdateMaintenanceTaskDto } from './dto/update-maintenance-task.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Maintenance')
@ApiBearerAuth()
@Controller({ path: 'maintenance/tasks', version: '1' })
@UseGuards(JwtAuthGuard)
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Get()
  @ApiOperation({ summary: 'Get all maintenance tasks' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'category', required: false, type: String })
  @ApiQuery({ name: 'priority', required: false, type: String })
  @ApiQuery({ name: 'propertyId', required: false, type: String })
  @ApiQuery({ name: 'roomId', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'List of maintenance tasks',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'task-123',
            title: 'AC unit not cooling',
            category: 'ac',
            status: 'pending',
            priority: 'high',
          },
        ],
        meta: {
          page: 1,
          limit: 20,
          total: 50,
        },
      },
    },
  })
  async findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('priority') priority?: string,
    @Query('propertyId') propertyId?: string,
    @Query('roomId') roomId?: string,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const result = await this.maintenanceService.findAll(
      { page, limit, status, category, priority, propertyId, roomId },
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
  @ApiOperation({ summary: 'Create a new maintenance task' })
  @ApiResponse({
    status: 201,
    description: 'Maintenance task created',
    schema: {
      example: {
        success: true,
        data: {
          id: 'task-123',
          title: 'AC unit not cooling',
          category: 'ac',
          status: 'pending',
        },
      },
    },
  })
  async create(
    @Body() createMaintenanceTaskDto: CreateMaintenanceTaskDto,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const task = await this.maintenanceService.create(createMaintenanceTaskDto, user?.tenantId);

    return {
      success: true,
      data: task,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a maintenance task by ID' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiResponse({
    status: 200,
    description: 'Maintenance task details',
    schema: {
      example: {
        success: true,
        data: {
          id: 'task-123',
          title: 'AC unit not cooling',
          category: 'ac',
          status: 'pending',
          priority: 'high',
        },
      },
    },
  })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const task = await this.maintenanceService.findOne(id, user?.tenantId);

    return {
      success: true,
      data: task,
    };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a maintenance task' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiResponse({
    status: 200,
    description: 'Maintenance task updated',
    schema: {
      example: {
        success: true,
        data: {
          id: 'task-123',
          status: 'completed',
          rating: 5,
        },
      },
    },
  })
  async update(
    @Param('id') id: string,
    @Body() updateMaintenanceTaskDto: UpdateMaintenanceTaskDto,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const task = await this.maintenanceService.update(id, updateMaintenanceTaskDto, user?.tenantId);

    return {
      success: true,
      data: task,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a maintenance task' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiResponse({
    status: 204,
    description: 'Maintenance task deleted',
  })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user?: any,
  ): Promise<void> {
    await this.maintenanceService.remove(id, user?.tenantId);
  }

  @Get('dashboard/stats')
  @ApiOperation({ summary: 'Get maintenance dashboard metrics' })
  @ApiQuery({ name: 'propertyId', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'Dashboard metrics',
    schema: {
      example: {
        success: true,
        data: {
          pendingCount: 5,
          inProgressCount: 2,
          completedCount: 25,
          totalEstimatedCost: 5000,
          totalActualCost: 4800,
          byCategory: [
            { category: 'ac', count: 10, cost: 2000 },
          ],
        },
      },
    },
  })
  async getDashboard(
    @Query('propertyId') propertyId?: string,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const dashboard = await this.maintenanceService.getDashboard(propertyId, user?.tenantId);

    return {
      success: true,
      data: dashboard,
    };
  }
}
