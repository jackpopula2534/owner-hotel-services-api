import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentSettingsService } from './payment-settings.service';
import { SavePaymentSettingsDto } from './dto/save-payment-settings.dto';

describe('PaymentSettingsService.upsert — website deposit', () => {
  const channels = { promptpayEnabled: true, bankTransferEnabled: false, cashEnabled: true };
  let prisma: { paymentSettings: { findUnique: jest.Mock; update: jest.Mock; create: jest.Mock } };
  let service: PaymentSettingsService;

  beforeEach(() => {
    prisma = {
      paymentSettings: {
        findUnique: jest.fn().mockResolvedValue({ id: 'ps-1' }),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
        create: jest.fn(),
      },
    };
    service = new PaymentSettingsService(prisma as unknown as PrismaService);
  });

  const save = (dto: Partial<SavePaymentSettingsDto>) =>
    service.upsert('prop-1', { ...channels, ...dto } as SavePaymentSettingsDto);

  it('stores a percentage deposit', async () => {
    await save({ websiteDepositType: 'percentage', websiteDepositValue: 30 });
    expect(prisma.paymentSettings.update.mock.calls[0][0].data).toMatchObject({
      websiteDepositType: 'percentage',
      websiteDepositValue: 30,
    });
  });

  it('clears the value when switching back to full payment', async () => {
    await save({ websiteDepositType: 'full', websiteDepositValue: 500 });
    expect(prisma.paymentSettings.update.mock.calls[0][0].data).toMatchObject({
      websiteDepositType: 'full',
      websiteDepositValue: null,
    });
  });

  it('leaves the stored policy alone when an older client omits it', async () => {
    await save({});
    const data = prisma.paymentSettings.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('websiteDepositType');
    expect(data).not.toHaveProperty('websiteDepositValue');
  });

  it('rejects a missing amount and a 100% "deposit"', async () => {
    await expect(save({ websiteDepositType: 'fixed', websiteDepositValue: null })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(save({ websiteDepositType: 'percentage', websiteDepositValue: 100 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.paymentSettings.update).not.toHaveBeenCalled();
  });
});
