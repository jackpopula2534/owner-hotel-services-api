import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ItemSuppliersService } from './item-suppliers.service';
import { CreateItemSupplierDto } from './dto/create-item-supplier.dto';
import { UpdateItemSupplierDto } from './dto/update-item-supplier.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';

@ApiTags('Inventory - Item Suppliers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/item-suppliers', version: '1' })
export class ItemSuppliersController {
  constructor(private readonly itemSuppliersService: ItemSuppliersService) {}

  @Get('by-item/:itemId')
  @ApiOperation({ summary: 'Get suppliers for an item' })
  @ApiResponse({ status: 200, description: 'Item suppliers retrieved' })
  async findByItem(
    @Param('itemId') itemId: string,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.itemSuppliersService.findByItem(itemId, req.user.tenantId);
    return { success: true, data };
  }

  @Get('by-supplier/:supplierId')
  @ApiOperation({ summary: 'Get items from a supplier' })
  @ApiResponse({ status: 200, description: 'Supplier items retrieved' })
  async findBySupplier(
    @Param('supplierId') supplierId: string,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.itemSuppliersService.findBySupplier(supplierId, req.user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Link supplier to item' })
  @ApiResponse({ status: 201, description: 'Item-supplier link created' })
  @ApiResponse({ status: 400, description: 'Invalid item or supplier' })
  async create(
    @Body() dto: CreateItemSupplierDto,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.itemSuppliersService.create(dto, req.user.tenantId);
    return { success: true, data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update item-supplier link' })
  @ApiResponse({ status: 200, description: 'Item-supplier link updated' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateItemSupplierDto,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.itemSuppliersService.update(id, dto, req.user.tenantId);
    return { success: true, data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove item-supplier link' })
  @ApiResponse({ status: 204, description: 'Item-supplier link deleted' })
  async remove(@Param('id') id: string, @Req() req: { user: { tenantId: string } }): Promise<void> {
    return this.itemSuppliersService.remove(id, req.user.tenantId);
  }

  @Post(':itemId/:supplierId/set-preferred')
  @ApiOperation({ summary: 'Set preferred supplier for item' })
  @ApiResponse({ status: 200, description: 'Preferred supplier set' })
  async setPreferred(
    @Param('itemId') itemId: string,
    @Param('supplierId') supplierId: string,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.itemSuppliersService.setPreferred(
      itemId,
      supplierId,
      req.user.tenantId,
    );
    return { success: true, data };
  }
}
