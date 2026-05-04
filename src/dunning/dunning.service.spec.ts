import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DunningService } from './dunning.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { TenantLifecycleService } from '../tenants/tenant-lifecycle.service';

describe('DunningService', () => {
  let service: DunningService;
  let prismaInvoiceFindMany: jest.Mock;
  let prismaInvoiceFindUnique: jest.Mock;
  let prismaAttemptFindFirst: jest.Mock;
  let prismaAttemptCreate: jest.Mock;
  let prismaAttemptUpdate: jest.Mock;
  let prismaAttemptFindMany: jest.Mock;
  let emailSend: jest.Mock;
  let lifecycleTransition: jest.Mock;

  beforeEach(async () => {
    prismaInvoiceFindMany = jest.fn().mockResolvedValue([]);
    prismaInvoiceFindUnique = jest.fn();
    prismaAttemptFindFirst = jest.fn();
    prismaAttemptCreate = jest.fn().mockResolvedValue({ id: 'att-1' });
    prismaAttemptUpdate = jest.fn().mockResolvedValue({});
    prismaAttemptFindMany = jest.fn().mockResolvedValue([]);
    emailSend = jest.fn().mockResolvedValue({ success: true, emailLogId: 'log-1' });
    lifecycleTransition = jest.fn().mockResolvedValue({ id: 't1', status: 'past_due' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DunningService,
        {
          provide: PrismaService,
          useValue: {
            invoices: {
              findMany: prismaInvoiceFindMany,
              findUnique: prismaInvoiceFindUnique,
            },
            dunning_attempts: {
              findFirst: prismaAttemptFindFirst,
              findMany: prismaAttemptFindMany,
              create: prismaAttemptCreate,
              update: prismaAttemptUpdate,
            },
          },
        },
        { provide: EmailService, useValue: { sendEmail: emailSend } },
        {
          provide: TenantLifecycleService,
          useValue: { transition: lifecycleTransition },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('https://app.staysync.com') },
        },
      ],
    }).compile();

    service = module.get(DunningService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('sendManual sends an email and creates a dunning_attempt row', async () => {
    prismaInvoiceFindUnique.mockResolvedValue({
      id: 'inv-1',
      invoice_no: 'INV-001',
      tenant_id: 't1',
      status: 'pending',
      amount: 4990,
      due_date: new Date('2026-04-15'),
      tenants: { id: 't1', name: 'Sukjai', email: 'a@b.com', customer_name: 'Khun A' },
    });

    const r = await service.sendManual('inv-1', 'reminder', 'admin-1');

    expect(r.id).toBe('att-1');
    expect(prismaAttemptCreate).toHaveBeenCalledTimes(1);
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(prismaAttemptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'sent' }),
      }),
    );
  });

  it('sendManual rejects when invoice is already paid', async () => {
    prismaInvoiceFindUnique.mockResolvedValue({
      id: 'inv-1',
      status: 'paid',
      tenants: { email: 'a@b.com' },
    });
    await expect(service.sendManual('inv-1', 'reminder')).rejects.toThrow(BadRequestException);
  });

  it('sendManual rejects unknown invoice', async () => {
    prismaInvoiceFindUnique.mockResolvedValue(null);
    await expect(service.sendManual('missing', 'reminder')).rejects.toThrow(NotFoundException);
  });

  it('sendManual escalates tenant to past_due after first_warning', async () => {
    prismaInvoiceFindUnique.mockResolvedValue({
      id: 'inv-1',
      invoice_no: 'INV-001',
      tenant_id: 't1',
      status: 'pending',
      amount: 4990,
      due_date: new Date('2026-04-15'),
      tenants: { name: 'Sukjai', email: 'a@b.com', customer_name: 'A' },
    });

    await service.sendManual('inv-1', 'first_warning');

    expect(lifecycleTransition).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', toStatus: 'past_due' }),
    );
  });

  it('runDailyDunning skips invoices that already have a sent attempt at that level', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-01'));
    prismaInvoiceFindMany.mockResolvedValue([
      {
        id: 'inv-1',
        invoice_no: 'INV-001',
        tenant_id: 't1',
        amount: 4990,
        due_date: new Date('2026-04-20'), // 11 days overdue
        tenants: { name: 'X', email: 'x@y.com', customer_name: null },
      },
    ]);
    // already sent at every level — should skip
    prismaAttemptFindFirst.mockResolvedValue({ id: 'existing' });

    const r = await service.runDailyDunning();
    expect(r.sent).toBe(0);
    expect(emailSend).not.toHaveBeenCalled();
  });

  it('runDailyDunning marks attempt failed when email throws', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-01'));
    prismaInvoiceFindMany.mockResolvedValue([
      {
        id: 'inv-1',
        invoice_no: 'INV-001',
        tenant_id: 't1',
        amount: 4990,
        due_date: new Date('2026-04-29'), // 2 days overdue → reminder
        tenants: { name: 'X', email: 'x@y.com', customer_name: null },
      },
    ]);
    prismaAttemptFindFirst.mockResolvedValue(null);
    emailSend.mockRejectedValue(new Error('SMTP down'));

    await service.runDailyDunning();

    expect(prismaAttemptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('listAttempts forwards filters to prisma', async () => {
    await service.listAttempts({ tenantId: 't1', level: 'first_warning' });
    expect(prismaAttemptFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: 't1', level: 'first_warning' },
      }),
    );
  });

  it('acknowledge updates attempt status', async () => {
    await service.acknowledge('att-1');
    expect(prismaAttemptUpdate).toHaveBeenCalledWith({
      where: { id: 'att-1' },
      data: { status: 'acknowledged' },
    });
  });
});
