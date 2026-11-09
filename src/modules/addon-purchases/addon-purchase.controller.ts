import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SkipSubscriptionCheck } from '../../common/decorators/skip-subscription-check.decorator';
import {
  AddonPurchaseService,
  AddonPurchaseQr,
  AddonPurchaseSummary,
  AddonPurchaseView,
} from './addon-purchase.service';
import { CreateAddonPurchaseDto } from './dto/create-addon-purchase.dto';
import { ActivateBillLaterDto } from './dto/activate-bill-later.dto';
import { AddonBillLaterService, BillLaterPreview } from './addon-bill-later.service';

/** บทบาทที่ซื้อ add-on ได้ — ตรงกับบทบาทที่ส่งสลิปผ่าน POST /payments ได้ */
export const ADDON_PURCHASE_ROLES = ['admin', 'tenant_admin', 'manager'] as const;

interface TenantRequest {
  user?: { id?: string; tenantId?: string };
}

/** /api/v1/addon-purchases — tenant ซื้อ add-on รายเดือนด้วยตัวเอง (คิดเต็มเดือน) */
@ApiTags('Add-on Purchases')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'addon-purchases', version: '1' })
@SkipSubscriptionCheck()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AddonPurchaseController {
  constructor(
    private readonly service: AddonPurchaseService,
    private readonly billLater: AddonBillLaterService,
  ) {}

  @Get('preview')
  @Roles(...ADDON_PURCHASE_ROLES)
  @ApiOperation({
    summary: 'วิธีซื้อที่ใช้ได้: เก็บรอบบิลถัดไป (พร้อมสรุปบิล) หรือชำระทันที',
  })
  @ApiQuery({ name: 'addonCode', example: 'CAMP_3D_MAP' })
  preview(
    @Request() req: TenantRequest,
    @Query('addonCode') addonCode?: string,
  ): Promise<BillLaterPreview> {
    return this.billLater.preview(tenantOf(req), codeOf(addonCode));
  }

  @Post('activate')
  @Roles(...ADDON_PURCHASE_ROLES)
  @ApiOperation({ summary: 'เปิดใช้ทันที เก็บเงินในรอบบิลถัดไป (ต้องยอมรับเงื่อนไข)' })
  @ApiResponse({ status: 201, description: 'สถานะ add-on หลังเปิด' })
  @ApiResponse({ status: 409, description: 'ไม่เข้าเงื่อนไข — ให้ชำระทันทีแทน' })
  activate(
    @Request() req: TenantRequest,
    @Body() dto: ActivateBillLaterDto,
  ): Promise<BillLaterPreview> {
    return this.billLater.activate(tenantOf(req), req.user?.id ?? null, dto.addonCode);
  }

  @Post('cancel')
  @Roles(...ADDON_PURCHASE_ROLES)
  @ApiOperation({ summary: 'ยกเลิก add-on ที่เก็บรอบบิลถัดไป — มีผลเมื่อครบสัญญาขั้นต่ำ' })
  cancel(
    @Request() req: TenantRequest,
    @Body() dto: CreateAddonPurchaseDto,
  ): Promise<BillLaterPreview> {
    return this.billLater.cancel(tenantOf(req), dto.addonCode);
  }

  @Post(':id/promptpay')
  @Roles(...ADDON_PURCHASE_ROLES)
  @ApiOperation({
    summary:
      'QR PromptPay ของใบแจ้งหนี้ซื้อ add-on (ยอดจากเซิร์ฟเวอร์) — จ่ายแล้วเปิดสิทธิ์อัตโนมัติ',
  })
  promptPay(
    @Request() req: TenantRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AddonPurchaseQr> {
    return this.service.createPromptPayQr(tenantOf(req), id);
  }

  @Post()
  @Roles(...ADDON_PURCHASE_ROLES)
  @ApiOperation({ summary: 'ออกใบแจ้งหนี้ซื้อ add-on 1 เดือน (ใช้ใบเดิมถ้ายังรอชำระอยู่)' })
  @ApiResponse({ status: 201, description: 'ใบแจ้งหนี้ + สถานะการซื้อ' })
  @ApiResponse({ status: 409, description: 'แพ็กเกจรวม add-on นี้อยู่แล้ว' })
  create(
    @Request() req: TenantRequest,
    @Body() dto: CreateAddonPurchaseDto,
  ): Promise<AddonPurchaseView> {
    return this.service.createPurchase(tenantOf(req), req.user?.id ?? null, dto.addonCode);
  }

  @Get('current')
  @Roles(...ADDON_PURCHASE_ROLES)
  @ApiOperation({ summary: 'ใบที่รอชำระ + วันหมดอายุของช่วงที่จ่ายแล้ว' })
  @ApiQuery({ name: 'addonCode', example: 'CAMP_3D_MAP' })
  current(
    @Request() req: TenantRequest,
    @Query('addonCode') addonCode?: string,
  ): Promise<AddonPurchaseSummary> {
    return this.service.getSummary(tenantOf(req), codeOf(addonCode));
  }
}

function tenantOf(req: TenantRequest): string {
  const tenantId = req.user?.tenantId;
  if (!tenantId) throw new BadRequestException('ต้องเข้าสู่ระบบด้วยบัญชีของกิจการ');
  return tenantId;
}

function codeOf(addonCode: string | undefined): string {
  if (!addonCode || !/^[A-Z0-9_]{1,80}$/.test(addonCode))
    throw new BadRequestException('addonCode ไม่ถูกต้อง');
  return addonCode;
}
