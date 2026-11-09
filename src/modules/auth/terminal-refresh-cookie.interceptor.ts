import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { Observable, from, mergeMap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { isSessionContext, setTerminalRefreshCookie } from './terminal-refresh-cookie';

const refreshTokenOf = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as { refreshToken?: unknown; data?: { refreshToken?: unknown } };
  const token = v.refreshToken ?? v.data?.refreshToken;
  return typeof token === 'string' && token.length > 0 ? token : undefined;
};

/**
 * Every response (AuthController, POST /tenants/switch) that carries a refresh
 * token minted for the main dashboard or a staff terminal (login, launch exchange, refresh) also sets that terminal's
 * httpOnly refresh cookie. The context comes from the token's own DB row, so a
 * new terminal endpoint is covered without touching this file. Main-dashboard
 * tokens get `ss_rt_main` the same way.
 */
@Injectable()
export class TerminalRefreshCookieInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      mergeMap((body) => from(this.attachCookie(res, body).then(() => body))),
    );
  }

  private async attachCookie(res: Response, body: unknown): Promise<void> {
    const token = refreshTokenOf(body);
    if (!token || res.headersSent) return;
    const row = await this.prisma.refreshToken.findUnique({
      where: { token },
      select: { systemContext: true },
    });
    if (row && isSessionContext(row.systemContext)) {
      setTerminalRefreshCookie(res, row.systemContext, token);
    }
  }
}
