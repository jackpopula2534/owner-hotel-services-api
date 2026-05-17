/**
 * Prisma `$use` middleware that auto-injects `tenantId` into every query
 * touching a tenant-scoped model.
 *
 * Design rationale (vs. `$extends`)
 * ---------------------------------
 * Prisma's modern `$extends` API returns a NEW client object that's separate
 * from the original. Migrating to it would require touching every NestJS
 * service that currently does `this.prisma.<model>.findFirst()` — about 76
 * files. With one developer on a six-week timeline, that's a non-starter for
 * Week 2.
 *
 * The legacy `$use` middleware mutates the existing PrismaClient in-place,
 * so the same `PrismaService` injection token is silently upgraded with the
 * tenant filter. Zero migration cost.
 *
 * Trade-off: `$use` is "soft-deprecated" in Prisma 5 (still supported, will
 * be removed in some future major). We accept this as a Week-2 trade and
 * track migration to `$extends` as post-launch work in GO_LIVE_PLAN.md.
 *
 * What this middleware does
 * -------------------------
 *   • READ ops    (findFirst, findUnique, findMany, count, aggregate, groupBy)
 *     → injects `params.args.where[tenantId] = currentTenantId`
 *   • WRITE-where (update, updateMany, delete, deleteMany)
 *     → injects `params.args.where[tenantId] = currentTenantId`
 *   • CREATE      (create) → injects `params.args.data[tenantId]`
 *   • createMany  → injects `tenantId` on every row that lacks it
 *   • upsert      → injects both where and create
 *   • findUnique  → throws a clear error (use findFirst instead)
 *
 * Opt-out
 * -------
 *   • TenantContextService.runUnscoped() — programmatic, e.g. for cron jobs
 *   • @SkipTenantScope() decorator — route-level (interceptor sets the flag)
 *   • Any model not in {@link TENANT_SCOPED_MODELS} — middleware does nothing
 *
 * @see TenantContextService
 * @see TENANT_SCOPED_MODELS
 */
import type { Prisma } from '@prisma/client';
import type { TenantContextService } from './tenant-context.service';
import { TENANT_SCOPED_MODELS, TenantScopeField } from './tenant-scoped-models';

const READ_OPS_WITH_WHERE = new Set<Prisma.PrismaAction>([
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const WRITE_OPS_WITH_WHERE = new Set<Prisma.PrismaAction>([
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

/**
 * Inject `field = tenantId` into a Prisma `where` clause. Preserves whatever
 * the caller already supplied; treats user-provided `field` as authoritative
 * (Prisma will throw if mismatched — fail closed).
 *
 * @param where - existing where (may be undefined / null)
 * @param field - column to set (`tenantId` or `tenant_id`)
 * @param tenantId - value to require
 */
function injectTenantWhere(
  where: Record<string, unknown> | undefined | null,
  field: TenantScopeField,
  tenantId: string,
): Record<string, unknown> {
  if (!where) return { [field]: tenantId };
  if (where[field] !== undefined) return where;
  return { ...where, [field]: tenantId };
}

/**
 * Set `tenantId` on a create payload unless the caller explicitly supplied it.
 *
 * @param data - create payload
 * @param field - column name
 * @param tenantId - default value
 */
function injectTenantCreate<T extends Record<string, unknown>>(
  data: T,
  field: TenantScopeField,
  tenantId: string,
): T {
  if (data[field] !== undefined) return data;
  return { ...data, [field]: tenantId };
}

/**
 * Build the Prisma middleware function. Closes over the {@link TenantContextService}
 * passed at construction time so it can read the current request's tenantId.
 *
 * Usage:
 *   prisma.$use(createTenantScopeMiddleware(tenantContext))
 *
 * @param tenantContext - service exposing current request's tenant identity
 * @returns Prisma middleware suitable for `$use`
 */
export function createTenantScopeMiddleware(
  tenantContext: TenantContextService,
): Prisma.Middleware {
  return async (params, next) => {
    // 1. Is this model tenant-scoped at all?
    const field = params.model
      ? (TENANT_SCOPED_MODELS[params.model] as TenantScopeField | undefined)
      : undefined;

    if (!field) {
      // Platform-global / nested / non-model raw query → pass through
      return next(params);
    }

    // 2. Has the caller (or a decorator) asked to skip?
    if (tenantContext.isScopeSkipped()) {
      return next(params);
    }

    // 3. Is there an active tenant context at all?
    const tenantId = tenantContext.getTenantId();
    if (!tenantId) {
      // Outside a request (seed, cron, REPL) — caller is responsible.
      // Production routes always have tenantId set by TenantContextInterceptor.
      return next(params);
    }

    // 4. findUnique can't accept extra non-unique columns in `where`. Reject
    // with a clear message rather than silently passing through (which would
    // bypass the tenant filter).
    if (params.action === 'findUnique' || params.action === 'findUniqueOrThrow') {
      const alternative =
        params.action === 'findUnique' ? 'findFirst' : 'findFirstOrThrow';
      throw new Error(
        `[TenantScope] ${params.action}() is not allowed on tenant-scoped model "${params.model}". ` +
          `Use ${alternative}({ where: { id, ${field} } }) so the tenant filter is enforced. ` +
          `If this query is intentionally cross-tenant, wrap the call in ` +
          `TenantContextService.runUnscoped() or annotate the route with @SkipTenantScope().`,
      );
    }

    // 5. Patch args based on the operation type
    if (
      READ_OPS_WITH_WHERE.has(params.action) ||
      WRITE_OPS_WITH_WHERE.has(params.action)
    ) {
      params.args = {
        ...params.args,
        where: injectTenantWhere(params.args?.where, field, tenantId),
      };
    } else if (params.action === 'create') {
      params.args = {
        ...params.args,
        data: injectTenantCreate(params.args?.data ?? {}, field, tenantId),
      };
    } else if (params.action === 'createMany') {
      const data = params.args?.data;
      const rows = Array.isArray(data) ? data : [data];
      params.args = {
        ...params.args,
        data: rows.map((row: Record<string, unknown>) =>
          injectTenantCreate(row ?? {}, field, tenantId),
        ),
      };
    } else if (params.action === 'upsert') {
      params.args = {
        ...params.args,
        where: injectTenantWhere(params.args?.where, field, tenantId),
        create: injectTenantCreate(
          params.args?.create ?? {},
          field,
          tenantId,
        ),
      };
    }
    // Unknown / future operation → pass through. New Prisma ops should be
    // added to one of the sets above and tested.

    return next(params);
  };
}
