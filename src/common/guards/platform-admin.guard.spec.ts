import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard';

const contextFor = (user?: Record<string, unknown>): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('PlatformAdminGuard', () => {
  const guard = new PlatformAdminGuard();

  it('allows a token carrying the isPlatformAdmin claim', () => {
    expect(guard.canActivate(contextFor({ isPlatformAdmin: true, role: 'platform_admin' }))).toBe(true);
  });

  it.each([
    ['tenant admin role', { tenantId: 't1', role: 'admin', isPlatformAdmin: false }],
    ['role name without the claim', { tenantId: null, role: 'platform_admin' }],
    ['truthy non-boolean claim', { isPlatformAdmin: 'true' }],
    ['no user', undefined],
  ])('rejects %s', (_label, user) => {
    expect(() => guard.canActivate(contextFor(user as Record<string, unknown>))).toThrow(
      ForbiddenException,
    );
  });
});
