/**
 * Unit tests for createTenantScopeMiddleware.
 *
 * These tests pass a synthetic `params` object to the middleware and assert
 * how the args are mutated before being handed to the next() callback. No
 * real Prisma client is involved — the middleware contract is pure args
 * transformation.
 *
 * The tests cover, for a single representative tenant-scoped model (Booking):
 *   • READ ops    — findFirst, findMany, count, aggregate
 *   • WRITE-where — update, updateMany, delete, deleteMany
 *   • CREATE      — create, createMany, upsert
 *   • findUnique  — should throw (cannot be auto-scoped)
 *   • Caller-supplied tenantId — same tenant preserved, a different one rejected
 *   • Platform-global model    — pass-through
 *   • Scope opt-out (runUnscoped) — pass-through
 *   • Missing context (no tenantId in ALS) — pass-through (cron / seed)
 *
 * Plus snake_case scoping coverage via `subscriptions` (uses tenant_id).
 */
import 'reflect-metadata';
import type { Prisma } from '@prisma/client';
import { TenantContextService } from '../tenant-context.service';
import { createTenantScopeMiddleware } from '../tenant-scope.middleware';

type Params = Prisma.MiddlewareParams;

/**
 * Build a minimal Prisma middleware-params object. The middleware doesn't
 * care about most fields, but `dataPath` / `runInTransaction` are required
 * by Prisma's type so we include benign defaults.
 *
 * @param model - schema model name
 * @param action - Prisma operation
 * @param args - operation arguments to inspect
 * @returns Params suitable for middleware invocation
 */
function makeParams(
  model: string,
  action: Prisma.PrismaAction,
  args: Record<string, unknown>,
): Params {
  return {
    model: model as Prisma.ModelName,
    action,
    args,
    dataPath: [],
    runInTransaction: false,
  };
}

describe('tenant-scope middleware', () => {
  const TENANT_A = 'tenant-aaaa';
  const TENANT_B = 'tenant-bbbb';

  let context: TenantContextService;
  let middleware: ReturnType<typeof createTenantScopeMiddleware>;
  // The `next` spy captures the params the middleware passed downstream so
  // each test can assert on the post-injection args.
  let next: jest.MockedFunction<(params: Params) => Promise<unknown>>;

  beforeEach(() => {
    context = new TenantContextService();
    middleware = createTenantScopeMiddleware(context);
    next = jest.fn().mockResolvedValue({});
  });

  /**
   * Run the middleware inside an ALS frame for TENANT_A, return the params
   * the middleware passed to next().
   */
  async function runAsTenant(params: Params, tenantId: string = TENANT_A) {
    await context.run({ tenantId, skipScope: false }, async () => {
      await middleware(params, next);
    });
    return next.mock.calls[0][0];
  }

  describe('READ ops on tenant-scoped model (Booking)', () => {
    it('injects tenantId into findFirst({ where: { id } })', async () => {
      const called = await runAsTenant(
        makeParams('Booking', 'findFirst', { where: { id: 'booking-1' } }),
      );
      expect(called.args).toEqual({
        where: { id: 'booking-1', tenantId: TENANT_A },
      });
    });

    it('injects tenantId into findMany({}) when where is missing', async () => {
      const called = await runAsTenant(makeParams('Booking', 'findMany', {}));
      expect(called.args.where).toEqual({ tenantId: TENANT_A });
    });

    it('preserves complex where with AND/OR operators', async () => {
      const called = await runAsTenant(
        makeParams('Booking', 'findMany', {
          where: { OR: [{ status: 'confirmed' }, { status: 'checked_in' }] },
        }),
      );
      expect(called.args.where).toEqual({
        OR: [{ status: 'confirmed' }, { status: 'checked_in' }],
        tenantId: TENANT_A,
      });
    });

    it('injects tenantId into count', async () => {
      const called = await runAsTenant(makeParams('Booking', 'count', {}));
      expect(called.args.where).toEqual({ tenantId: TENANT_A });
    });

    it('injects tenantId into aggregate', async () => {
      const called = await runAsTenant(
        makeParams('Booking', 'aggregate', { _sum: { totalAmount: true } }),
      );
      expect(called.args.where).toEqual({ tenantId: TENANT_A });
    });
  });

  describe('WRITE-where ops on tenant-scoped model', () => {
    it('injects tenantId into update', async () => {
      const called = await runAsTenant(
        makeParams('Booking', 'update', {
          where: { id: 'booking-1' },
          data: { status: 'cancelled' },
        }),
      );
      expect(called.args.where).toEqual({ id: 'booking-1', tenantId: TENANT_A });
    });

    it('injects tenantId into delete', async () => {
      const called = await runAsTenant(
        makeParams('Booking', 'delete', { where: { id: 'booking-1' } }),
      );
      expect(called.args.where).toEqual({ id: 'booking-1', tenantId: TENANT_A });
    });

    it('injects tenantId into updateMany / deleteMany', async () => {
      const upd = await runAsTenant(
        makeParams('Booking', 'updateMany', {
          where: { status: 'expired' },
          data: { status: 'archived' },
        }),
      );
      expect(upd.args.where).toEqual({ status: 'expired', tenantId: TENANT_A });
    });
  });

  describe('CREATE ops on tenant-scoped model', () => {
    it('injects tenantId into create({ data })', async () => {
      const called = await runAsTenant(
        makeParams('Booking', 'create', {
          data: { id: 'b1', guestId: 'g1', roomId: 'r1' },
        }),
      );
      expect(called.args.data).toEqual({
        id: 'b1',
        guestId: 'g1',
        roomId: 'r1',
        tenantId: TENANT_A,
      });
    });

    it('injects tenantId into createMany rows that lack it', async () => {
      const called = await runAsTenant(
        makeParams('Booking', 'createMany', {
          data: [
            { id: 'b1' },
            { id: 'b2', tenantId: TENANT_A }, // already correct — preserve
          ],
        }),
      );
      expect(called.args.data).toEqual([
        { id: 'b1', tenantId: TENANT_A },
        { id: 'b2', tenantId: TENANT_A },
      ]);
    });

    it('injects both where and create on upsert', async () => {
      const called = await runAsTenant(
        makeParams('Booking', 'upsert', {
          where: { id: 'b1' },
          create: { id: 'b1', guestId: 'g1' },
          update: { status: 'updated' },
        }),
      );
      expect(called.args.where).toEqual({ id: 'b1', tenantId: TENANT_A });
      expect(called.args.create).toEqual({
        id: 'b1',
        guestId: 'g1',
        tenantId: TENANT_A,
      });
    });
  });

  describe('caller-supplied tenantId', () => {
    it('leaves an existing where.tenantId alone when it names the same tenant', async () => {
      const called = await runAsTenant(
        makeParams('Booking', 'findFirst', {
          where: { id: 'b1', tenantId: TENANT_A },
        }),
      );
      expect(called.args.where).toEqual({ id: 'b1', tenantId: TENANT_A });
    });

    it('REJECTS a read pinned to a different tenant', async () => {
      // Prisma does not throw on a mismatch — it runs the query the caller asked
      // for. So `findMany({ where: { tenantId: req.params.tenantId } })` used to
      // make this middleware step aside on exactly the value an attacker controls.
      await expect(
        runAsTenant(makeParams('Booking', 'findMany', { where: { tenantId: TENANT_B } })),
      ).rejects.toThrow(/refusing to query "tenantId" = "tenant-bbbb"/);
      expect(next).not.toHaveBeenCalled();
    });

    it('REJECTS a write pinned to a different tenant', async () => {
      await expect(
        runAsTenant(makeParams('Booking', 'create', { data: { id: 'b1', tenantId: TENANT_B } })),
      ).rejects.toThrow(/refusing to write "tenantId" = "tenant-bbbb"/);
      expect(next).not.toHaveBeenCalled();
    });

    it('REJECTS a cross-tenant update, delete and upsert', async () => {
      for (const action of ['update', 'delete', 'updateMany'] as const) {
        await expect(
          runAsTenant(makeParams('Booking', action, { where: { tenantId: TENANT_B } })),
        ).rejects.toThrow(/refusing to query/);
      }
      await expect(
        runAsTenant(makeParams('Booking', 'upsert', { where: { tenantId: TENANT_B }, create: {} })),
      ).rejects.toThrow(/refusing to query/);
    });

    it('passes a non-literal filter through — only platform admins build those, and they skip scope', async () => {
      // `{ tenantId: { in: [...] } }` cannot be produced by a route parameter.
      const called = await runAsTenant(
        makeParams('Booking', 'findMany', { where: { tenantId: { in: [TENANT_A, TENANT_B] } } }),
      );
      expect(called.args.where).toEqual({ tenantId: { in: [TENANT_A, TENANT_B] } });
    });

    it('still lets an intentional cross-tenant query through runUnscoped()', async () => {
      const called = await context.runUnscoped(async () => {
        await middleware(
          makeParams('Booking', 'findMany', { where: { tenantId: TENANT_B } }),
          next,
        );
        return next.mock.calls[0][0];
      });
      expect(called.args.where).toEqual({ tenantId: TENANT_B });
    });
  });

  describe('findUnique on tenant-scoped model', () => {
    it('throws — caller should use findFirst', async () => {
      await expect(
        context.run({ tenantId: TENANT_A, skipScope: false }, async () => {
          await middleware(makeParams('Booking', 'findUnique', { where: { id: 'b1' } }), next);
        }),
      ).rejects.toThrow(/findUnique\(\) is not allowed/);
      expect(next).not.toHaveBeenCalled();
    });

    it('throws on findUniqueOrThrow too', async () => {
      await expect(
        context.run({ tenantId: TENANT_A, skipScope: false }, async () => {
          await middleware(
            makeParams('Booking', 'findUniqueOrThrow', { where: { id: 'b1' } }),
            next,
          );
        }),
      ).rejects.toThrow(/findUniqueOrThrow\(\) is not allowed/);
    });
  });

  describe('platform-global models pass through unchanged', () => {
    it.each(['Plan', 'tenants', 'BankAccount', 'plans', 'features'])(
      'leaves %s.findMany() args untouched',
      async (model) => {
        const called = await runAsTenant(
          makeParams(model, 'findMany', { where: { isActive: true } }),
        );
        // No tenantId injected because the model isn't scoped
        expect(called.args).toEqual({ where: { isActive: true } });
      },
    );
  });

  describe('snake_case scoping (subscriptions model)', () => {
    it('injects tenant_id (not tenantId) into where', async () => {
      const called = await runAsTenant(
        makeParams('subscriptions', 'findFirst', {
          where: { id: 'sub-1' },
        }),
      );
      expect(called.args.where).toEqual({
        id: 'sub-1',
        tenant_id: TENANT_A,
      });
      expect(called.args.where.tenantId).toBeUndefined();
    });
  });

  describe('scope opt-out', () => {
    it('runUnscoped() — no injection', async () => {
      await context.runUnscoped(async () => {
        await middleware(
          makeParams('Booking', 'findMany', { where: { status: 'confirmed' } }),
          next,
        );
      });
      expect(next.mock.calls[0][0].args).toEqual({
        where: { status: 'confirmed' },
      });
    });

    it('manual skipScope flag — no injection', async () => {
      await context.run({ tenantId: TENANT_A, skipScope: true }, async () => {
        await middleware(makeParams('Booking', 'findMany', {}), next);
      });
      expect(next.mock.calls[0][0].args).toEqual({});
    });
  });

  describe('no tenant context (cron / seed / REPL)', () => {
    it('passes through unchanged when no ALS frame is active', async () => {
      await middleware(makeParams('Booking', 'findMany', { where: { id: 'b1' } }), next);
      expect(next.mock.calls[0][0].args).toEqual({ where: { id: 'b1' } });
    });

    it('passes through when ALS frame has tenantId=null', async () => {
      await context.run({ tenantId: null, skipScope: false }, async () => {
        await middleware(makeParams('Booking', 'findMany', {}), next);
      });
      expect(next.mock.calls[0][0].args).toEqual({});
    });
  });

  describe('cross-tenant simulation (the actual W2 goal)', () => {
    it("user from tenant A asking for tenant B's row sees an empty filter", async () => {
      // Tenant A is logged in. Some attacker code calls findFirst with no
      // explicit tenantId, hoping to read a row whose ID belongs to tenant B.
      // After our injection, the query carries tenantId=A, so MySQL returns
      // zero rows even if the id exists for tenant B. (Verified at the SQL
      // layer by the integration test.)
      const params = makeParams('Booking', 'findFirst', {
        where: { id: 'tenant-B-private-booking-id' },
      });
      const called = await runAsTenant(params, TENANT_A);
      expect(called.args.where).toEqual({
        id: 'tenant-B-private-booking-id',
        tenantId: TENANT_A,
      });
    });

    it('explicit cross-tenant write is also caught', async () => {
      // Hypothetical "delete by id" with attacker-supplied id — auto-injection
      // adds tenantId=A so the row owned by tenant B is unreachable.
      const params = makeParams('Booking', 'delete', {
        where: { id: 'tenant-B-booking' },
      });
      const called = await runAsTenant(params, TENANT_A);
      expect(called.args.where).toEqual({
        id: 'tenant-B-booking',
        tenantId: TENANT_A,
      });
    });
  });
});
