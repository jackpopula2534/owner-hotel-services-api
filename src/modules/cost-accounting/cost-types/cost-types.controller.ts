import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { CostTypesService } from './cost-types.service';
import { CreateCostTypeDto } from './dto/create-cost-type.dto';
import { UpdateCostTypeDto } from './dto/update-cost-type.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

@ApiTags('Cost Accounting - Cost Types')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('COST_ACCOUNTING_MODULE')
@Controller({ path: 'cost-accounting/cost-types', version: '1' })
export class CostTypesController {
  constructor(private readonly costTypesService: CostTypesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all cost types, optionally filtered by category' })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: ['MATERIAL', 'LABOR', 'OVERHEAD', 'REVENUE', 'OTHER'],
    description: 'Filter by cost type category',
  })
  @ApiResponse({
    status: 200,
    description: 'List of cost types',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            tenantId: 'uuid',
            name: 'Room Amenities',
            code: 'CT-AMEN',
            category: 'MATERIAL',
            description: 'Toiletries and amenities for guest rooms',
            sortOrder: 1,
            isActive: true,
            createdAt: '2026-04-15T00:00:00Z',
            updatedAt: '2026-04-15T00:00:00Z',
          },
        ],
      },
    },
  })
  async findAll(@CurrentUser() user: JwtPayload, @Query('category') category?: string) {
    const data = await this.costTypesService.findAll(user.tenantId, category);
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get cost type by ID' })
  @ApiResponse({
    status: 200,
    description: 'Cost type details',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          tenantId: 'uuid',
          name: 'Room Amenities',
          code: 'CT-AMEN',
          category: 'MATERIAL',
          description: 'Toiletries and amenities for guest rooms',
          sortOrder: 1,
          isActive: true,
          createdAt: '2026-04-15T00:00:00Z',
          updatedAt: '2026-04-15T00:00:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Cost type not found' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.costTypesService.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new cost type' })
  @ApiResponse({
    status: 201,
    description: 'Cost type created successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          tenantId: 'uuid',
          name: 'Room Amenities',
          code: 'CT-AMEN',
          category: 'MATERIAL',
          description: 'Toiletries and amenities for guest rooms',
          sortOrder: 1,
          isActive: true,
          createdAt: '2026-04-15T00:00:00Z',
          updatedAt: '2026-04-15T00:00:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 409, description: 'Cost type code already exists' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCostTypeDto) {
    const data = await this.costTypesService.create(dto, user.tenantId);
    return { success: true, data };
  }

  @Post('seed-defaults')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Seed default cost types for tenant' })
  @ApiResponse({
    status: 201,
    description: 'Default cost types created successfully',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            tenantId: 'uuid',
            name: 'Room Amenities',
            code: 'CT-AMEN',
            category: 'MATERIAL',
            description: 'Toiletries and amenities for guest rooms',
            sortOrder: 1,
            isActive: true,
            createdAt: '2026-04-15T00:00:00Z',
            updatedAt: '2026-04-15T00:00:00Z',
          },
        ],
      },
    },
  })
  async seedDefaults(@CurrentUser() user: JwtPayload) {
    const data = await this.costTypesService.seedDefaults(user.tenantId);
    return { success: true, data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update cost type' })
  @ApiResponse({
    status: 200,
    description: 'Cost type updated successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          tenantId: 'uuid',
          name: 'Room Amenities - Updated',
          code: 'CT-AMEN',
          category: 'MATERIAL',
          description: 'Toiletries and amenities for guest rooms',
          sortOrder: 1,
          isActive: true,
          createdAt: '2026-04-15T00:00:00Z',
          updatedAt: '2026-04-15T10:00:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 404, description: 'Cost type not found' })
  @ApiResponse({ status: 409, description: 'Cost type code already exists' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCostTypeDto,
  ) {
    const data = await this.costTypesService.update(id, dto, user.tenantId);
    return { success: true, data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete cost type (soft delete)' })
  @ApiResponse({ status: 204, description: 'Cost type deleted successfully' })
  @ApiResponse({ status: 400, description: 'Cannot delete cost type with active entries' })
  @ApiResponse({ status: 404, description: 'Cost type not found' })
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.costTypesService.remove(id, user.tenantId);
  }
}
