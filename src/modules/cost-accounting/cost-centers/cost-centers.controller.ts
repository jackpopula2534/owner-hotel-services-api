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
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CostCentersService } from './cost-centers.service';
import { CreateCostCenterDto } from './dto/create-cost-center.dto';
import { UpdateCostCenterDto } from './dto/update-cost-center.dto';
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

@ApiTags('Cost Accounting - Cost Centers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('COST_ACCOUNTING_MODULE')
@Controller({ path: 'cost-accounting/cost-centers', version: '1' })
export class CostCentersController {
  constructor(private readonly costCentersService: CostCentersService) {}

  @Get()
  @ApiOperation({ summary: 'Get all cost centers for a property' })
  @ApiResponse({
    status: 200,
    description: 'List of cost centers',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            tenantId: 'uuid',
            propertyId: 'uuid',
            name: 'Rooms',
            code: 'CC-ROOMS',
            type: 'ROOMS',
            description: 'Room operations and housekeeping',
            parentId: null,
            managerId: null,
            sortOrder: 1,
            isActive: true,
            childrenCount: 0,
            createdAt: '2026-04-15T00:00:00Z',
            updatedAt: '2026-04-15T00:00:00Z',
          },
        ],
      },
    },
  })
  async findAll(@CurrentUser() user: JwtPayload, @Body('propertyId') propertyId: string) {
    const data = await this.costCentersService.findAll(user.tenantId, propertyId);
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get cost center by ID with children and parent' })
  @ApiResponse({
    status: 200,
    description: 'Cost center details',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          tenantId: 'uuid',
          propertyId: 'uuid',
          name: 'Rooms',
          code: 'CC-ROOMS',
          type: 'ROOMS',
          description: 'Room operations and housekeeping',
          parentId: null,
          managerId: null,
          sortOrder: 1,
          isActive: true,
          createdAt: '2026-04-15T00:00:00Z',
          updatedAt: '2026-04-15T00:00:00Z',
          parent: null,
          children: [],
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Cost center not found' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.costCentersService.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new cost center' })
  @ApiResponse({
    status: 201,
    description: 'Cost center created successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          tenantId: 'uuid',
          propertyId: 'uuid',
          name: 'Rooms',
          code: 'CC-ROOMS',
          type: 'ROOMS',
          description: 'Room operations and housekeeping',
          parentId: null,
          managerId: null,
          sortOrder: 1,
          isActive: true,
          createdAt: '2026-04-15T00:00:00Z',
          updatedAt: '2026-04-15T00:00:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 409, description: 'Cost center code already exists' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCostCenterDto) {
    const data = await this.costCentersService.create(dto, user.tenantId);
    return { success: true, data };
  }

  @Post('/seed-defaults/:propertyId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Seed default USALI cost centers for a property' })
  @ApiResponse({
    status: 201,
    description: 'Default cost centers created successfully',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            tenantId: 'uuid',
            propertyId: 'uuid',
            name: 'Rooms',
            code: 'CC-ROOMS',
            type: 'ROOMS',
            description: 'Room operations and housekeeping',
            parentId: null,
            managerId: null,
            sortOrder: 1,
            isActive: true,
            createdAt: '2026-04-15T00:00:00Z',
            updatedAt: '2026-04-15T00:00:00Z',
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Property not found' })
  async seedDefaults(@CurrentUser() user: JwtPayload, @Param('propertyId') propertyId: string) {
    const data = await this.costCentersService.seedDefaults(user.tenantId, propertyId);
    return { success: true, data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update cost center' })
  @ApiResponse({
    status: 200,
    description: 'Cost center updated successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          tenantId: 'uuid',
          propertyId: 'uuid',
          name: 'Rooms - Updated',
          code: 'CC-ROOMS',
          type: 'ROOMS',
          description: 'Room operations and housekeeping',
          parentId: null,
          managerId: null,
          sortOrder: 1,
          isActive: true,
          createdAt: '2026-04-15T00:00:00Z',
          updatedAt: '2026-04-15T10:00:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 404, description: 'Cost center not found' })
  @ApiResponse({ status: 409, description: 'Cost center code already exists' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCostCenterDto,
  ) {
    const data = await this.costCentersService.update(id, dto, user.tenantId);
    return { success: true, data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete cost center (soft delete)' })
  @ApiResponse({ status: 204, description: 'Cost center deleted successfully' })
  @ApiResponse({ status: 400, description: 'Cannot delete cost center with active entries' })
  @ApiResponse({ status: 404, description: 'Cost center not found' })
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.costCentersService.remove(id, user.tenantId);
  }
}
