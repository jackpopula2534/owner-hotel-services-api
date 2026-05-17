/**
 * @SkipTenantScope() — opt out of automatic tenantId injection.
 *
 * Apply this decorator to a controller or handler when the operation
 * legitimately needs to read or write across tenants:
 *
 *   • Platform-admin dashboards aggregating data from every tenant
 *   • Billing rollups for the parent company
 *   • Migration scripts and seed jobs
 *   • Public endpoints that don't have a `req.user` (handled by @Public too)
 *
 * Once applied, the {@link TenantContextInterceptor} sets `skipScope = true`
 * in the AsyncLocalStorage frame, and the Prisma extension stops auto-injecting
 * `tenantId` into `where` clauses for the duration of that request.
 *
 * ⚠️  Using this decorator removes a defense-in-depth layer. The handler is
 * now solely responsible for filtering by tenant if it needs to. Code review
 * any new use of this decorator carefully.
 *
 * @example
 *   @SkipTenantScope()
 *   @Roles('platform_admin')
 *   @Get('admin/all-tenants-revenue')
 *   getRevenueAcrossTenants() {
 *     return this.billing.aggregateAllTenants();
 *   }
 *
 * @see TenantContextInterceptor
 * @see createTenantScopedPrismaExtension
 */
import { SetMetadata } from '@nestjs/common';

export const SKIP_TENANT_SCOPE_KEY = 'skipTenantScope';

/**
 * Marks a route or controller as exempt from automatic tenantId filtering.
 *
 * @returns Decorator that sets the `skipTenantScope` metadata key
 */
export const SkipTenantScope = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_TENANT_SCOPE_KEY, true);
