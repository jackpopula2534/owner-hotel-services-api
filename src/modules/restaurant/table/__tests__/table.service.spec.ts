/**
 * Creating and editing a table from the POS.
 *
 * The Add Table form sends `status` (its "Initial Status" dropdown), so the
 * service has to carry that through to the row instead of silently defaulting
 * every table to AVAILABLE — and a duplicate table number has to come back as a
 * sentence, not as `restaurant_tables_restaurantId_tableNumber_key`.
 */

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TableService } from '../table.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AuditLogService } from '../../../../audit-log/audit-log.service';
import { TableStatusEnum } from '../dto/update-table-status.dto';

describe('TableService — create / update', () => {
  let service: TableService;

  const prisma = {
    restaurant: { findFirst: jest.fn() },
    restaurantTable: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  };

  const audit = { log: jest.fn() };
  const RESTAURANT = 'rest-1';
  const TENANT = 'tenant-1';

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        TableService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'http://localhost:9010' } },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(TableService);

    prisma.restaurant.findFirst.mockResolvedValue({ id: RESTAURANT, tenantId: TENANT });
    prisma.restaurantTable.findFirst.mockResolvedValue(null);
    prisma.restaurantTable.create.mockImplementation(({ data }: any) => ({ id: 't-1', ...data }));
  });

  it('saves the initial status the form picked', async () => {
    await service.create(
      RESTAURANT,
      { tableNumber: 'A1', capacity: 6, status: TableStatusEnum.OUT_OF_SERVICE } as any,
      TENANT,
    );

    expect(prisma.restaurantTable.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tableNumber: 'A1',
        capacity: 6,
        status: 'OUT_OF_SERVICE',
        restaurantId: RESTAURANT,
        tenantId: TENANT,
      }),
    });
  });

  it('leaves the status to the database default when the form omits it', async () => {
    await service.create(RESTAURANT, { tableNumber: 'A2', capacity: 4 } as any, TENANT);

    const { data } = prisma.restaurantTable.create.mock.calls[0][0];
    expect('status' in data).toBe(false);
  });

  it('turns a duplicate table number into a sentence, not an index name', async () => {
    // The pre-check cannot see a table another request is creating right now.
    prisma.restaurantTable.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: { target: 'restaurant_tables_restaurantId_tableNumber_key' },
      }),
    );

    await expect(
      service.create(RESTAURANT, { tableNumber: 'A1', capacity: 4 } as any, TENANT),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.create(RESTAURANT, { tableNumber: 'A1', capacity: 4 } as any, TENANT),
    ).rejects.not.toThrow(/restaurant_tables_/);
  });

  it('does not swallow other database errors as a duplicate', async () => {
    prisma.restaurantTable.create.mockRejectedValue(new Error('db down'));

    await expect(
      service.create(RESTAURANT, { tableNumber: 'A1', capacity: 4 } as any, TENANT),
    ).rejects.toThrow('db down');
  });

  it('records a status change made through the edit form in the audit trail', async () => {
    prisma.restaurantTable.findFirst.mockResolvedValue({
      id: 't-1',
      tableNumber: 'A1',
      zone: null,
      capacity: 4,
      status: 'AVAILABLE',
    });
    prisma.restaurantTable.update.mockResolvedValue({
      id: 't-1',
      tableNumber: 'A1',
      zone: null,
      capacity: 4,
      status: 'CLEANING',
    });

    await service.update(RESTAURANT, 't-1', { status: TableStatusEnum.CLEANING } as any, TENANT);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        oldValues: expect.objectContaining({ status: 'AVAILABLE' }),
        newValues: expect.objectContaining({ status: 'CLEANING' }),
      }),
    );
  });
});
