import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * PlatformAdminGuard — route is for the StaySync platform console only.
 *
 * Must run AFTER JwtAuthGuard (`@UseGuards(JwtAuthGuard, PlatformAdminGuard)`):
 * it reads `request.user`, which only JwtStrategy populates.
 *
 * Keys on the `isPlatformAdmin` claim ONLY — it is derived from the table the
 * account authenticated against. Never accept a role name here: `'admin'` is a
 * TENANT-level role, so a role allowlist would hand every hotel owner the
 * platform's powers.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: { isPlatformAdmin?: boolean } }>();
    if (request.user?.isPlatformAdmin === true) return true;

    throw new ForbiddenException({
      code: 'PLATFORM_ADMIN_REQUIRED',
      message: 'This action is restricted to platform administrators.',
    });
  }
}
