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
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { HousekeepingService } from './housekeeping.service';
import { CreateHousekeepingTaskDto } from './dto/create-housekeeping-task.dto';
import { UpdateHousekeepingTaskDto } from './dto/update-housekeeping-task.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

interface AssignTaskDto {
  assignedToId: string;
  assignedToName?: string;
}

interface CompleteTaskDto {
  completionPercentage?: number;
  notes?: string;
}

interface InspectTaskDto {
  rating: number;
  inspectionNotes?: string;
  inspectedById: string;
  inspectedByName?: string;
}

@ApiTags('Housekeeping')
@ApiBearerAuth()
@Controller({ path: 'housekeeping/tasks', version: '1' })
@UseGuards(JwtAuthGuard)
export class HousekeepingController {
  constructor(private readonly housekeepingService: HousekeepingService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60 } })
  @ApiOperation({ summary: 'Get all housekeeping tasks' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'roomId', required: false, type: String })
  @ApiQuery({ name: 'assignedToId', required: false, type: String })
  @ApiQuery({ name: 'propertyId', required: false, type: String })
  @ApiQuery({ name: 'type', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'List of housekeeping tasks',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'task-123',
            roomId: 'room-101',
            type: 'checkout',
            status: 'pending',
            priority: 'high',
          },
        ],
        meta: { page: 1, limit: 20, total: 50 },
      },
    },
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async getTasks(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
    @Query('roomId') roomId?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('propertyId') propertyId?: string,
    @Query('type') type?: string,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const result = await this.housekeepingService.getTasks(
      { page, limit, status, roomId, assignedToId, propertyId, type },
      user?.tenantId,
    );

    return {
      success: true,
      data: result.data,
      meta: { page: result.page, limit: result.limit, total: result.total },
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @ApiOperation({ summary: 'Create a housekeeping task' })
  @ApiResponse({
    status: 201,
    description: 'Housekeeping task created',
    schema: {
      example: {
        success: true,
        data: { id: 'task-123', roomId: 'room-101', status: 'pending' },
      },
    },
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async createTask(
    @Body() createHousekeepingTaskDto: CreateHousekeepingTaskDto,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const task = await this.housekeepingService.createTask(createHousekeepingTaskDto, user?.tenantId);

    return {
      success: true,
      data: task,
    };
  }

  @Get(':id')
  @Throttle({ default: { limit: 60, ttl: 60 } })
  @ApiOperation({ summary: 'Get a housekeeping task by ID' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiResponse({
    status: 200,
    description: 'Housekeeping task details',
    schema: {
      example: {
        success: true,
        data: { id: 'task-123', roomId: 'room-101', status: 'pending' },
      },
    },
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async getTask(
    @Param('id') id: string,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const task = await this.housekeepingService.getTask(id, user?.tenantId);

    return {
      success: true,
      data: task,
    };
  }

  @Patch(':id')
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @ApiOperation({ summary: 'Update a housekeeping task' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiResponse({
    status: 200,
    description: 'Housekeeping task updated',
    schema: {
      example: {
        success: true,
        data: { id: 'task-123', status: 'completed' },
      },
    },
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async updateTask(
    @Param('id') id: string,
    @Body() updateHousekeepingTaskDto: UpdateHousekeepingTaskDto,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const task = await this.housekeepingService.updateTask(id, updateHousekeepingTaskDto, user?.tenantId);

    return {
      success: true,
      data: task,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @ApiOperation({ summary: 'Delete a housekeeping task' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiResponse({
    status: 204,
    description: 'Housekeeping task deleted',
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async deleteTask(
    @Param('id') id: string,
    @CurrentUser() user?: any,
  ): Promise<void> {
    await this.housekeepingService.deleteTask(id, user?.tenantId);
  }

  @Patch(':id/assign')
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @ApiOperation({ summary: 'Assign task to staff member' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiResponse({
    status: 200,
    description: 'Task assigned',
    schema: {
      example: {
        success: true,
        data: { id: 'task-123', assignedToId: 'staff-456' },
      },
    },
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async assignTask(
    @Param('id') id: string,
    @Body() assignTaskDto: AssignTaskDto,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const task = await this.housekeepingService.assignTask(
      id,
      assignTaskDto.assignedToId,
      assignTaskDto.assignedToName || '',
      user?.tenantId,
    );

    return {
      success: true,
      data: task,
    };
  }

  @Patch(':id/start')
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @ApiOperation({ summary: 'Start task (set status to in_progress)' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiResponse({
    status: 200,
    description: 'Task started',
    schema: {
      example: {
        success: true,
        data: { id: 'task-123', status: 'in_progress', actualStartTime: '2024-01-15T10:00:00Z' },
      },
    },
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async startTask(
    @Param('id') id: string,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const task = await this.housekeepingService.startTask(id, user?.tenantId);

    return {
      success: true,
      data: task,
    };
  }

  @Patch(':id/complete')
  @Throttle({ default: { limit: 15, ttl: 60 } })
  @ApiOperation({ summary: 'Complete task' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiResponse({
    status: 200,
    description: 'Task completed',
    schema: {
      example: {
        success: true,
        data: { id: 'task-123', status: 'completed', actualDuration: 30 },
      },
    },
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async completeTask(
    @Param('id') id: string,
    @Body() completeTaskDto: CompleteTaskDto,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const task = await this.housekeepingService.completeTask(
      id,
      completeTaskDto.completionPercentage ?? 100,
      completeTaskDto.notes ?? '',
      user?.tenantId,
      user?.id,
    );

    return {
      success: true,
      data: task,
    };
  }

  @Patch(':id/inspect')
  @Throttle({ default: { limit: 15, ttl: 60 } })
  @ApiOperation({ summary: 'Inspect completed task' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiResponse({
    status: 200,
    description: 'Task inspected',
    schema: {
      example: {
        success: true,
        data: { id: 'task-123', status: 'inspected', rating: 5 },
      },
    },
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async inspectTask(
    @Param('id') id: string,
    @Body() inspectTaskDto: InspectTaskDto,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const task = await this.housekeepingService.inspectTask(
      id,
      inspectTaskDto.rating,
      inspectTaskDto.inspectionNotes ?? '',
      inspectTaskDto.inspectedById,
      inspectTaskDto.inspectedByName ?? '',
      user?.tenantId,
    );

    return {
      success: true,
      data: task,
    };
  }

  @Get('dashboard/stats')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({ summary: 'Get housekeeping dashboard metrics' })
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
          completedToday: 12,
          avgCompletionTime: 32,
        },
      },
    },
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async getDashboard(
    @Query('propertyId') propertyId?: string,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const dashboard = await this.housekeepingService.getDashboard(propertyId, user?.tenantId);

    return {
      success: true,
      data: dashboard,
    };
  }

  @Get('room/:roomId/status')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({ summary: 'Get room housekeeping status' })
  @ApiParam({ name: 'roomId', description: 'Room ID' })
  @ApiResponse({
    status: 200,
    description: 'Room status',
    schema: {
      example: {
        success: true,
        data: {
          status: 'available',
          roomReadyAt: '2024-01-15T10:35:00Z',
          currentTask: null,
        },
      },
    },
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async getRoomStatus(
    @Param('roomId') roomId: string,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const roomStatus = await this.housekeepingService.getRoomStatus(roomId, user?.tenantId);

    return {
      success: true,
      data: roomStatus,
    };
  }
}
