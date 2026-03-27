import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class QueryLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('QueryPerformance');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url } = request;
    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;

        // Log slow API endpoints (which may indicate slow queries)
        if (duration > 500) {
          this.logger.warn(`Slow endpoint: ${method} ${url} - ${duration}ms`);
        }
      }),
    );
  }
}
