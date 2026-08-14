import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AllowSystems } from '@/common/decorators/allow-systems.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentSettingsService } from './payment-settings.service';
import { SavePaymentSettingsDto } from './dto/save-payment-settings.dto';

interface JwtUser {
  id: string;
  tenantId?: string;
  propertyId?: string;
}

@ApiTags('Payment Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payment-settings')
export class PaymentSettingsController {
  constructor(
    private readonly paymentSettingsService: PaymentSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  // The till has to know which channels the property actually accepts before it
  // can offer a QR — PaymentModal opens this on every bill. Reading is all the
  // POS needs; saving the merchant's PromptPay identity stays closed to it.
  @AllowSystems('pos')
  @Get()
  @ApiOperation({ summary: 'Get payment settings for current property' })
  @ApiQuery({ name: 'propertyId', required: false })
  @ApiResponse({ status: 200, description: 'Payment settings' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 404, description: 'Settings not configured yet' })
  async get(@CurrentUser() user: JwtUser, @Query('propertyId') propertyIdQuery?: string) {
    const propertyId = await this.resolvePropertyId(user, propertyIdQuery);
    const settings = await this.paymentSettingsService.findByPropertyId(propertyId);
    return { success: true, data: settings };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save (upsert) payment settings for current property' })
  @ApiQuery({ name: 'propertyId', required: false })
  @ApiResponse({ status: 200, description: 'Payment settings saved' })
  async save(
    @CurrentUser() user: JwtUser,
    @Body() dto: SavePaymentSettingsDto,
    @Query('propertyId') propertyIdQuery?: string,
  ) {
    const propertyId = await this.resolvePropertyId(user, propertyIdQuery);
    const { data, isNew } = await this.paymentSettingsService.upsert(propertyId, dto);
    return { success: true, data, isNew };
  }

  @Get('status')
  @ApiOperation({ summary: 'Check if payment setup is complete (for onboarding checklist)' })
  @ApiQuery({ name: 'propertyId', required: false })
  @ApiResponse({ status: 200, description: 'Setup status' })
  async getStatus(@CurrentUser() user: JwtUser, @Query('propertyId') propertyIdQuery?: string) {
    try {
      const propertyId = await this.resolvePropertyId(user, propertyIdQuery);
      const isComplete = await this.paymentSettingsService.isSetupComplete(propertyId);
      return { success: true, data: { isComplete } };
    } catch {
      return { success: true, data: { isComplete: false } };
    }
  }

  /**
   * แก้ปัญหา JWT ไม่มี propertyId: รับ propertyId จาก:
   *   1. Query string ?propertyId=xxx (frontend ส่งมาตาม selectedProperty)
   *   2. user.propertyId (legacy — ถ้า JWT มี)
   *   3. Fallback: property แรกของ tenant
   * ทุก path ตรวจสอบว่า property เป็นของ user.tenantId
   */
  private async resolvePropertyId(user: JwtUser, propertyIdQuery?: string): Promise<string> {
    if (!user.tenantId) {
      throw new UnauthorizedException('Tenant not found in token');
    }
    if (propertyIdQuery) {
      const prop = await this.prisma.property.findFirst({
        where: { id: propertyIdQuery, tenantId: user.tenantId },
        select: { id: true },
      });
      if (!prop) {
        throw new NotFoundException('Property not found or not in tenant');
      }
      return prop.id;
    }
    if (user.propertyId) return user.propertyId;
    const fallback = await this.prisma.property.findFirst({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!fallback) {
      throw new NotFoundException('No property found for current tenant');
    }
    return fallback.id;
  }
}
