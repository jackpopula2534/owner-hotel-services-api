import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiParam } from '@nestjs/swagger';
import { RoomTypeTemplatesService } from './room-type-templates.service';
import { CreateRoomTypeTemplateDto } from './dto/create-room-type-template.dto';
import { UpdateRoomTypeTemplateDto } from './dto/update-room-type-template.dto';
import { BulkCreateTemplateDto } from './dto/bulk-create-template.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AddonGuard } from '../../../common/guards/addon.guard';
import { RequireAddon } from '../../../common/decorators/require-addon.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

@ApiTags('Inventory - Room Type Templates')
@ApiBearerAuth()
@Controller({ path: 'inventory/room-type-templates', version: '1' })
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
export class RoomTypeTemplatesController {
  constructor(private readonly roomTypeTemplatesService: RoomTypeTemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all templates grouped by room type and task type' })
  @ApiResponse({
    status: 200,
    description: 'All templates grouped',
    schema: {
      example: {
        success: true,
        data: {
          deluxe: {
            checkout: [
              {
                id: '550e8400-e29b-41d4-a716-446655440000',
                roomType: 'deluxe',
                taskType: 'checkout',
                itemId: '550e8400-e29b-41d4-a716-446655440001',
                quantity: 2,
                warehouseId: '550e8400-e29b-41d4-a716-446655440002',
              },
            ],
          },
        },
      },
    },
  })
  async findAll(@CurrentUser() user: any): Promise<any> {
    const result = await this.roomTypeTemplatesService.findAll(user?.tenantId);

    return {
      success: true,
      data: result,
    };
  }

  @Get('room-types')
  @ApiOperation({ summary: 'Get distinct room types with configured templates' })
  @ApiResponse({
    status: 200,
    description: 'List of room types',
    schema: {
      example: {
        success: true,
        data: ['deluxe', 'standard', 'suite'],
      },
    },
  })
  async getRoomTypes(@CurrentUser() user: any): Promise<any> {
    const result = await this.roomTypeTemplatesService.getRoomTypes(user?.tenantId);

    return {
      success: true,
      data: result,
    };
  }

  @Get(':roomType')
  @ApiParam({ name: 'roomType', type: String })
  @ApiOperation({ summary: 'Get templates for a specific room type' })
  @ApiResponse({
    status: 200,
    description: 'Templates for room type',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            roomType: 'deluxe',
            taskType: 'checkout',
            itemId: '550e8400-e29b-41d4-a716-446655440001',
            quantity: 2,
          },
        ],
      },
    },
  })
  async findByRoomType(
    @Param('roomType') roomType: string,
    @CurrentUser() user: any,
  ): Promise<any> {
    const result = await this.roomTypeTemplatesService.findByRoomType(user?.tenantId, roomType);

    return {
      success: true,
      data: result,
    };
  }

  @Get(':roomType/:taskType')
  @ApiParam({ name: 'roomType', type: String })
  @ApiParam({ name: 'taskType', type: String })
  @ApiOperation({ summary: 'Get templates for a specific room type and task type' })
  @ApiResponse({
    status: 200,
    description: 'Templates for room type and task type',
  })
  async findByRoomTypeAndTask(
    @Param('roomType') roomType: string,
    @Param('taskType') taskType: string,
    @CurrentUser() user: any,
  ): Promise<any> {
    const result = await this.roomTypeTemplatesService.findByRoomType(
      user?.tenantId,
      roomType,
      taskType,
    );

    return {
      success: true,
      data: result,
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a single template' })
  @ApiResponse({
    status: 201,
    description: 'Template created',
  })
  async create(@Body() dto: CreateRoomTypeTemplateDto, @CurrentUser() user: any): Promise<any> {
    const result = await this.roomTypeTemplatesService.create(dto, user?.tenantId);

    return {
      success: true,
      data: result,
    };
  }

  @Post('bulk')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Bulk create/replace templates for a room type',
    description:
      'Deletes existing templates for the same room type and task type, then creates new ones',
  })
  @ApiResponse({
    status: 201,
    description: 'Templates created',
  })
  async bulkCreate(@Body() dto: BulkCreateTemplateDto, @CurrentUser() user: any): Promise<any> {
    const result = await this.roomTypeTemplatesService.bulkCreate(dto, user?.tenantId);

    return {
      success: true,
      data: result,
    };
  }

  @Post('copy')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Copy templates from one room type to another',
    description:
      'Copies all templates from one room type to another, optionally filtered by task type',
  })
  @ApiResponse({
    status: 201,
    description: 'Templates copied',
  })
  async copyTemplate(
    @Body()
    body: {
      fromRoomType: string;
      toRoomType: string;
      taskType?: string;
    },
    @CurrentUser() user: any,
  ): Promise<any> {
    const result = await this.roomTypeTemplatesService.copyTemplate(
      user?.tenantId,
      body.fromRoomType,
      body.toRoomType,
      body.taskType,
    );

    return {
      success: true,
      data: result,
    };
  }

  @Patch(':id')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({
    summary: 'Update a template',
    description: 'Can only update quantity, warehouseId, and notes',
  })
  @ApiResponse({
    status: 200,
    description: 'Template updated',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRoomTypeTemplateDto,
    @CurrentUser() user: any,
  ): Promise<any> {
    const result = await this.roomTypeTemplatesService.update(id, dto, user?.tenantId);

    return {
      success: true,
      data: result,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Delete a template' })
  @ApiResponse({
    status: 204,
    description: 'Template deleted',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: any): Promise<void> {
    await this.roomTypeTemplatesService.remove(id, user?.tenantId);
  }
}
