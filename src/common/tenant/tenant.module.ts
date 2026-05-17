/**
 * TenantModule — wires up the multi-tenant safety net.
 *
 * Components
 * ----------
 *   • TenantContextService   — AsyncLocalStorage store for the current request's tenantId
 *   • TenantContextMiddleware — opens the ALS frame at the start of every HTTP request
 *   • TenantContextInterceptor — populates the store after JwtAuthGuard runs
 *
 * The interceptor is registered as a global APP_INTERCEPTOR so it fires for
 * every controller without each one having to opt in.
 *
 * `TenantContextService` is exported and re-exported by the `@Global()`
 * declaration so the PrismaService (which lives in another global module)
 * can inject it without an explicit import.
 *
 * @see TenantContextService
 * @see TenantContextMiddleware
 * @see TenantContextInterceptor
 */
import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TenantContextService } from './tenant-context.service';
import { TenantContextInterceptor } from './tenant-context.interceptor';
import { TenantContextMiddleware } from './tenant-context.middleware';

@Global()
@Module({
  providers: [
    TenantContextService,
    // The middleware is referenced by name in app.module's MiddlewareConsumer,
    // but it still needs to be a DI-managed provider so Nest can construct it
    // with its TenantContextService dependency.
    TenantContextMiddleware,
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
  ],
  exports: [TenantContextService, TenantContextMiddleware],
})
export class TenantModule {}
