import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { Roles, UserRole } from '@/common/decorators/roles.decorator';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { RetailPromotionsService } from './retail-promotions.service';
import {
  CreatePromoCodeDto,
  CreateRetailPromotionDto,
  GeneratePromoCodesDto,
  PreviewPromotionDto,
  RegisterMemberDto,
  UpdatePromoCodeDto,
  UpdateRetailPromotionDto,
} from './dto/retail-promotion.dto';

type AuthedReq = { user: { id: string; tenantId: string } };

/** ตั้งค่าโปร/โค้ดได้เฉพาะผู้จัดการขึ้นไป — แคชเชียร์อ่าน/preview ได้อย่างเดียว */
const PROMO_MANAGERS: UserRole[] = ['tenant_admin', 'admin', 'manager', 'warehouse_manager', 'platform_admin'];

@ApiTags('Inventory - Retail Promotions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/retail/promotions', version: '1' })
export class RetailPromotionsController {
  constructor(private readonly service: RetailPromotionsService) {}

  @Get()
  @ApiOperation({ summary: 'List retail promotions' })
  @ApiResponse({ status: 200, description: 'Promotions retrieved' })
  async list(
    @Query('status') status: string | undefined,
    @Query('search') search: string | undefined,
    @Req() req: AuthedReq,
  ): Promise<{ success: boolean; data: unknown }> {
    return { success: true, data: await this.service.list(req.user.tenantId, { status, search }) };
  }

  // static routes ต้องมาก่อน :id
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check a promo code against a cart + member (no side effects)' })
  @ApiResponse({ status: 200, description: 'Promotion priced' })
  async preview(@Body() dto: PreviewPromotionDto, @Req() req: AuthedReq): Promise<{ success: boolean; data: unknown }> {
    return { success: true, data: await this.service.preview(dto, req.user.tenantId) };
  }

  @Patch('codes/:codeId')
  @Roles(...PROMO_MANAGERS)
  @ApiOperation({ summary: 'Enable / disable a promo code' })
  @ApiResponse({ status: 200, description: 'Code updated' })
  async updateCode(
    @Param('codeId') codeId: string,
    @Body() dto: UpdatePromoCodeDto,
    @Req() req: AuthedReq,
  ): Promise<{ success: boolean; data: unknown }> {
    return { success: true, data: await this.service.updateCode(codeId, dto, req.user.tenantId) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Promotion detail with codes, gifts and usage stats' })
  @ApiResponse({ status: 200, description: 'Promotion retrieved' })
  async findOne(@Param('id') id: string, @Req() req: AuthedReq): Promise<{ success: boolean; data: unknown }> {
    return { success: true, data: await this.service.findOne(id, req.user.tenantId) };
  }

  @Post()
  @Roles(...PROMO_MANAGERS)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a retail promotion' })
  @ApiResponse({ status: 201, description: 'Promotion created' })
  async create(
    @Body() dto: CreateRetailPromotionDto,
    @Req() req: AuthedReq,
  ): Promise<{ success: boolean; data: unknown }> {
    return { success: true, data: await this.service.create(dto, req.user.tenantId, req.user.id) };
  }

  @Patch(':id')
  @Roles(...PROMO_MANAGERS)
  @ApiOperation({ summary: 'Update a retail promotion (gifts = replace-all)' })
  @ApiResponse({ status: 200, description: 'Promotion updated' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRetailPromotionDto,
    @Req() req: AuthedReq,
  ): Promise<{ success: boolean; data: unknown }> {
    return { success: true, data: await this.service.update(id, dto, req.user.tenantId) };
  }

  @Post(':id/codes')
  @Roles(...PROMO_MANAGERS)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a promo code to a promotion' })
  @ApiResponse({ status: 201, description: 'Code created' })
  async addCode(
    @Param('id') id: string,
    @Body() dto: CreatePromoCodeDto,
    @Req() req: AuthedReq,
  ): Promise<{ success: boolean; data: unknown }> {
    return { success: true, data: await this.service.addCode(id, dto, req.user.tenantId) };
  }

  @Post(':id/codes/generate')
  @Roles(...PROMO_MANAGERS)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate a batch of single-use codes' })
  @ApiResponse({ status: 201, description: 'Codes generated' })
  async generateCodes(
    @Param('id') id: string,
    @Body() dto: GeneratePromoCodesDto,
    @Req() req: AuthedReq,
  ): Promise<{ success: boolean; data: unknown }> {
    return { success: true, data: await this.service.generateCodes(id, dto, req.user.tenantId) };
  }
}

/** สมาชิกที่ POS = Guest ของระบบหลัก (ค้น/สมัคร) */
@ApiTags('Inventory - Retail Members')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/retail/members', version: '1' })
export class RetailMembersController {
  constructor(private readonly service: RetailPromotionsService) {}

  @Get()
  @ApiOperation({ summary: 'Search members (guests) by phone / name / email' })
  @ApiResponse({ status: 200, description: 'Members retrieved' })
  async search(@Query('search') search: string | undefined, @Req() req: AuthedReq): Promise<{ success: boolean; data: unknown }> {
    return { success: true, data: await this.service.searchMembers(req.user.tenantId, search ?? '') };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a member at the POS (creates a Guest with PDPA consent)' })
  @ApiResponse({ status: 201, description: 'Member registered' })
  async register(
    @Body() dto: RegisterMemberDto,
    @Ip() ip: string,
    @Req() req: AuthedReq,
  ): Promise<{ success: boolean; data: unknown }> {
    return { success: true, data: await this.service.registerMember(req.user.tenantId, dto, ip) };
  }

  @Get(':guestId')
  @ApiOperation({ summary: 'Member with tier + segment' })
  @ApiResponse({ status: 200, description: 'Member retrieved' })
  async findOne(@Param('guestId') guestId: string, @Req() req: AuthedReq): Promise<{ success: boolean; data: unknown }> {
    return { success: true, data: await this.service.getMember(req.user.tenantId, guestId) };
  }
}
