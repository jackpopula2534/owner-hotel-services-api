import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  success: boolean;
  data: T;
  timestamp: string;
  metadata?: any;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // Skip transformation for certain paths if needed (e.g., swagger docs handled by Nest automatically)
    if (request.url.includes('/api/docs')) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        const statusCode = context.switchToHttp().getResponse().statusCode;
        const timestamp = new Date().toISOString();

        // ── Pass-through guard ──────────────────────────────────────────────
        // Controllers that already build `{ success, data, meta? }` themselves
        // must NOT be re-wrapped — doing so creates a double-nesting that shifts
        // `data` down one level and breaks every paginated list endpoint.
        //
        // Detection: the return value has `success` as a boolean AND a `data`
        // field.  This is the convention used by every controller in this codebase
        // that calls `return { success: true, data }`.
        //
        // In that case we just attach the envelope meta (statusCode, timestamp)
        // and return as-is so the shape the frontend already expects is preserved.
        if (
          data !== null &&
          data !== undefined &&
          typeof data === 'object' &&
          typeof (data as Record<string, unknown>).success === 'boolean' &&
          'data' in (data as Record<string, unknown>)
        ) {
          return {
            ...(data as Record<string, unknown>),
            statusCode,
            timestamp,
          };
        }

        // ── Legacy / raw-return path ────────────────────────────────────────
        // For any controller that returns a raw object/array without pre-wrapping,
        // apply the original pagination-aware standardisation so old endpoints
        // are unaffected.
        return {
          success: true,
          statusCode,
          timestamp,
          // Standardize pagination structure into 'meta'
          ...(data && (data as Record<string, unknown>).data !== undefined
            ? {
                data: (data as Record<string, unknown>).data,
                meta: {
                  total: (data as Record<string, unknown>).total,
                  page: (data as Record<string, unknown>).page,
                  limit: (data as Record<string, unknown>).limit,
                  ...(((data as Record<string, unknown>).meta as Record<string, unknown>) || {}),
                },
              }
            : { data }),
        };
      }),
    );
  }
}
