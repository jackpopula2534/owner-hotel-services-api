/**
 * Tests for TenantGuard — blocks a request whose JWT tenantId disagrees with the
 * tenantId in the route.
 *
 * These run the guard inside a real Nest application, mounted exactly the way
 * AppModule mounts it: as a global APP_GUARD, with the controller's JwtAuthGuard
 * running BELOW it. That ordering is the whole bug. The previous version of this
 * file handed the guard a hand-built `request.user` — an object that never exists
 * at global-guard time — so every test passed while production was wide open.
 *
 * Regression guard: the bypass must key on the `isPlatformAdmin` JWT claim, not
 * on a role-name allowlist. `User.role` is an unconstrained String column and
 * `'admin'` is a documented legacy alias for a TENANT-level role.
 */
import { CanActivate, Controller, ExecutionContext, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Public } from '../decorators/public.decorator';
import { TenantGuard } from './tenant.guard';

const SECRET = 'tenant-guard-test-secret';

@Controller('hotels/:tenantId/secrets')
class VictimController {
  @Get()
  read() {
    return { leaked: true };
  }

  @Public()
  @Get('open')
  open() {
    return { public: true };
  }
}

/** Stands in for the controller-level JwtAuthGuard, which runs AFTER the global guard. */
class FakeJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: unknown }>();
    req.user = { tenantId: 'tenant-a', role: 'manager', isPlatformAdmin: false };
    return true;
  }
}

describe('TenantGuard', () => {
  let app: INestApplication;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: SECRET })],
      controllers: [VictimController],
      providers: [{ provide: APP_GUARD, useClass: TenantGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalGuards(new FakeJwtGuard());
    jwt = app.get(JwtService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const token = (claims: Record<string, unknown>) => jwt.sign(claims);

  const get = (path: string, bearer?: string) => {
    const req = request(app.getHttpServer()).get(path);
    return bearer ? req.set('Authorization', `Bearer ${bearer}`) : req;
  };

  describe('a tenant user cannot read another tenant', () => {
    it('blocks a cross-tenant URL param with 403 CROSS_TENANT_ACCESS', async () => {
      // The regression: before the fix this answered 200 {"leaked":true}. The guard
      // read request.user — undefined at global-guard time — and bailed out through
      // `if (!jwtTenantId) return true`, so it had never blocked a single request.
      const res = await get('/hotels/tenant-b/secrets', token({ tenantId: 'tenant-a' }));

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'CROSS_TENANT_ACCESS' });
    });

    it('blocks a cross-tenant query string', async () => {
      const res = await get('/hotels/tenant-a/secrets?tenantId=tenant-b', token({}));
      expect(res.status).toBe(403);
    });

    it('allows the caller into their own tenant', async () => {
      const res = await get('/hotels/tenant-a/secrets', token({ tenantId: 'tenant-a' }));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ leaked: true });
    });

    it('blocks a token carrying no tenant identity at all — fail closed', async () => {
      const res = await get('/hotels/tenant-b/secrets', token({ role: 'manager' }));
      expect(res.status).toBe(403);
    });

    // Each of these is a TENANT-level role. Only the isPlatformAdmin claim crosses.
    it.each([['admin'], ['tenant_admin'], ['owner'], ['manager']])(
      'does not accept role=%s as a cross-tenant pass',
      async (role) => {
        const res = await get('/hotels/tenant-b/secrets', token({ tenantId: 'tenant-a', role }));
        expect(res.status).toBe(403);
      },
    );

    it('lets a platform admin reach any tenant', async () => {
      const res = await get(
        '/hotels/tenant-b/secrets',
        token({ tenantId: null, role: 'platform_admin', isPlatformAdmin: true }),
      );
      expect(res.status).toBe(200);
    });
  });

  describe('it does not authenticate — JwtAuthGuard does', () => {
    it('passes a request with no Authorization header through', async () => {
      // Public webhooks carry a :tenantId and no token (POST /messaging/line/webhook/:tenantId).
      // Failing closed here would break them, and would answer 403 on a protected
      // route where the API must answer 401.
      const res = await get('/hotels/tenant-b/secrets');
      expect(res.status).toBe(200);
    });

    it('passes a forged or expired token through', async () => {
      const forged = new JwtService({ secret: 'not-the-real-secret' }).sign({
        tenantId: 'tenant-b',
      });
      const res = await get('/hotels/tenant-b/secrets', forged);
      expect(res.status).toBe(200);
    });

    it('passes a non-bearer Authorization header through', async () => {
      const res = await request(app.getHttpServer())
        .get('/hotels/tenant-b/secrets')
        .set('Authorization', 'Basic abc');
      expect(res.status).toBe(200);
    });
  });

  describe('routes with nothing to check', () => {
    it('skips a @Public route before the token is read', async () => {
      const res = await get('/hotels/tenant-b/secrets/open', token({ tenantId: 'tenant-a' }));
      expect(res.status).toBe(200);
    });

    it('never verifies a token on a route with no tenantId in the URL', () => {
      const verify = jest.fn();
      const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
      const guard = new TenantGuard(reflector, { verify } as unknown as JwtService);

      const context = {
        getType: () => 'http',
        getHandler: () => 'h',
        getClass: () => 'c',
        switchToHttp: () => ({
          getRequest: () => ({ headers: { authorization: 'Bearer x' }, params: {}, query: {} }),
        }),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(context)).toBe(true);
      expect(verify).not.toHaveBeenCalled();
    });

    it('is a no-op outside HTTP', () => {
      const guard = new TenantGuard(
        { getAllAndOverride: () => undefined } as unknown as Reflector,
        {} as unknown as JwtService,
      );

      expect(guard.canActivate({ getType: () => 'ws' } as unknown as ExecutionContext)).toBe(true);
    });
  });
});
