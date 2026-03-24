import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'crypto'; // Node.js built-in — no extra dependency
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, ip } = request;
    const userId    = request.user?.id ?? request.user?.userId ?? null;
    const start     = Date.now();

    // Honour an upstream correlation ID (API gateway, load balancer) or generate one.
    // Storing it on the request object lets downstream services/logs read it too.
    const requestId: string =
      (request.headers['x-request-id'] as string) || randomUUID();
    request['requestId'] = requestId;

    return next.handle().pipe(
      tap({
        next: () => {
          const { statusCode } = context.switchToHttp().getResponse();
          this.logger.log(
            JSON.stringify({
              type:       'request',
              method,
              url,
              statusCode,
              durationMs: Date.now() - start,
              ip,
              userId,
              requestId,
            }),
          );
        },

        /**
         * In the error path the response has NOT yet been written — AllExceptionsFilter
         * writes the status after this tap.  We therefore derive the HTTP status from
         * the exception itself rather than from response.statusCode (which would still
         * be 200 at this point).
         *
         * AllExceptionsFilter already logs the full stack; here we only log the
         * timing + identity fields to avoid duplicate verbose output in production.
         */
        error: (err: any) => {
          const statusCode: number =
            err?.status ?? err?.statusCode ?? err?.response?.statusCode ?? 500;
          this.logger.error(
            JSON.stringify({
              type:       'request',
              method,
              url,
              statusCode,
              durationMs: Date.now() - start,
              ip,
              userId,
              requestId,
              // Keep error.message for quick correlation; stack is in the filter log
              error: err?.message ?? String(err),
            }),
          );
        },
      }),
    );
  }
}
