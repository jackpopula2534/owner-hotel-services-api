import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_SYSTEM_KEY, SystemContext } from '../decorators/require-system.decorator';

/**
 * SystemGuard — enforces system-level access control.
 *
 * It reads the `systemContext` field from the JWT payload (set by AuthService.generateTokens)
 * and compares it against the required system declared via @RequireSystem().
 *
 * Rules:
 * - If no @RequireSystem() decorator → pass through (unrestricted)
 * - Platform admins bypass (isPlatformAdmin: true)
 * - POS launch tokens (posLaunch: true) are treated as systemContext='pos'
 * - Mismatch → 403 Forbidden
 *
 * IMPORTANT: This guard must be placed AFTER JwtAuthGuard so that request.user is populated.
 */
@Injectable()
export class SystemGuard implements CanActivate {
  private readonly logger = new Logger(SystemGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredSystem = this.reflector.getAllAndOverride<SystemContext | undefined>(
      REQUIRE_SYSTEM_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No system restriction on this endpoint
    if (!requiredSystem) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      this.logger.warn('SystemGuard: no user in request — JwtAuthGuard must run first');
      return false;
    }

    // Platform admins bypass all system restrictions
    if (user.isPlatformAdmin) return true;

    // Determine effective systemContext from the JWT payload
    // posLaunch tokens are always 'pos' context even if the field isn't set
    const effectiveSystem: SystemContext =
      (user.posLaunch ? 'pos' : user.systemContext) ?? 'main';

    if (effectiveSystem !== requiredSystem) {
      throw new ForbiddenException({
        code: 'WRONG_SYSTEM_CONTEXT',
        message:
          requiredSystem === 'main'
            ? 'This endpoint requires a main-dashboard session. Please log in via the hotel management portal.'
            : 'This endpoint requires a POS session. Please log in via the POS system.',
        requiredSystem,
        currentSystem: effectiveSystem,
      });
    }

    return true;
  }
}
