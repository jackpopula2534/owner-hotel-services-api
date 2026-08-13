/**
 * "Which party is sitting at A1 right now?"
 *
 * The POS asks this before it opens a bill, so the ordering screen can name the
 * party instead of showing an empty guest field. Without a table filter the till
 * would have to pull the whole book and sieve it client-side.
 */

import { Test } from '@nestjs/testing';
import { ReservationService } from '../reservation.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AuditLogService } from '../../../../audit-log/audit-log.service';
import { ReservationStatusEnum } from '../dto/update-reservation.dto';

describe('ReservationService.findAll — table filter', () => {
  let service: ReservationService;

  const prisma = {
    tableReservation: { findMany: jest.fn(), count: jest.fn() },
  };

  const RESTAURANT = 'rest-1';
  const TENANT = 'tenant-1';

  const whereOf = () => prisma.tableReservation.findMany.mock.calls[0][0].where;

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReservationService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(ReservationService);

    prisma.tableReservation.findMany.mockResolvedValue([]);
    prisma.tableReservation.count.mockResolvedValue(0);
  });

  it('narrows to one table when asked', async () => {
    await service.findAll(
      RESTAURANT,
      { tableId: 'table-a1', status: ReservationStatusEnum.SEATED },
      TENANT,
    );

    expect(whereOf()).toMatchObject({
      restaurantId: RESTAURANT,
      tenantId: TENANT,
      tableId: 'table-a1',
      status: 'SEATED',
    });
  });

  it('leaves the query untouched when no table is given', async () => {
    await service.findAll(RESTAURANT, {}, TENANT);

    expect(whereOf()).not.toHaveProperty('tableId');
  });

  it('still scopes to the tenant — a table id alone must not reach another tenant’s book', async () => {
    await service.findAll(RESTAURANT, { tableId: 'table-a1' }, TENANT);

    expect(whereOf()).toMatchObject({ tenantId: TENANT, restaurantId: RESTAURANT });
  });
});
