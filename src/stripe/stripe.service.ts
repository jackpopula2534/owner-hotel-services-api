import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import Stripe from 'stripe';
import { CreatePaymentIntentDto, CreatePaymentIntentResponseDto } from './dto/stripe.dto';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: any;
  private readonly webhookSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY', '');
    if (!secretKey) {
      this.logger.warn('STRIPE_SECRET_KEY not configured — Stripe payments disabled');
      this.stripe = null;
    } else {
      this.stripe = new Stripe(secretKey, { apiVersion: '2026-04-22.dahlia' as any });
    }
    this.webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET', '');
  }

  private assertStripeEnabled(): void {
    if (!this.stripe) {
      throw new BadRequestException('Stripe payments are not configured on this server');
    }
  }

  // ─── Get or create Stripe Customer ────────────────────────────────────────
  async getOrCreateCustomer(tenantId: string): Promise<string> {
    this.assertStripeEnabled();
    const existing = await this.prisma.stripeCustomer.findUnique({
      where: { tenantId },
    });
    if (existing) return existing.stripeCustomerId;

    const tenant = await this.prisma.tenants.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantId} not found`);

    const customer = await this.stripe.customers.create({
      email: tenant.email ?? undefined,
      name: tenant.name ?? undefined,
      metadata: { tenantId },
    });

    await this.prisma.stripeCustomer.create({
      data: {
        tenantId,
        stripeCustomerId: customer.id,
        email: tenant.email ?? null,
        name: tenant.name ?? null,
      },
    });

    this.logger.log(`Created Stripe customer ${customer.id} for tenant ${tenantId}`);
    return customer.id;
  }

  // ─── Create PaymentIntent ─────────────────────────────────────────────────
  async createPaymentIntent(
    tenantId: string,
    dto: CreatePaymentIntentDto,
  ): Promise<CreatePaymentIntentResponseDto> {
    this.assertStripeEnabled();
    const invoice = await this.prisma.invoices.findFirst({
      where: { id: dto.invoiceId, tenant_id: tenantId },
    });
    if (!invoice) throw new NotFoundException(`Invoice ${dto.invoiceId} not found`);

    if (invoice.status === 'paid') {
      throw new BadRequestException('Invoice is already paid');
    }

    const stripeCustomerId = await this.getOrCreateCustomer(tenantId);
    const currency = (dto.currency ?? 'thb').toLowerCase();

    // Stripe ใช้ smallest currency unit (สตางค์) → คูณ 100
    const amountInSatang = Math.round(dto.amount * 100);

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: amountInSatang,
      currency,
      customer: stripeCustomerId,
      metadata: {
        tenantId,
        invoiceId: dto.invoiceId,
        invoiceNo: invoice.invoice_no,
      },
      automatic_payment_methods: { enabled: true },
    });

    await this.prisma.stripePaymentIntent.create({
      data: {
        tenantId,
        invoiceId: dto.invoiceId,
        stripeCustomerId,
        stripePaymentIntentId: paymentIntent.id,
        stripeClientSecret: paymentIntent.client_secret ?? '',
        amount: dto.amount,
        currency,
        status: paymentIntent.status,
      },
    });

    this.logger.log(`Created PaymentIntent ${paymentIntent.id} for invoice ${dto.invoiceId}`);

    return {
      clientSecret: paymentIntent.client_secret ?? '',
      paymentIntentId: paymentIntent.id,
      amount: dto.amount,
      currency,
    };
  }

  // ─── Handle Stripe Webhook ────────────────────────────────────────────────
  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    this.assertStripeEnabled();
    let event: any;

    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (err) {
      this.logger.error(`Stripe webhook signature verification failed: ${err.message}`);
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }

    this.logger.log(`Received Stripe webhook: ${event.type}`);

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.onPaymentIntentSucceeded(event.data.object as any);
        break;
      case 'payment_intent.payment_failed':
        await this.onPaymentIntentFailed(event.data.object as any);
        break;
      default:
        this.logger.log(`Unhandled Stripe event type: ${event.type}`);
    }
  }

  // ─── Get payment intent status ────────────────────────────────────────────
  async getPaymentIntentStatus(tenantId: string, paymentIntentId: string) {
    this.assertStripeEnabled();
    const record = await this.prisma.stripePaymentIntent.findFirst({
      where: { stripePaymentIntentId: paymentIntentId, tenantId },
    });
    if (!record) throw new NotFoundException('PaymentIntent not found');

    // Sync สถานะจาก Stripe
    const pi = await this.stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== record.status) {
      await this.prisma.stripePaymentIntent.update({
        where: { stripePaymentIntentId: paymentIntentId },
        data: { status: pi.status },
      });
    }

    return { ...record, status: pi.status };
  }

  // ─── Private handlers ─────────────────────────────────────────────────────
  private async onPaymentIntentSucceeded(pi: any): Promise<void> {
    const record = await this.prisma.stripePaymentIntent.findUnique({
      where: { stripePaymentIntentId: pi.id },
    });
    if (!record) {
      this.logger.warn(`No local record for PaymentIntent ${pi.id}`);
      return;
    }

    // Update local record
    await this.prisma.stripePaymentIntent.update({
      where: { stripePaymentIntentId: pi.id },
      data: {
        status: pi.status,
        paymentMethodId: typeof pi.payment_method === 'string' ? pi.payment_method : null,
        receiptUrl: pi.latest_charge
          ? (await this.stripe.charges.retrieve(pi.latest_charge as string)).receipt_url
          : null,
      },
    });

    if (!record.invoiceId) return;

    // สร้าง payment record + update invoice status
    // SALES-03: Stripe retries webhooks (at-least-once delivery). Guard against
    // creating a duplicate payment / re-marking the invoice paid on redelivery.
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.payments.findFirst({
        where: { invoice_id: record.invoiceId!, method: 'stripe', status: 'approved' },
        select: { id: true },
      });
      if (existing) {
        this.logger.warn(
          `Duplicate Stripe webhook for invoice ${record.invoiceId} — payment already recorded (${existing.id}), skipping`,
        );
        return;
      }

      const paymentNo = `STR-${Date.now()}`;
      await tx.payments.create({
        data: {
          invoice_id: record.invoiceId!,
          tenant_id: record.tenantId,
          method: 'stripe',
          amount: record.amount,
          status: 'approved',
          approved_at: new Date(),
          payment_no: paymentNo,
        },
      });

      await tx.invoices.update({
        where: { id: record.invoiceId! },
        data: { status: 'paid' },
      });
    });

    this.logger.log(`PaymentIntent ${pi.id} succeeded → invoice ${record.invoiceId} paid`);
  }

  private async onPaymentIntentFailed(pi: any): Promise<void> {
    await this.prisma.stripePaymentIntent.updateMany({
      where: { stripePaymentIntentId: pi.id },
      data: { status: pi.status },
    });
    this.logger.warn(`PaymentIntent ${pi.id} failed`);
  }
}
