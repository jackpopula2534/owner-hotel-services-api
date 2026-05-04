import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { AddonEntity, AddonService, AddonStatus, PaginatedAddons } from './addon.service';
import { CreateAddonDto } from './dto/create-addon.dto';
import { UpdateAddonDto } from './dto/update-addon.dto';
import { QueryAddonDto } from './dto/query-addon.dto';

@ApiTags('Add-ons')
@ApiBearerAuth()
@Controller('addons')
export class AddonController {
  constructor(private readonly addonService: AddonService) {}

  // -------------------------------------------------------------------------
  // Public catalog (used by Subscription / pricing pages)
  // -------------------------------------------------------------------------

  @Public()
  @ApiOperation({ summary: 'Public list of active add-ons (for subscription page)' })
  @ApiResponse({ status: 200, description: 'List of active add-ons' })
  @Get('public')
  async listPublic(): Promise<{ success: true; data: AddonEntity[] }> {
    const data = await this.addonService.listActive();
    return { success: true, data };
  }

  // -------------------------------------------------------------------------
  // Tenant: get active add-ons for current subscription
  // -------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get active add-ons for the current tenant' })
  @ApiResponse({
    status: 200,
    description: 'List of active module add-ons for the tenant',
    schema: {
      example: {
        success: true,
        data: [
          {
            code: 'HR_MODULE',
            name: 'HR Module',
            isActive: true,
            expiresAt: null,
          },
        ],
      },
    },
  })
  @Get('status')
  async getAddonStatus(
    @Request() req: { user: { tenantId: string } },
  ): Promise<{ success: true; data: AddonStatus[] }> {
    const addons = await this.addonService.getActiveAddons(req.user.tenantId);
    return { success: true, data: addons };
  }

  // -------------------------------------------------------------------------
  // Admin CRUD
  // -------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin')
  @ApiOperation({ summary: '[Admin] List all add-ons with filter & pagination' })
  @ApiResponse({ status: 200, description: 'Paginated add-ons' })
  @Get()
  async list(
    @Query() query: QueryAddonDto,
  ): Promise<{ success: true; data: AddonEntity[]; meta: PaginatedAddons['meta'] }> {
    const result = await this.addonService.list(query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin')
  @ApiOperation({ summary: '[Admin] Get add-on by id' })
  @ApiResponse({ status: 200, description: 'Add-on detail' })
  @ApiResponse({ status: 404, description: 'Add-on not found' })
  @Get(':id')
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ success: true; data: AddonEntity }> {
    const data = await this.addonService.findOne(id);
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin')
  @ApiOperation({ summary: '[Admin] Create new add-on' })
  @ApiResponse({ status: 201, description: 'Add-on created' })
  @ApiResponse({ status: 409, description: 'Code already exists' })
  @Post()
  async create(@Body() dto: CreateAddonDto): Promise<{ success: true; data: AddonEntity }> {
    const data = await this.addonService.create(dto);
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin')
  @ApiOperation({ summary: '[Admin] Update add-on (full)' })
  @ApiResponse({ status: 200, description: 'Add-on updated' })
  @Put(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAddonDto,
  ): Promise<{ success: true; data: AddonEntity }> {
    const data = await this.addonService.update(id, dto);
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin')
  @ApiOperation({ summary: '[Admin] Partial update add-on' })
  @ApiResponse({ status: 200, description: 'Add-on updated' })
  @Patch(':id')
  async patch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAddonDto,
  ): Promise<{ success: true; data: AddonEntity }> {
    const data = await this.addonService.update(id, dto);
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin')
  @ApiOperation({ summary: '[Admin] Toggle add-on active flag' })
  @ApiResponse({ status: 200, description: 'Toggled' })
  @Patch(':id/toggle-active')
  async toggleActive(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ success: true; data: AddonEntity }> {
    const data = await this.addonService.toggleActive(id);
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin')
  @ApiOperation({ summary: '[Admin] Delete add-on' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.addonService.remove(id);
  }
}
