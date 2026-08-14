import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { SystemGuard } from './system.guard';
import { ALLOW_SYSTEMS_KEY, SystemContext } from '../decorators/allow-systems.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

type Claims = Record<string, unknown>;

/**
 * The guard never touches `request.user` — it decodes the bearer token itself,
 * because as a global guard it runs before any controller's JwtAuthGuard. These
 * tests therefore drive it with an Authorization header, not a user object.
 */
const createContext = (
  authorization: string | undefined,
  metadata: { allowSystems?: SystemContext[]; isPublic?: boolean } = {},
  type: 'http' | 'ws' = 'http',
): ExecutionContext =>
  ({
    getType: () => type,
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({
      getRequest: () => ({ headers: authorization ? { authorization } : {} }),
    }),
    __metadata: metadata,
  }) as unknown as ExecutionContext;

describe('SystemGuard', () => {
  let guard: SystemGuard;
  let verify: jest.Mock;

  const build = (context: ExecutionContext) => {
    const meta = (
      context as unknown as { __metadata: { allowSystems?: SystemContext[]; isPublic?: boolean } }
    ).__metadata;

    const reflector = {
      getAllAndOverride: (key: string) =>
        key === IS_PUBLIC_KEY
          ? meta.isPublic
          : key === ALLOW_SYSTEMS_KEY
            ? meta.allowSystems
            : undefined,
    } as unknown as Reflector;

    return new SystemGuard(reflector, { verify } as unknown as JwtService);
  };

  const run = (
    claims: Claims | Error | null,
    metadata: { allowSystems?: SystemContext[]; isPublic?: boolean } = {},
    opts: { authorization?: string; type?: 'http' | 'ws' } = {},
  ) => {
    verify = jest.fn(() => {
      if (claims instanceof Error) throw claims;
      return claims;
    });
    const authorization = 'authorization' in opts ? opts.authorization : 'Bearer token';
    const context = createContext(authorization, metadata, opts.type ?? 'http');
    guard = build(context);
    return guard.canActivate(context);
  };

  describe('a POS token stays inside the POS', () => {
    it('reaches an endpoint that allows pos', () => {
      expect(run({ systemContext: 'pos' }, { allowSystems: ['pos'] })).toBe(true);
    });

    it('is blocked from an endpoint with no @AllowSystems — this is the default', () => {
      // The whole point: every management endpoint in the API is undecorated, so a
      // token lifted off the floor tablet reaches none of them.
      expect(() => run({ systemContext: 'pos' }, {})).toThrow(ForbiddenException);
    });

    it('is blocked from an endpoint that allows only another sub-system', () => {
      expect(() => run({ systemContext: 'pos' }, { allowSystems: ['procurement'] })).toThrow(
        ForbiddenException,
      );
    });

    it('reports WRONG_SYSTEM_CONTEXT and the system it came from', () => {
      try {
        run({ systemContext: 'pos' }, {});
        fail('expected ForbiddenException');
      } catch (err) {
        // `details` specifically: AllExceptionsFilter forwards that key and
        // drops every other extra, so a top-level `currentSystem` would never
        // reach the browser that has to decide whether to log the user out.
        expect((err as ForbiddenException).getResponse()).toMatchObject({
          code: 'WRONG_SYSTEM_CONTEXT',
          details: { currentSystem: 'pos' },
        });
      }
    });

    it('a posLaunch deep-link token counts as pos even with no systemContext claim', () => {
      // generatePosLaunchToken() mints this from the dashboard carrying the manager's
      // role. Without this branch it would read as `main` and skip enforcement entirely.
      expect(() => run({ posLaunch: true, role: 'manager' }, {})).toThrow(ForbiddenException);
      expect(run({ posLaunch: true, role: 'manager' }, { allowSystems: ['pos'] })).toBe(true);
    });
  });

  describe('everything else passes through', () => {
    it('a main-dashboard token reaches an undecorated endpoint', () => {
      expect(run({ systemContext: 'main' }, {})).toBe(true);
    });

    it('a token with no systemContext claim is treated as main', () => {
      expect(run({ role: 'manager' }, {})).toBe(true);
    });

    it('a platform admin is not scoped to any terminal', () => {
      expect(run({ systemContext: 'pos', isPlatformAdmin: true }, {})).toBe(true);
    });

    it('a sub-system not yet in ENFORCED_SYSTEMS is untouched', () => {
      // procurement/warehouse/hr/accounting/hotel-terminal are deliberately not
      // enforced yet — their endpoints have not been enumerated. Locking them out
      // here would take down the back office.
      for (const system of ['procurement', 'warehouse', 'hr', 'accounting', 'hotel-terminal']) {
        expect(run({ systemContext: system as SystemContext }, {})).toBe(true);
      }
    });

    it('a public route is skipped before the token is even read', () => {
      expect(run({ systemContext: 'pos' }, { isPublic: true })).toBe(true);
      expect(verify).not.toHaveBeenCalled();
    });

    it('a websocket handler has no bearer token to read', () => {
      expect(run({ systemContext: 'pos' }, {}, { type: 'ws' })).toBe(true);
    });
  });

  describe('it does not authenticate — JwtAuthGuard does', () => {
    it('passes a request with no Authorization header through to JwtAuthGuard', () => {
      // Failing closed here would answer 403 where the API must answer 401.
      expect(run(null, {}, { authorization: undefined })).toBe(true);
    });

    it('passes a non-bearer Authorization header through', () => {
      expect(run(null, {}, { authorization: 'Basic abc' })).toBe(true);
    });

    it('passes an expired or forged token through', () => {
      expect(run(new Error('jwt expired'), {})).toBe(true);
    });
  });
});
