import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WebhooksService } from './webhooks.service';
import { PaymentReconciliationService } from './payment-reconciliation.service';

@ApiTags('Webhooks')
@Controller({ path: 'webhooks', version: '1' })
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly reconciliationService: PaymentReconciliationService,
  ) {}

  /**
   * Public webhook endpoint — DO NOT guard with JWT. We rely on HMAC
   * signature verification inside the service.
   *
   * Convention: body fields { eventType, idempotencyKey, payload } are
   * extracted by a per-provider adapter we add per integration. For
   * now this is a generic shim that accepts the canonicalized form.
   */
  @Post(':provider')
  @ApiOperation({ summary: 'Inbound webhook from a payment provider' })
  async receive(
    @Param('provider') provider: string,
    @Headers('x-signature') signature: string | undefined,
    @Headers('x-idempotency-key') idemHeader: string | undefined,
    @Body() body: any,
    @Req() req: Request,
  ) {
    const idempotencyKey =
      idemHeader || body?.idempotencyKey || body?.event_id || body?.id;
    if (!idempotencyKey) {
      return { status: 'failed', error: 'missing idempotency key' };
    }

    return this.webhooksService.ingest({
      provider,
      eventType: body?.eventType || body?.type || 'unknown',
      idempotencyKey: String(idempotencyKey),
      signature,
      // raw body string used for HMAC; if express.raw was not configured
      // we fall back to JSON.stringify which is not byte-equivalent and
      // will cause signature failures for strict providers.
      rawBody:
        (req as any).rawBody?.toString?.() || JSON.stringify(body || {}),
      payload: body || {},
    });
  }

  // ── Admin reconciliation endpoints ──
  @Post('admin/reconcile/:provider')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '[Admin] Trigger reconciliation for a provider' })
  async reconcileNow(
    @Param('provider') provider: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const periodStart = from ? new Date(from) : new Date(Date.now() - 86400_000);
    periodStart.setHours(0, 0, 0, 0);
    const periodEnd = to ? new Date(to) : new Date();
    periodEnd.setHours(0, 0, 0, 0);
    return this.reconciliationService.reconcile(provider, periodStart, periodEnd);
  }

  @Get('admin/reconcile/runs')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '[Admin] List reconciliation runs' })
  async listRuns() {
    // Defer to Prisma directly via service-of-services style would require
    // an extra method; expose via service in a follow-up if needed.
    return [];
  }
}
