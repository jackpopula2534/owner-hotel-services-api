import {
  BadRequestException,
  Body,
  Controller,
  forwardRef,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SupplierPortalService } from './supplier-portal.service';
import { SupplierQuotesService } from '../supplier-quotes/supplier-quotes.service';
import { SubmitQuoteDto } from '../supplier-quotes/dto';

/**
 * Public, unauthenticated endpoints that power the supplier portal
 * (/supplier-portal/quote). Access is gated by a single-use magic-link
 * token emailed to the supplier — NOT by JWT. Keep the surface area tiny.
 */
@ApiTags('Inventory - Supplier Portal (public)')
@Controller({ path: 'supplier-portal', version: '1' })
export class SupplierPortalController {
  private readonly logger = new Logger(SupplierPortalController.name);

  constructor(
    private readonly supplierPortalService: SupplierPortalService,
    // forwardRef matches supplier-portal.module.ts, where SupplierQuotesModule
    // is forward-ref'd to break the Portal ↔ Quotes ↔ Rfqs ↔ Portal cycle.
    @Inject(forwardRef(() => SupplierQuotesService))
    private readonly supplierQuotesService: SupplierQuotesService,
  ) {}

  @Get('session')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Load RFQ context + PR items for a supplier using a magic-link token',
  })
  @ApiQuery({ name: 'token', description: 'Magic link token', required: true })
  @ApiResponse({ status: 200, description: 'Portal session payload' })
  @ApiResponse({ status: 403, description: 'Token invalid / expired / used' })
  async getSession(@Query('token') token: string): Promise<{ success: boolean; data: unknown }> {
    if (!token) {
      throw new BadRequestException('กรุณาระบุ token');
    }
    const data = await this.supplierPortalService.getPortalSession(token);
    return { success: true, data };
  }

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Submit a supplier quote via magic-link token (REQUESTED → RECEIVED)',
  })
  @ApiQuery({ name: 'token', description: 'Magic link token', required: true })
  @ApiResponse({ status: 200, description: 'Quote submitted' })
  @ApiResponse({ status: 400, description: 'Invalid payload' })
  @ApiResponse({ status: 403, description: 'Token invalid / expired / used' })
  async submit(
    @Query('token') token: string,
    @Body() dto: SubmitQuoteDto,
  ): Promise<{ success: boolean; data: { quoteId: string } }> {
    if (!token) {
      throw new BadRequestException('กรุณาระบุ token');
    }

    const ctx = await this.supplierPortalService.verifyToken(token);

    // Persist the supplier's quote. Reuse the authenticated service so
    // totals calculation + RFQ roll-up stay in one place.
    await this.supplierQuotesService.submitQuote(ctx.supplierQuoteId, dto, ctx.tenantId);

    // Burn the token so the same link can't be replayed.
    await this.supplierPortalService.markTokenUsed(ctx.tokenId);

    this.logger.log(
      `Supplier ${ctx.supplierId} submitted quote ${ctx.supplierQuoteId} via portal token`,
    );

    return {
      success: true,
      data: { quoteId: ctx.supplierQuoteId },
    };
  }
}
