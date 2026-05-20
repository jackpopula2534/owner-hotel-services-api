import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentAccountsService } from './payment-accounts.service';
import {
  CreatePaymentAccountDto,
  PaymentAccountKind,
  UpdatePaymentAccountDto,
} from './dto/payment-account.dto';

interface JwtUser {
  id: string;
  tenantId?: string;
  propertyId?: string;
}

@ApiTags('Payment Accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payment-accounts')
export class PaymentAccountsController {
  constructor(
    private readonly service: PaymentAccountsService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── List ────────────────────────────────────────────────────────────────
  @Get()
  @ApiOperation({ summary: 'List payment accounts for current property' })
  @ApiQuery({
    name: 'kind',
    required: false,
    enum: ['promptpay', 'bank'],
    description: 'Filter by channel kind',
  })
  @ApiQuery({
    name: 'propertyId',
    required: false,
    description: 'Property ID — defaults to first property of tenant if omitted',
  })
  @ApiResponse({ status: 200 })
  async list(
    @CurrentUser() user: JwtUser,
    @Query('kind') kind?: PaymentAccountKind,
    @Query('propertyId') propertyIdQuery?: string,
  ) {
    const propertyId = await this.resolvePropertyId(user, propertyIdQuery);
    const data = await this.service.list(propertyId, kind);
    return { success: true, data };
  }

  // ─── Get one ─────────────────────────────────────────────────────────────
  @Get(':id')
  @ApiOperation({ summary: 'Get one payment account by id' })
  @ApiResponse({ status: 200 })
  async get(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Query('propertyId') propertyIdQuery?: string,
  ) {
    const propertyId = await this.resolvePropertyId(user, propertyIdQuery);
    const data = await this.service.get(propertyId, id);
    return { success: true, data };
  }

  // ─── Create ──────────────────────────────────────────────────────────────
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a payment account' })
  @ApiResponse({ status: 201 })
  async create(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreatePaymentAccountDto,
    @Query('propertyId') propertyIdQuery?: string,
  ) {
    const propertyId = await this.resolvePropertyId(user, propertyIdQuery);
    const data = await this.service.create(propertyId, dto);
    return { success: true, data };
  }

  // ─── Update ──────────────────────────────────────────────────────────────
  @Patch(':id')
  @ApiOperation({ summary: 'Update a payment account' })
  @ApiResponse({ status: 200 })
  async update(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentAccountDto,
    @Query('propertyId') propertyIdQuery?: string,
  ) {
    const propertyId = await this.resolvePropertyId(user, propertyIdQuery);
    const data = await this.service.update(propertyId, id, dto);
    return { success: true, data };
  }

  // ─── Set default ─────────────────────────────────────────────────────────
  @Patch(':id/set-default')
  @ApiOperation({ summary: 'Mark this account as the default for its kind' })
  @ApiResponse({ status: 200 })
  async setDefault(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Query('propertyId') propertyIdQuery?: string,
  ) {
    const propertyId = await this.resolvePropertyId(user, propertyIdQuery);
    const data = await this.service.setDefault(propertyId, id);
    return { success: true, data };
  }

  // ─── Delete ──────────────────────────────────────────────────────────────
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a payment account' })
  @ApiResponse({ status: 200 })
  async remove(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Query('propertyId') propertyIdQuery?: string,
  ) {
    const propertyId = await this.resolvePropertyId(user, propertyIdQuery);
    await this.service.remove(propertyId, id);
    return { success: true };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────
  /**
   * แก้ปัญหา JWT ไม่มี propertyId: รับ propertyId จาก:
   *   1. Query string ?propertyId=xxx (frontend ส่งมาตาม selectedProperty)
   *   2. user.propertyId (legacy — ถ้า JWT มี)
   *   3. Fallback: property แรกของ tenant
   * ทุก path ตรวจสอบว่า property เป็นของ user.tenantId เพื่อ tenant isolation
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
