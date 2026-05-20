import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PromptPayService } from './promptpay.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { GenerateQRCodeDto, PromptPayType } from './dto/promptpay.dto';

// ─────────────────────────────────────────────────────────────────────────────
// PromptPayService — generateQRCode promptpayId precedence
//
// Verifies the fix for "property promptpayId should not exist":
//  - dto.promptpayId (จาก PaymentAccount default) ต้องถูก accept โดย DTO
//  - service ต้องใช้ dto.promptpayId ก่อน config.PROMPTPAY_ID
//  - ถ้า dto.promptpayId ไม่ส่งมา → fallback ไป config
//  - ถ้าทั้งคู่ว่าง → BadRequestException
// ─────────────────────────────────────────────────────────────────────────────

describe('PromptPayService - generateQRCode', () => {
  let service: PromptPayService;
  let prisma: jest.Mocked<PrismaService>;
  let configService: jest.Mocked<ConfigService>;

  const createMockPrisma = (): jest.Mocked<PrismaService> =>
    ({
      promptPayTransaction: {
        create: jest.fn(),
      },
    }) as any;

  const createMockConfig = (overrides: Record<string, string> = {}): jest.Mocked<ConfigService> =>
    ({
      get: jest.fn((key: string, defaultValue?: string) => {
        const values: Record<string, string> = {
          PROMPTPAY_ID: '0999999999',
          MERCHANT_NAME: 'Test Hotel',
          MERCHANT_CITY: 'Bangkok',
          ...overrides,
        };
        return values[key] ?? defaultValue ?? '';
      }),
    }) as any;

  const createMockEmail = (): jest.Mocked<EmailService> =>
    ({
      sendPaymentReceipt: jest.fn(),
    }) as any;

  const buildService = async (configOverrides: Record<string, string> = {}): Promise<void> => {
    const prismaMock = createMockPrisma();
    const configMock = createMockConfig(configOverrides);
    const emailMock = createMockEmail();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptPayService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: configMock },
        { provide: EmailService, useValue: emailMock },
      ],
    }).compile();

    service = module.get<PromptPayService>(PromptPayService);
    prisma = module.get(PrismaService);
    configService = module.get(ConfigService);
    (prisma.promptPayTransaction.create as jest.Mock).mockImplementation(({ data }) =>
      Promise.resolve({ id: 'tx-1', ...data }),
    );
  };

  beforeEach(async () => {
    await buildService();
    jest.clearAllMocks();
  });

  it('should use dto.promptpayId from PaymentAccount when provided (not env config)', async () => {
    const dto: GenerateQRCodeDto = {
      amount: 1765.5,
      bookingId: 'booking-1',
      tenantId: 'tenant-1',
      type: PromptPayType.DYNAMIC,
      expiryMinutes: 15,
      promptpayId: '0812345678', // ← จาก PaymentAccount default
    };

    const result = await service.generateQRCode(dto);

    expect(result.transactionRef).toMatch(/^PP/);
    expect(result.amount).toBe(1765.5);
    expect(result.status).toBe('pending');
    // Service ต้องเก็บ PaymentAccount promptpayId ไม่ใช่ของ env
    expect(prisma.promptPayTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          promptpayId: '0812345678',
          bookingId: 'booking-1',
          amount: 1765.5,
        }),
      }),
    );
  });

  it('should fallback to PROMPTPAY_ID from config when dto.promptpayId is absent', async () => {
    const dto: GenerateQRCodeDto = {
      amount: 500,
      bookingId: 'booking-2',
    };

    await service.generateQRCode(dto);

    expect(prisma.promptPayTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          promptpayId: '0999999999', // ← จาก env config
        }),
      }),
    );
  });

  it('should fallback to config when dto.promptpayId is an empty string', async () => {
    const dto = {
      amount: 250,
      promptpayId: '   ',
    } as GenerateQRCodeDto;

    await service.generateQRCode(dto);

    expect(prisma.promptPayTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          promptpayId: '0999999999',
        }),
      }),
    );
  });

  it('should throw BadRequestException when neither dto.promptpayId nor config is set', async () => {
    await buildService({ PROMPTPAY_ID: '' });

    await expect(service.generateQRCode({ amount: 100 } as GenerateQRCodeDto)).rejects.toThrow(
      BadRequestException,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GenerateQRCodeDto — class-validator behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('GenerateQRCodeDto', () => {
  const validateDto = async (payload: Record<string, unknown>) => {
    const dto = plainToInstance(GenerateQRCodeDto, payload);
    return validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  };

  it('should accept promptpayId as mobile number (10 digits, starts with 0)', async () => {
    const errors = await validateDto({
      amount: 1000,
      bookingId: 'b-1',
      promptpayId: '0812345678',
    });
    expect(errors).toHaveLength(0);
  });

  it('should accept promptpayId as national ID (13 digits)', async () => {
    const errors = await validateDto({
      amount: 1000,
      promptpayId: '1234567890123',
    });
    expect(errors).toHaveLength(0);
  });

  it('should accept payload without promptpayId (optional)', async () => {
    const errors = await validateDto({ amount: 1000 });
    expect(errors).toHaveLength(0);
  });

  it('should reject promptpayId with invalid format', async () => {
    const errors = await validateDto({
      amount: 1000,
      promptpayId: 'not-a-valid-id',
    });
    expect(errors.length).toBeGreaterThan(0);
    const property = errors.find((e) => e.property === 'promptpayId');
    expect(property).toBeDefined();
  });

  it('should NOT reject promptpayId as "should not exist" — regression for #checkin-payment', async () => {
    // Reproduces the original bug: ก่อนหน้านี้ DTO ไม่ได้ประกาศ promptpayId
    // ทำให้ ValidationPipe(forbidNonWhitelisted) reject ด้วย
    // "property promptpayId should not exist"
    const errors = await validateDto({
      amount: 1765.5,
      bookingId: 'booking-1',
      expiryMinutes: 15,
      type: 'dynamic',
      promptpayId: '0812345678',
    });
    const whitelistErrors = errors.filter(
      (e) => e.constraints && 'whitelistValidation' in e.constraints,
    );
    expect(whitelistErrors).toHaveLength(0);
  });
});
