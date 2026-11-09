import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'crypto'; // Node.js built-in — no extra dependency
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

const MASKED_VALUE = '[MASKED]';
const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'password',
  'newpassword',
  'confirmpassword',
  'token',
  'refreshtoken',
  'accesstoken',
  'secret',
  'apikey',
  'nationalid',
  'passportnumber',
  'bankaccount',
  'bankaccountnumber',
  'socialsecurity',
  'taxid',
  'cardnumber',
  'cvv',
]);

const maskUrl = (url: string): string => {
  const [path, query] = url.split('?');
  if (!query) return url;

  const params = new URLSearchParams(query);
  params.forEach((_value, key) => {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      params.set(key, MASKED_VALUE);
    }
  });

  const maskedQuery = params.toString();
  return maskedQuery ? `${path}?${maskedQuery}` : path;
};

const maskMessage = (message: string): string => {
  return message.replace(
    /(password|token|refreshToken|accessToken|secret|apiKey|nationalId|passportNumber|bankAccount|socialSecurity|taxId)=([^&\s,}]+)/gi,
    (_match, key) => `${key}=${MASKED_VALUE}`,
  );
};

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, ip } = request;
    const safeUrl = maskUrl(url);
    const userId = request.user?.id ?? request.user?.userId ?? null;
    const start = Date.now();

    // Honour an upstream correlation ID (API gateway, load balancer) or generate one.
    // Storing it on the request object lets downstream services/logs read it too.
    const requestId: string = (request.headers['x-request-id'] as string) || randomUUID();
    request['requestId'] = requestId;

    return next.handle().pipe(
      tap({
        next: () => {
          const { statusCode } = context.switchToHttp().getResponse();
          this.logger.log(
            JSON.stringify({
              type: 'request',
              method,
              url: safeUrl,
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
        error: (err: {
          status?: number;
          statusCode?: number;
          response?: { statusCode?: number };
          message?: string;
        }) => {
          const statusCode: number =
            err?.status ?? err?.statusCode ?? err?.response?.statusCode ?? 500;
          const message = err?.message ?? String(err);
          this.logger.error(
            JSON.stringify({
              type: 'request',
              method,
              url: safeUrl,
              statusCode,
              durationMs: Date.now() - start,
              ip,
              userId,
              requestId,
              // Keep error.message for quick correlation; stack is in the filter log
              error: maskMessage(message),
            }),
          );
        },
      }),
    );
  }
}
