import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Standard JWT auth guard with one important addition: handlers (or
 * controllers) decorated with `@Public()` bypass authentication entirely.
 *
 * Without this support, `@UseGuards(JwtAuthGuard)` applied at the controller
 * level would also block routes intentionally exposed for unauthenticated
 * traffic (e.g. the public coupon preview / featured banner used by the
 * pricing page before a user logs in).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
