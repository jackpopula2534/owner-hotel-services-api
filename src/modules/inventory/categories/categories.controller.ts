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
import { CategoriesService, CategoryWithChildren } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
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

@ApiTags('Inventory - Categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/categories', version: '1' })
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all active categories in tree structure (max 3 levels)' })
  @ApiResponse({
    status: 200,
    description: 'List of categories with tree structure',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            tenantId: 'uuid',
            name: 'Raw Materials',
            code: 'CAT-RM-001',
            description: 'All raw materials',
            parentId: null,
            sortOrder: 1,
            isActive: true,
            children: [
              {
                id: 'uuid',
                name: 'Vegetables',
                code: 'CAT-VEG-001',
                parentId: 'uuid',
                children: [],
              },
            ],
            createdAt: '2026-04-14T00:00:00Z',
            updatedAt: '2026-04-14T00:00:00Z',
          },
        ],
      },
    },
  })
  async findAll(
    @CurrentUser() user: JwtPayload,
  ): Promise<{ success: boolean; data: CategoryWithChildren[] }> {
    const data = await this.categoriesService.findAll(user.tenantId);
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get category by ID with children and parent' })
  @ApiResponse({
    status: 200,
    description: 'Category details',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          tenantId: 'uuid',
          name: 'Raw Materials',
          code: 'CAT-RM-001',
          description: 'All raw materials',
          parentId: null,
          sortOrder: 1,
          isActive: true,
          parent: null,
          children: [
            {
              id: 'uuid',
              name: 'Vegetables',
              code: 'CAT-VEG-001',
            },
          ],
          createdAt: '2026-04-14T00:00:00Z',
          updatedAt: '2026-04-14T00:00:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.categoriesService.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new category' })
  @ApiResponse({
    status: 201,
    description: 'Category created successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          tenantId: 'uuid',
          name: 'Raw Materials',
          code: 'CAT-RM-001',
          description: 'All raw materials',
          parentId: null,
          sortOrder: 0,
          isActive: true,
          createdAt: '2026-04-14T00:00:00Z',
          updatedAt: '2026-04-14T00:00:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input or invalid parentId' })
  @ApiResponse({ status: 409, description: 'Category code already exists' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCategoryDto) {
    const data = await this.categoriesService.create(dto, user.tenantId);
    return { success: true, data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update category' })
  @ApiResponse({
    status: 200,
    description: 'Category updated successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          tenantId: 'uuid',
          name: 'Updated Materials',
          code: 'CAT-RM-001',
          description: 'Updated description',
          parentId: null,
          sortOrder: 1,
          isActive: true,
          createdAt: '2026-04-14T00:00:00Z',
          updatedAt: '2026-04-14T00:00:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input or circular parent reference' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({ status: 409, description: 'Category code already exists' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    const data = await this.categoriesService.update(id, dto, user.tenantId);
    return { success: true, data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete category (only if no items or subcategories assigned)' })
  @ApiResponse({ status: 204, description: 'Category deleted successfully' })
  @ApiResponse({ status: 400, description: 'Category has items or subcategories assigned' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.categoriesService.remove(id, user.tenantId);
  }
}
