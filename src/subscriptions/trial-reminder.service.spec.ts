import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TrialReminderService } from './trial-reminder.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

describe('TrialReminderService', () => {
  let service: TrialReminderService;
  let prismaSubscriptionsFindMany: jest.Mock;
  let prismaHistoryFindFirst: jest.Mock;
  let prismaHistoryCreate: jest.Mock;
  let emailSend: jest.Mock;

  beforeEach(async () => {
    prismaSubscriptionsFindMany = jest.fn();
    prismaHistoryFindFirst = jest.fn();
    prismaHistoryCreate = jest.fn().mockResolvedValue({});
    emailSend = jest.fn().mockResolvedValue({ success: true, emailLogId: 'log-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrialReminderService,
        {
          provide: PrismaService,
          useValue: {
            subscriptions: { findMany: prismaSubscriptionsFindMany },
            billing_history: {
              findFirst: prismaHistoryFindFirst,
              create: prismaHistoryCreate,
            },
          },
        },
        {
          provide: EmailService,
          useValue: { sendEmail: emailSend },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('https://app.staysync.com') },
        },
      ],
    }).compile();

    service = module.get(TrialReminderService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('sends a D-7 reminder when a trial subscription ends in exactly 7 days', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-01T00:00:00Z'));
    const endDate = new Date('2026-05-08T00:00:00Z');

    prismaSubscriptionsFindMany.mockResolvedValue([
      {
        id: 'sub-1',
        subscription_code: 'SUB-001',
        tenant_id: 'tenant-1',
        end_date: endDate,
        tenants: {
          id: 'tenant-1',
          name: 'Sukjai Hotel',
          email: 'owner@sukjai.com',
          customer_name: 'Khun A',
        },
      },
    ]);
    prismaHistoryFindFirst.mockResolvedValue(null);

    const sent = await service.sendBucket(7);

    expect(sent).toBe(1);
    expect(emailSend).toHaveBeenCalledTimes(1);
    const args = emailSend.mock.calls[0][0];
    expect(args.to).toBe('owner@sukjai.com');
    expect(args.context.daysLeft).toBe(7);
    expect(args.context.hotelName).toBe('Sukjai Hotel');
    expect(prismaHistoryCreate).toHaveBeenCalledTimes(1);
    expect(prismaHistoryCreate.mock.calls[0][0].data.eventType).toBe('trial_reminder_sent');
  });

  it('skips when a reminder for the same bucket was already sent', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-01T00:00:00Z'));

    prismaSubscriptionsFindMany.mockResolvedValue([
      {
        id: 'sub-1',
        subscription_code: 'SUB-001',
        tenant_id: 'tenant-1',
        end_date: new Date('2026-05-08T00:00:00Z'),
        tenants: { id: 't1', name: 'X', email: 'x@y.com', customer_name: null },
      },
    ]);
    prismaHistoryFindFirst.mockResolvedValue({ id: 'history-1' });

    const sent = await service.sendBucket(7);

    expect(sent).toBe(0);
    expect(emailSend).not.toHaveBeenCalled();
    expect(prismaHistoryCreate).not.toHaveBeenCalled();
  });

  it('skips tenants without an email address', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-01T00:00:00Z'));

    prismaSubscriptionsFindMany.mockResolvedValue([
      {
        id: 'sub-1',
        subscription_code: 'SUB-001',
        tenant_id: 'tenant-1',
        end_date: new Date('2026-05-04T00:00:00Z'),
        tenants: { id: 't1', name: 'NoEmail', email: null, customer_name: null },
      },
    ]);

    const sent = await service.sendBucket(3);

    expect(sent).toBe(0);
    expect(emailSend).not.toHaveBeenCalled();
  });

  it('returns 0 when no candidates are in the bucket', async () => {
    prismaSubscriptionsFindMany.mockResolvedValue([]);
    const sent = await service.sendBucket(1);
    expect(sent).toBe(0);
  });

  it('sends D-1 with the urgent subject line', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-01T00:00:00Z'));

    prismaSubscriptionsFindMany.mockResolvedValue([
      {
        id: 'sub-1',
        subscription_code: 'SUB-001',
        tenant_id: 'tenant-1',
        end_date: new Date('2026-05-02T00:00:00Z'),
        tenants: {
          id: 't1',
          name: 'Sukjai',
          email: 'owner@sukjai.com',
          customer_name: 'Khun A',
        },
      },
    ]);
    prismaHistoryFindFirst.mockResolvedValue(null);

    await service.sendBucket(1);

    const args = emailSend.mock.calls[0][0];
    expect(args.subject).toContain('พรุ่งนี้');
    expect(args.context.daysLeft).toBe(1);
  });
});
