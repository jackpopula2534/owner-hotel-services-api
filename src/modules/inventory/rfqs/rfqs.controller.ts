import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RfqsService } from './rfqs.service';
import {
  CancelRfqDto,
  CreateRfqDto,
  ExtendDeadlineDto,
  QueryRfqDto,
  QuickRfqFromPrDto,
  UpdateRfqDto,
} from './dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Inventory - RFQ')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'rfqs', version: '1' })
export class RfqsController {
  constructor(private readonly rfqsService: RfqsService) {}

  // ─── Static / Collection Routes ────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List RFQs with filters and pagination' })
  @ApiResponse({ status: 200, description: 'RFQs retrieved' })
  async findAll(
    @Query() query: QueryRfqDto,
    @CurrentUser() user: { tenantId: string },
  ): Promise<{ success: boolean; data: unknown; meta: unknown }> {
    const result = await this.rfqsService.findAll(user.tenantId, query);
    return { success: true, data: result.data, meta: result.meta };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a new RFQ (DRAFT or SENT)' })
  @ApiResponse({ status: 201, description: 'RFQ created' })
  async create(
    @Body() dto: CreateRfqDto,
    @CurrentUser() user: { id: string; tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.rfqsService.create(user.tenantId, user.id, dto);
    return { success: true, data };
  }

  @Post('quick-from-pr')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Quick-create and send RFQ from a single PR (used by PR detail modal)',
  })
  @ApiResponse({ status: 201, description: 'RFQ created and sent' })
  async quickFromPr(
    @Body() dto: QuickRfqFromPrDto,
    @CurrentUser() user: { id: string; tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.rfqsService.quickFromPr(user.tenantId, user.id, dto);
    return { success: true, data };
  }

  // ─── Specific :id sub-routes (BEFORE generic :id) ──────────────────

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a DRAFT RFQ to all recipients' })
  @ApiParam({ name: 'id', description: 'RFQ id' })
  async send(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.rfqsService.send(id, user.tenantId);
    return { success: true, data };
  }

  @Post(':id/remind')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send reminder to recipients who have not responded yet',
  })
  @ApiParam({ name: 'id', description: 'RFQ id' })
  async remind(
    @Param('id') id: string,
    @Body('supplierId') supplierId: string | undefined,
    @CurrentUser() user: { tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.rfqsService.remind(id, user.tenantId, supplierId);
    return { success: true, data };
  }

  @Post(':id/resend-invitation')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Regenerate magic-link token and resend the RFQ invitation email. ' +
      'If supplierId is provided, resend to only that supplier; otherwise to all.',
  })
  @ApiParam({ name: 'id', description: 'RFQ id' })
  @ApiResponse({ status: 200, description: 'Invitation(s) resent' })
  @ApiResponse({ status: 400, description: 'RFQ not in a resendable status' })
  async resendInvitation(
    @Param('id') id: string,
    @Body('supplierId') supplierId: string | undefined,
    @CurrentUser() user: { tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.rfqsService.resendInvitation(id, user.tenantId, supplierId);
    return { success: true, data };
  }

  @Patch(':id/extend-deadline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Extend RFQ deadline' })
  @ApiParam({ name: 'id', description: 'RFQ id' })
  async extendDeadline(
    @Param('id') id: string,
    @Body() dto: ExtendDeadlineDto,
    @CurrentUser() user: { tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.rfqsService.extendDeadline(id, user.tenantId, dto);
    return { success: true, data };
  }

  @Post(':id/resolicit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a follow-up RFQ (round N+1) linked back to the original RFQ',
  })
  @ApiParam({ name: 'id', description: 'Parent RFQ id' })
  async resolicit(
    @Param('id') id: string,
    @Body() overrides: Partial<CreateRfqDto>,
    @CurrentUser() user: { id: string; tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.rfqsService.resolicit(id, user.tenantId, user.id, overrides);
    return { success: true, data };
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel RFQ' })
  @ApiParam({ name: 'id', description: 'RFQ id' })
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelRfqDto,
    @CurrentUser() user: { id: string; tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.rfqsService.cancel(id, user.tenantId, user.id, dto);
    return { success: true, data };
  }

  // ─── Generic :id routes (LAST) ─────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get RFQ detail' })
  @ApiParam({ name: 'id', description: 'RFQ id' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.rfqsService.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update RFQ (DRAFT only)' })
  @ApiParam({ name: 'id', description: 'RFQ id' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRfqDto,
    @CurrentUser() user: { tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.rfqsService.update(id, user.tenantId, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel RFQ (alias for /cancel)' })
  @ApiParam({ name: 'id', description: 'RFQ id' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.rfqsService.cancel(id, user.tenantId, user.id, {});
    return { success: true, data };
  }
}
