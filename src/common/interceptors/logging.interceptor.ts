import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, ip } = request;
    const user = request.user;
    const userId = user?.id || user?.userId || null;

    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        const { statusCode } = response;
        const delay = Date.now() - now;

        // Basic structured log
        // ใน production สามารถเปลี่ยนเป็น logger จริงจังเช่น pino/winston ได้
        // หรือส่งไปที่ external log system
        console.log(
          JSON.stringify({
            level: 'info',
            type: 'http',
            method,
            url,
            statusCode,
            durationMs: delay,
            ip,
            userId,
            timestamp: new Date().toISOString(),
          }),
        );
      }),
    );
  }
}




