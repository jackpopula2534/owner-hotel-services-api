import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../prisma/prisma.service';
import { verifyHmacSha256 } from './webhook-signature.util';

const SECRET = 'test-secret';

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

describe('verifyHmacSha256', () => {
  it('returns true for matching signature', () => {
    const body = '{"a":1}';
    expect(verifyHmacSha256(body, sign(body), SECRET)).toBe(true);
  });

  it('returns false for tampered body', () => {
    const body = '{"a":1}';
    expect(verifyHmacSha256('{"a":2}', sign(body), SECRET)).toBe(false);
  });

  it('returns false for missing signature', () => {
    expect(verifyHmacSha256('hello', undefined, SECRET)).toBe(false);
    expect(verifyHmacSha256('hello', '', SECRET)).toBe(false);
  });

  it('returns false for malformed hex', () => {
    expect(verifyHmacSha256('hello', 'not-hex!!', SECRET)).toBe(false);
  });

  it('returns false when secret is missing', () => {
    expect(verifyHmacSha256('hello', sign('hello'), '')).toBe(false);
  });
});

describe('WebhooksService.ingest', () => {
  let service: WebhooksService;
  let mockFindUnique: jest.Mock;
  let mockCreate: jest.Mock;
  let mockUpdate: jest.Mock;

  beforeEach(async () => {
    mockFindUnique = jest.fn();
    mockCreate = jest.fn();
    mockUpdate = jest.fn().mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        {
          provide: PrismaService,
          useValue: {
            payment_webhook_events: {
              findUnique: mockFindUnique,
              create: mockCreate,
              update: mockUpdate,
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'WEBHOOK_SECRET_PROMPTPAY') return SECRET;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(WebhooksService);
  });

  afterEach(() => jest.clearAllMocks());

  it('creates a webhook event with verified signature', async () => {
    const rawBody = '{"event_id":"e1","amount":100}';
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'w1' });

    const result = await service.ingest({
      provider: 'promptpay',
      eventType: 'payment.completed',
      idempotencyKey: 'e1',
      signature: sign(rawBody),
      rawBody,
      payload: { event_id: 'e1', amount: 100 },
    });

    expect(result.status).toBe('received');
    expect(result.eventId).toBe('w1');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          signature_verified: 1,
          status: 'received',
        }),
      }),
    );
  });

  it('marks the event as failed when signature is wrong', async () => {
    const rawBody = '{"event_id":"e2"}';
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'w2' });

    const result = await service.ingest({
      provider: 'promptpay',
      eventType: 'payment.completed',
      idempotencyKey: 'e2',
      signature: 'deadbeef',
      rawBody,
      payload: { event_id: 'e2' },
    });

    expect(result.status).toBe('received');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          signature_verified: 0,
          status: 'failed',
          error_message: 'Signature verification failed',
        }),
      }),
    );
  });

  it('returns duplicate when idempotency key has been seen', async () => {
    mockFindUnique.mockResolvedValue({ id: 'w-existing' });

    const r = await service.ingest({
      provider: 'promptpay',
      eventType: 'x',
      idempotencyKey: 'dup',
      rawBody: '{}',
      payload: {},
      signature: sign('{}'),
    });

    expect(r.status).toBe('duplicate');
    expect(r.eventId).toBe('w-existing');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('falls back to duplicate on unique-constraint race', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockRejectedValue(new Error('Unique constraint failed on the fields'));

    const r = await service.ingest({
      provider: 'promptpay',
      eventType: 'x',
      idempotencyKey: 'race',
      rawBody: '{}',
      payload: {},
      signature: sign('{}'),
    });

    expect(r.status).toBe('duplicate');
  });
});
