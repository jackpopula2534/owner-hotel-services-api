/**
 * TenantContextMiddleware — wires the per-request tenant into AsyncLocalStorage.
 *
 * Pipeline
 * --------
 *   Express → LanguageMiddleware → TenantContextMiddleware → JwtAuthGuard → ...
 *
 * Because middleware runs BEFORE guards in NestJS, this middleware does NOT
 * have access to `req.user` yet (the JWT hasn't been decoded). Instead, it
 * opens an empty ALS frame so anywhere downstream can `run()` again with the
 * real value once the guard has populated `req.user`.
 *
 * The actual population happens in {@link TenantContextInterceptor} (NEXT
 * step), which runs AFTER JwtAuthGuard. This middleware just guarantees that
 * an ALS frame exists for the lifetime of the request, so getTenantId() never
 * returns `undefined` due to missing async-context tracking.
 *
 * Why split it across middleware + interceptor?
 * ---------------------------------------------
 * NestJS execution order:
 *   middleware → guards → interceptor (before) → handler → interceptor (after)
 * AsyncLocalStorage needs to wrap the WHOLE request flow. We can't `run()` in
 * the interceptor alone because the guards run inside the middleware's async
 * frame, not the interceptor's. So:
 *   - middleware:  als.run({tenantId: null, skipScope: false}, () => next())
 *   - interceptor: mutate the ALS store once req.user is available
 * AsyncLocalStorage stores are mutable objects, so we can patch the same
 * reference in-place from the interceptor.
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { TenantContextService, TenantContextStore } from './tenant-context.service';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly tenantContext: TenantContextService) {}

  /**
   * Open an AsyncLocalStorage frame for the request. The store is a mutable
   * object so the interceptor can populate `tenantId` after auth.
   *
   * @param req - Express request
   * @param _res - Express response (unused; required by signature)
   * @param next - downstream handler
   */
  use(req: Request, _res: Response, next: NextFunction): void {
    const store: TenantContextStore = {
      tenantId: null,
      skipScope: false,
    };

    // Expose for the interceptor — same object reference, mutated later
    (req as unknown as { __tenantStore?: TenantContextStore }).__tenantStore = store;

    this.tenantContext.run(store, () => next());
  }
}
