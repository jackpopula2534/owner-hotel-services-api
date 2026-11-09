import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StripeService } from './stripe.service';
import { PrismaService } from '../prisma/prisma.service';

// ─────────────────────────────────────────────────────────────────────────────
// StripeService - webhook idempotency (SALES-03)
//
// Stripe delivers webhooks at-least-once and retries on any non-2xx. A redelivered
// payment_intent.succeeded must NOT create a second payment row or re-mark the
// invoice paid.
// ─────────────────────────────────────────────────────────────────────────────

describe('StripeService - onPaymentIntentSucceeded idempotency', () => {
  const buildService = async (): Promise<{ service: StripeService; prisma: any }> => {
    const txClient = {
      payments: { findFirst: jest.fn(), create: jest.fn().mockResolvedValue({}) },
      invoices: { update: jest.fn().mockResolvedValue({}) },
    };
    const prismaMock: any = {
      stripePaymentIntent: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      // mirror tx client so assertions can read the same jest.fns
      payments: txClient.payments,
      invoices: txClient.invoices,
      $transaction: jest.fn(async (fn: any) => fn(txClient)),
    };
    const configMock = { get: jest.fn((_k: string, def?: string) => def ?? '') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    return { service: module.get(StripeService), prisma: prismaMock };
  };

  // latest_charge left undefined so the handler never touches the Stripe client.
  const pi = { id: 'pi_123', status: 'succeeded', payment_method: 'pm_1' };

  it('records the payment once on first delivery', async () => {
    const { service, prisma } = await buildService();
    prisma.stripePaymentIntent.findUnique.mockResolvedValue({
      stripePaymentIntentId: 'pi_123',
      invoiceId: 'inv-1',
      tenantId: 'tenant-1',
      amount: 500,
    });
    prisma.payments.findFirst.mockResolvedValue(null); // no prior payment

    await (service as any).onPaymentIntentSucceeded(pi);

    expect(prisma.payments.create).toHaveBeenCalledTimes(1);
    expect(prisma.invoices.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'paid' } }),
    );
  });

  it('does not create a duplicate payment on webhook redelivery', async () => {
    const { service, prisma } = await buildService();
    prisma.stripePaymentIntent.findUnique.mockResolvedValue({
      stripePaymentIntentId: 'pi_123',
      invoiceId: 'inv-1',
      tenantId: 'tenant-1',
      amount: 500,
    });
    prisma.payments.findFirst.mockResolvedValue({ id: 'pay-existing' }); // already recorded

    await (service as any).onPaymentIntentSucceeded(pi);

    expect(prisma.payments.create).not.toHaveBeenCalled();
    expect(prisma.invoices.update).not.toHaveBeenCalled();
  });
});
