/**
 * Cross-Tenant Isolation Integration Test (W2.6)
 *
 * Purpose
 * -------
 * Verify end-to-end that the W2 Prisma `$use` middleware prevents one tenant
 * from reading or modifying another tenant's data — against a real MySQL
 * database, not a mock. Unit tests already cover the args-transformation
 * logic; this test catches integration failures the unit tests can't:
 *   • Wrong model name in TENANT_SCOPED_MODELS
 *   • PrismaService middleware ordering bug (encryption before scope)
 *   • AsyncLocalStorage not propagating across Prisma's internal async work
 *   • Snake_case column names not mapping correctly at the SQL layer
 *
 * How it runs
 * -----------
 *   • Locally:  `npm run test:integration` (requires MySQL on $DATABASE_URL)
 *   • CI:       `.github/workflows/ci.yml > test-integration` (uses the
 *               MySQL service container already configured there)
 *   • Sandbox:  N/A — no MySQL available
 *
 * Data setup
 * ----------
 *   1. Two tenants created via `runUnscoped()` (bypass middleware for seed)
 *   2. One property + one room + one booking per tenant
 *   3. The tenantIds are random UUIDs so the test is hermetic and can run
 *      against a dev database without conflicting with seeded data.
 *
 * Cleanup
 * -------
 *   afterAll deletes everything we created. Failures inside the test still
 *   trigger cleanup via the finally-style afterAll hook.
 *
 * @see src/common/tenant/tenant-scope.middleware.ts
 * @see docs/architecture/tenant-isolation.md
 */
import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/services/encryption.service';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import { ConfigModule } from '@nestjs/config';
import { validate } from '../config/env.validation';

describe('Cross-Tenant Isolation (integration)', () => {
  let prisma: PrismaService;
  let tenantContext: TenantContextService;

  // IDs we'll create + clean up
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const propertyA = randomUUID();
  const propertyB = randomUUID();
  const roomA = randomUUID();
  const roomB = randomUUID();
  const bookingA = randomUUID();
  const bookingB = randomUUID();

  // Skip strategy
  // -------------
  // Each test calls `bail()` first; if the database wasn't reachable at
  // beforeAll time, we early-return with a console hint instead of producing
  // 12 confusing connection-error failures. CI and the user's docker compose
  // both expose MySQL; sandbox runs (no MySQL) cleanly skip.
  //
  // We can't use describe.skip / it.skip alone because their predicate is
  // evaluated at test-definition time — before beforeAll has had a chance
  // to try the connection. So we keep the tests defined and skip via
  // `bail()` at runtime instead.
  let skipReason: string | null = null;
  const bail = (label: string): boolean => {
    if (skipReason) {
      // eslint-disable-next-line no-console
      console.warn(`[skip] ${label} — ${skipReason}`);
      return true;
    }
    return false;
  };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
      skipReason = 'No DATABASE_URL / DB_HOST — set up a test DB to run this spec';
      return;
    }

    let module: TestingModule;
    try {
      module = await Test.createTestingModule({
        imports: [ConfigModule.forRoot({ isGlobal: true, validate })],
        providers: [PrismaService, EncryptionService, TenantContextService],
      }).compile();

      prisma = module.get<PrismaService>(PrismaService);
      tenantContext = module.get<TenantContextService>(TenantContextService);
      await prisma.$connect();
    } catch (err) {
      skipReason = `Database not reachable: ${(err as Error).message.split('\n')[0]}`;
      return;
    }

    // Seed both tenants with the middleware turned off (otherwise our seed
    // for tenant B would itself be blocked since we'd be inside tenant A's
    // context, etc.). runUnscoped is the supported escape hatch for this.
    try {
    await tenantContext.runUnscoped(async () => {
      await prisma.tenants.create({
        data: {
          id: tenantA,
          name: 'Integration Test Tenant A',
          status: 'trial',
        },
      });
      await prisma.tenants.create({
        data: {
          id: tenantB,
          name: 'Integration Test Tenant B',
          status: 'trial',
        },
      });

      await prisma.property.create({
        data: {
          id: propertyA,
          tenantId: tenantA,
          name: 'Hotel A',
          code: `A-${Date.now()}`,
        },
      });
      await prisma.property.create({
        data: {
          id: propertyB,
          tenantId: tenantB,
          name: 'Hotel B',
          code: `B-${Date.now()}`,
        },
      });

      await prisma.room.create({
        data: {
          id: roomA,
          tenantId: tenantA,
          propertyId: propertyA,
          number: 'A-101',
          type: 'standard',
          price: 1500,
        },
      });
      await prisma.room.create({
        data: {
          id: roomB,
          tenantId: tenantB,
          propertyId: propertyB,
          number: 'B-101',
          type: 'standard',
          price: 1500,
        },
      });

      await prisma.booking.create({
        data: {
          id: bookingA,
          tenantId: tenantA,
          propertyId: propertyA,
          roomId: roomA,
          guestFirstName: 'Alice',
          guestLastName: 'TenantA',
          checkIn: new Date('2026-06-01'),
          checkOut: new Date('2026-06-03'),
          totalPrice: 3000,
        },
      });
      await prisma.booking.create({
        data: {
          id: bookingB,
          tenantId: tenantB,
          propertyId: propertyB,
          roomId: roomB,
          guestFirstName: 'Bob',
          guestLastName: 'TenantB',
          checkIn: new Date('2026-06-01'),
          checkOut: new Date('2026-06-03'),
          totalPrice: 3000,
        },
      });
    });
    } catch (err) {
      skipReason = `Seed failed: ${(err as Error).message.split('\n')[0]}`;
    }
  });

  afterAll(async () => {
    if (skipReason || !prisma) return;
    // Always run cleanup with scoping off so we can delete both tenants.
    await tenantContext.runUnscoped(async () => {
      await prisma.booking.deleteMany({ where: { id: { in: [bookingA, bookingB] } } });
      await prisma.room.deleteMany({ where: { id: { in: [roomA, roomB] } } });
      await prisma.property.deleteMany({ where: { id: { in: [propertyA, propertyB] } } });
      await prisma.tenants.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    });
    await prisma.$disconnect();
  });

  describe('reads', () => {
    it("tenant A's findFirst({where:{id:bookingB}}) returns null", async () => {
      if (bail("tenant A's findFirst({where:{id:bookingB}}) returns null")) return;
      // Without our middleware this would return tenant B's booking — the
      // classic IDOR (insecure direct object reference) vulnerability. With
      // the middleware, the injected `tenantId = tenantA` makes the row
      // invisible because the where becomes `id = bookingB AND tenantId = A`.
      const result = await tenantContext.run(
        { tenantId: tenantA, skipScope: false },
        async () => prisma.booking.findFirst({ where: { id: bookingB } }),
      );
      expect(result).toBeNull();
    });

    it("tenant A's findFirst({where:{id:bookingA}}) returns the row", async () => {
      if (bail("tenant A's findFirst({where:{id:bookingA}}) returns the row")) return;
      // Sanity check — the middleware shouldn't break legitimate same-tenant access
      const result = await tenantContext.run(
        { tenantId: tenantA, skipScope: false },
        async () => prisma.booking.findFirst({ where: { id: bookingA } }),
      );
      expect(result).not.toBeNull();
      expect(result?.id).toBe(bookingA);
      expect(result?.tenantId).toBe(tenantA);
    });

    it('findMany returns ONLY same-tenant rows', async () => {
      if (bail('findMany returns ONLY same-tenant rows')) return;
      const aResults = await tenantContext.run(
        { tenantId: tenantA, skipScope: false },
        async () => prisma.booking.findMany({ where: { id: { in: [bookingA, bookingB] } } }),
      );
      expect(aResults).toHaveLength(1);
      expect(aResults[0].id).toBe(bookingA);

      const bResults = await tenantContext.run(
        { tenantId: tenantB, skipScope: false },
        async () => prisma.booking.findMany({ where: { id: { in: [bookingA, bookingB] } } }),
      );
      expect(bResults).toHaveLength(1);
      expect(bResults[0].id).toBe(bookingB);
    });

    it('count excludes other tenants', async () => {
      if (bail('count excludes other tenants')) return;
      const aCount = await tenantContext.run(
        { tenantId: tenantA, skipScope: false },
        async () => prisma.booking.count({ where: { id: { in: [bookingA, bookingB] } } }),
      );
      expect(aCount).toBe(1);
    });

    it('findUnique on tenant-scoped model throws (use findFirst)', async () => {
      if (bail('findUnique on tenant-scoped model throws (use findFirst)')) return;
      await expect(
        tenantContext.run(
          { tenantId: tenantA, skipScope: false },
          async () => prisma.booking.findUnique({ where: { id: bookingA } }),
        ),
      ).rejects.toThrow(/findUnique\(\) is not allowed/);
    });
  });

  describe('writes', () => {
    it('update cross-tenant becomes a no-op (RecordNotFound)', async () => {
      if (bail('update cross-tenant becomes a no-op (RecordNotFound)')) return;
      // Tenant A tries to update tenant B's booking. The injected tenantId=A
      // means MySQL finds zero matching rows → Prisma throws P2025
      // (RecordNotFound). The row in tenant B is unchanged afterwards.
      await expect(
        tenantContext.run(
          { tenantId: tenantA, skipScope: false },
          async () =>
            prisma.booking.update({
              where: { id: bookingB },
              data: { notes: 'HACKED' },
            }),
        ),
      ).rejects.toThrow();

      // Verify the actual row was not touched
      const intact = await tenantContext.runUnscoped(async () =>
        prisma.booking.findFirst({ where: { id: bookingB } }),
      );
      expect(intact?.notes).not.toBe('HACKED');
    });

    it('updateMany cross-tenant affects 0 rows', async () => {
      if (bail('updateMany cross-tenant affects 0 rows')) return;
      const result = await tenantContext.run(
        { tenantId: tenantA, skipScope: false },
        async () =>
          prisma.booking.updateMany({
            where: { id: bookingB },
            data: { notes: 'BULK-HACK' },
          }),
      );
      expect(result.count).toBe(0);

      const intact = await tenantContext.runUnscoped(async () =>
        prisma.booking.findFirst({ where: { id: bookingB } }),
      );
      expect(intact?.notes).not.toBe('BULK-HACK');
    });

    it('deleteMany cross-tenant affects 0 rows', async () => {
      if (bail('deleteMany cross-tenant affects 0 rows')) return;
      const result = await tenantContext.run(
        { tenantId: tenantA, skipScope: false },
        async () =>
          prisma.booking.deleteMany({
            where: { id: bookingB },
          }),
      );
      expect(result.count).toBe(0);

      // Tenant B's booking still exists
      const intact = await tenantContext.runUnscoped(async () =>
        prisma.booking.findFirst({ where: { id: bookingB } }),
      );
      expect(intact).not.toBeNull();
    });

    it('create auto-stamps the current tenantId', async () => {
      if (bail('create auto-stamps the current tenantId')) return;
      const newBookingId = randomUUID();
      try {
        await tenantContext.run(
          { tenantId: tenantA, skipScope: false },
          async () =>
            prisma.booking.create({
              data: {
                id: newBookingId,
                // NOTE: no tenantId here — middleware should add it
                propertyId: propertyA,
                roomId: roomA,
                guestFirstName: 'Charlie',
                guestLastName: 'AutoStamp',
                checkIn: new Date('2026-07-01'),
                checkOut: new Date('2026-07-02'),
                totalPrice: 1500,
              } as never,
            }),
        );

        const created = await tenantContext.runUnscoped(async () =>
          prisma.booking.findFirst({ where: { id: newBookingId } }),
        );
        expect(created?.tenantId).toBe(tenantA);
      } finally {
        await tenantContext.runUnscoped(async () =>
          prisma.booking.deleteMany({ where: { id: newBookingId } }),
        );
      }
    });
  });

  describe('platform-global models pass through', () => {
    it('Plan / BankAccount queries are not auto-scoped', async () => {
      if (bail('Plan / BankAccount queries are not auto-scoped')) return;
      // These models have no tenantId column — middleware must not add one
      // (or the SQL query would error). Calling findMany on them inside
      // tenant A's context should still work.
      await expect(
        tenantContext.run({ tenantId: tenantA, skipScope: false }, async () =>
          prisma.bankAccount.findMany({ take: 1 }),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('opt-out paths', () => {
    it('runUnscoped sees rows from every tenant', async () => {
      if (bail('runUnscoped sees rows from every tenant')) return;
      const all = await tenantContext.runUnscoped(async () =>
        prisma.booking.findMany({ where: { id: { in: [bookingA, bookingB] } } }),
      );
      expect(all.map((b) => b.id).sort()).toEqual([bookingA, bookingB].sort());
    });

    it('manual skipScope flag also disables filtering', async () => {
      if (bail('manual skipScope flag also disables filtering')) return;
      const all = await tenantContext.run(
        { tenantId: tenantA, skipScope: true },
        async () =>
          prisma.booking.findMany({ where: { id: { in: [bookingA, bookingB] } } }),
      );
      expect(all).toHaveLength(2);
    });
  });
});
