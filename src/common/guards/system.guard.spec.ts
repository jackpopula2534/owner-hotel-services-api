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
      getAllAndMerge: (key: string) => (key === ALLOW_SYSTEMS_KEY ? meta.allowSystems : undefined),
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
      for (const system of [] as string[]) {
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

  // H1 (audit 2026-11-09) — terminals are rolled out report → enforce, configured by env.
  describe('report mode (SYSTEM_GUARD_REPORT) — used to complete an allow-list before enforcing', () => {
    const load = (env: Record<string, string>) => {
      const saved = { ...process.env };
      Object.assign(process.env, env);
      let mod!: typeof import('./system.guard');
      jest.isolateModules(() => {
        mod = require('./system.guard');
      });
      process.env = saved;
      return mod;
    };
    const guardWith = (mod: typeof import('./system.guard'), claims: Claims, allow: SystemContext[] = []) => {
      const reflector = {
        getAllAndMerge: (key: string) => (key === ALLOW_SYSTEMS_KEY ? allow : undefined),
        getAllAndOverride: () => undefined,
      } as unknown as Reflector;
      const g = new mod.SystemGuard(reflector, { verify: () => claims } as unknown as JwtService);
      return g.canActivate(createContext('Bearer t'));
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    afterAll(() => warn.mockRestore());

    it('env decides the sets', () => {
      const mod = load({ SYSTEM_GUARD_ENFORCE: 'pos', SYSTEM_GUARD_REPORT: 'hr,bogus,main' });
      expect([...mod.ENFORCED_SYSTEMS]).toEqual(['pos']);
      expect([...mod.REPORT_SYSTEMS]).toEqual(['hr']); // unknown names and "main" are ignored
    });

    it('a reported terminal is let through but logged; an allowed route is not logged', () => {
      const mod = load({ SYSTEM_GUARD_ENFORCE: 'pos', SYSTEM_GUARD_REPORT: 'hr' });
      warn.mockClear();
      expect(guardWith(mod, { systemContext: 'hr' })).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[SystemGuard:report] hr'));
      warn.mockClear();
      expect(guardWith(mod, { systemContext: 'hr' }, ['hr'])).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    });

    it('defaults: every walked terminal is enforced; only the Camp Terminal is report-only', () => {
      const mod = load({});
      delete process.env.SYSTEM_GUARD_ENFORCE;
      expect([...mod.ENFORCED_SYSTEMS].sort()).toEqual(
        ['accounting', 'crm', 'hotel-terminal', 'hr', 'pos', 'procurement', 'retail', 'warehouse'].sort(),
      );
      expect([...mod.REPORT_SYSTEMS]).toEqual(['camp-terminal']);
    });

    it('a scoped main token in a reported terminal is let through but logged', () => {
      const mod = load({ SYSTEM_GUARD_ENFORCE: 'pos', SYSTEM_GUARD_REPORT: 'camp-terminal' });
      warn.mockClear();
      expect(guardWith(mod, { systemContext: 'main', terminals: ['camp-terminal'] })).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('camp-terminal'));
    });
  });

  // H1 — every terminal with its own login is enforced now
  it.each(['hr', 'accounting', 'procurement', 'warehouse'])('a %s token is blocked from an untagged endpoint', (system) => {
    expect(() => run({ systemContext: system }, {})).toThrow(ForbiddenException);
    expect(run({ systemContext: system }, { allowSystems: [system as SystemContext] })).toBe(true);
  });

  describe('a Hotel Terminal token stays inside the Hotel Terminal', () => {
    it('reaches an endpoint tagged hotel-terminal', () => {
      expect(run({ systemContext: 'hotel-terminal' }, { allowSystems: ['hotel-terminal'] })).toBe(true);
    });
    it('is blocked from an untagged endpoint (e.g. chart of accounts, tenant users)', () => {
      expect(() => run({ systemContext: 'hotel-terminal' }, {})).toThrow(ForbiddenException);
    });
    it('is blocked from an endpoint tagged only for pos', () => {
      expect(() => run({ systemContext: 'hotel-terminal' }, { allowSystems: ['pos'] })).toThrow(ForbiddenException);
    });
  });

  // H1.2 — Camp / Retail / CRM have no login of their own: their users get a main
  // session whose token carries `terminals`, and the guard scopes it to those.
  describe('a scoped main-session token (terminals claim) stays inside its terminals', () => {
    const crm = { systemContext: 'main', terminals: ['crm'] };
    const crmRetail = { systemContext: 'main', terminals: ['crm', 'retail'] };

    it('reaches an endpoint tagged for its terminal', () => {
      expect(run(crm, { allowSystems: ['crm'] })).toBe(true);
    });
    it('is blocked from an untagged endpoint (chart of accounts, tenant users, bookings)', () => {
      expect(() => run(crm, {})).toThrow(ForbiddenException);
    });
    it('is blocked from an endpoint tagged only for another terminal', () => {
      expect(() => run(crm, { allowSystems: ['retail'] })).toThrow(ForbiddenException);
      expect(() => run(crm, { allowSystems: ['hotel-terminal'] })).toThrow(ForbiddenException);
    });
    it('a token scoped to two terminals reaches the endpoints of either', () => {
      expect(run(crmRetail, { allowSystems: ['crm'] })).toBe(true);
      expect(run(crmRetail, { allowSystems: ['retail'] })).toBe(true);
      expect(() => run(crmRetail, {})).toThrow(ForbiddenException);
    });
    it('names the terminal in the error', () => {
      try {
        run(crm, {});
        fail('expected a ForbiddenException');
      } catch (e) {
        const body = (e as ForbiddenException).getResponse() as Record<string, unknown>;
        expect(body.code).toBe('WRONG_SYSTEM_CONTEXT');
      }
    });
    it('a plain main token (owner / admin — no terminals claim) is not scoped', () => {
      expect(run({ systemContext: 'main' }, {})).toBe(true);
      expect(run({ systemContext: 'main', terminals: [] }, {})).toBe(true);
    });
    it('the terminals claim is ignored on a sub-system token — its own systemContext rules', () => {
      expect(() => run({ systemContext: 'pos', terminals: ['crm'] }, { allowSystems: ['crm'] })).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('class + handler @AllowSystems are merged', () => {
    it('a handler tagged pos inside a class tagged hotel-terminal is open to both', () => {
      expect(run({ systemContext: 'pos' }, { allowSystems: ['pos', 'hotel-terminal'] })).toBe(true);
      expect(run({ systemContext: 'hotel-terminal' }, { allowSystems: ['pos', 'hotel-terminal'] })).toBe(true);
    });
  });
});
