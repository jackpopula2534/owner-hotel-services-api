/**
 * The table list feeds the Live Monitor floor plan.
 *
 * Besides the reservation and the open bill it already carried, the monitor
 * needs to know how long the party has been seated (the open order's
 * `createdAt`), how many guests sat down (`partySize`), and whether anyone at
 * the table is waiting on staff — a PAYMENT call is the "ขอเช็คบิล" signal.
 */

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TableService } from '../table.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AuditLogService } from '../../../../audit-log/audit-log.service';

describe('TableService — findAll (Live Monitor data)', () => {
  let service: TableService;

  const prisma = {
    restaurant: { findFirst: jest.fn() },
    restaurantTable: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        TableService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'http://localhost:9010' } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(TableService);

    prisma.restaurant.findFirst.mockResolvedValue({ id: 'rest-1', tenantId: 'tenant-1' });
    prisma.restaurantTable.findMany.mockResolvedValue([]);
  });

  const includeOfLastCall = () => prisma.restaurantTable.findMany.mock.calls[0][0].include;

  it('stays scoped to the tenant and restaurant', async () => {
    await service.findAll('rest-1', {}, 'tenant-1');
    expect(prisma.restaurantTable.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ restaurantId: 'rest-1', tenantId: 'tenant-1' }),
    );
  });

  it('returns when the open bill was opened and for how many guests', async () => {
    await service.findAll('rest-1', {}, 'tenant-1');
    expect(includeOfLastCall().orders.select).toEqual(
      expect.objectContaining({ createdAt: true, partySize: true, total: true }),
    );
  });

  it('returns only the staff calls still waiting on someone', async () => {
    await service.findAll('rest-1', {}, 'tenant-1');
    const staffCalls = includeOfLastCall().staffCalls;
    expect(staffCalls.where).toEqual({ status: { in: ['PENDING', 'ACKNOWLEDGED'] } });
    expect(staffCalls.select).toEqual(
      expect.objectContaining({ id: true, callType: true, status: true, createdAt: true }),
    );
  });
});
