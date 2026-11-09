import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { THAI_PUBLIC_HOLIDAY_DATES } from '../../common/holidays/thai-holidays';
import { PropertyHolidaysService, expandHolidayDates } from './property-holidays.service';

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const row = (over: Partial<Parameters<typeof expandHolidayDates>[0][number]>) => ({
  kind: 'custom',
  date: d('2026-12-24'),
  endDate: null,
  repeatYearly: false,
  isEnabled: true,
  ...over,
});

describe('expandHolidayDates', () => {
  it('returns public holidays when the hotel has no settings', () => {
    expect(expandHolidayDates([], 2027)).toEqual([...THAI_PUBLIC_HOLIDAY_DATES].sort());
  });

  it('drops public holidays the hotel turned off', () => {
    const out = expandHolidayDates([row({ kind: 'default_off', date: d('2026-04-13') })], 2027);
    expect(out).not.toContain('2026-04-13');
    expect(out).toContain('2026-04-14');
  });

  it('adds custom ranges inclusively, skipping disabled ones', () => {
    const out = expandHolidayDates(
      [row({ endDate: d('2026-12-26') }), row({ date: d('2026-11-11'), isEnabled: false })],
      2027,
    );
    expect(out).toEqual(expect.arrayContaining(['2026-12-24', '2026-12-25', '2026-12-26']));
    expect(out).not.toContain('2026-11-11');
  });

  it('repeats yearly up to the horizon and skips Feb 29 in non-leap years', () => {
    const out = expandHolidayDates(
      [row({ date: d('2026-08-20'), repeatYearly: true }), row({ date: d('2028-02-29'), repeatYearly: true })],
      2029,
    );
    expect(out).toEqual(expect.arrayContaining(['2026-08-20', '2027-08-20', '2028-08-20', '2029-08-20', '2028-02-29']));
    expect(out).not.toContain('2029-02-29');
    expect(out.filter((x) => x.endsWith('-03-01'))).toHaveLength(0);
  });
});

describe('PropertyHolidaysService', () => {
  let prisma: {
    property: { findFirst: jest.Mock };
    propertyHoliday: { findMany: jest.Mock; deleteMany: jest.Mock; createMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: PropertyHolidaysService;

  beforeEach(() => {
    prisma = {
      property: { findFirst: jest.fn().mockResolvedValue({ id: 'p1' }) },
      propertyHoliday: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockReturnValue('del'),
        createMany: jest.fn().mockReturnValue('create'),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    service = new PropertyHolidaysService(prisma as unknown as PrismaService);
  });

  it('scopes reads to the tenant and rejects a property of another tenant', async () => {
    prisma.property.findFirst.mockResolvedValue(null);
    await expect(service.getSettings('p1', 't-other')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.property.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1', tenantId: 't-other', deletedAt: null } }),
    );
    expect(prisma.propertyHoliday.findMany).not.toHaveBeenCalled();
  });

  it('replaces all rows for the property inside one transaction (UTC dates)', async () => {
    await service.replaceSettings('p1', 't1', {
      disabledDefaultDates: ['2026-04-13', '2026-04-13'],
      customHolidays: [{ date: '2026-12-24', endDate: '2026-12-26', name: ' คริสต์มาส ', repeatYearly: true }],
    });
    expect(prisma.propertyHoliday.deleteMany).toHaveBeenCalledWith({ where: { propertyId: 'p1', tenantId: 't1' } });
    expect(prisma.propertyHoliday.createMany).toHaveBeenCalledWith({
      data: [
        { tenantId: 't1', propertyId: 'p1', kind: 'default_off', date: d('2026-04-13') },
        {
          tenantId: 't1',
          propertyId: 'p1',
          kind: 'custom',
          date: d('2026-12-24'),
          endDate: d('2026-12-26'),
          name: 'คริสต์มาส',
          category: 'custom',
          repeatYearly: true,
          isEnabled: true,
        },
      ],
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(['del', 'create']);
  });

  it('rejects impossible dates, reversed and over-long ranges', async () => {
    const bad = (h: { date: string; endDate?: string }) =>
      service.replaceSettings('p1', 't1', { disabledDefaultDates: [], customHolidays: [{ name: 'x', ...h }] });
    await expect(bad({ date: '2026-02-30' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(bad({ date: '2026-12-26', endDate: '2026-12-24' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(bad({ date: '2026-01-01', endDate: '2026-12-31' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
