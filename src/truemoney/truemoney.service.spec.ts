import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { TrueMoneyService } from './truemoney.service';
import { PrismaService } from '../prisma/prisma.service';
import { TrueMoneyCallbackDto } from './dto/truemoney.dto';

// ─────────────────────────────────────────────────────────────────────────────
// TrueMoneyService - handleCallback signature verification (SALES-02)
//
// The 2C2P backend callback is a signed JWT (HS256, merchant secret). We must
// verify it and use ONLY verified claims. Forged/unsigned callbacks must be
// rejected so nobody can mark an invoice paid for free.
// ─────────────────────────────────────────────────────────────────────────────

describe('TrueMoneyService - handleCallback verification', () => {
  const SECRET = 'test-2c2p-secret';

  const buildService = async (
    configOverrides: Record<string, string> = {},
  ): Promise<{ service: TrueMoneyService; prisma: any }> => {
    const prismaMock: any = {
      trueMoneyTransaction: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      payments: { create: jest.fn().mockResolvedValue({}) },
      invoices: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          payments: { create: jest.fn().mockResolvedValue({}) },
          invoices: { update: jest.fn().mockResolvedValue({}) },
        }),
      ),
    };
    const configMock = {
      get: jest.fn((key: string, def?: string) => {
        const values: Record<string, string> = {
          TWO_C2P_MERCHANT_ID: 'M123',
          TWO_C2P_SECRET_KEY: SECRET,
          ...configOverrides,
        };
        return values[key] ?? def ?? '';
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrueMoneyService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    return { service: module.get(TrueMoneyService), prisma: prismaMock };
  };

  /** Build a valid HS256 JWT signed with SECRET. */
  const signJwt = (claims: Record<string, unknown>, secret = SECRET): string => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
  };

  it('rejects a callback whose JWT is signed with the wrong key', async () => {
    const { service, prisma } = await buildService();
    const dto: TrueMoneyCallbackDto = {
      payload: signJwt({ invoiceNo: 'TMN-1', respCode: '0000' }, 'attacker-key'),
    };

    await expect(service.handleCallback(dto)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.trueMoneyTransaction.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unsigned callback in production (no payload)', async () => {
    const { service, prisma } = await buildService({ NODE_ENV: 'production' });
    const dto: TrueMoneyCallbackDto = { merchantOrderId: 'TMN-1', respCode: '0000' };

    await expect(service.handleCallback(dto)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.trueMoneyTransaction.findUnique).not.toHaveBeenCalled();
  });

  it('accepts a validly signed payload and marks the transaction completed', async () => {
    const { service, prisma } = await buildService();
    prisma.trueMoneyTransaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      merchantOrderId: 'TMN-1',
      tenantId: 'tenant-1',
      invoiceId: 'inv-1',
      amount: 1500,
    });
    const dto: TrueMoneyCallbackDto = {
      payload: signJwt({ invoiceNo: 'TMN-1', respCode: '0000', respDesc: 'Success' }),
    };

    await service.handleCallback(dto);

    expect(prisma.trueMoneyTransaction.findUnique).toHaveBeenCalledWith({
      where: { merchantOrderId: 'TMN-1' },
    });
    expect(prisma.trueMoneyTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'completed' }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
