import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY, UserRole } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  const createExecutionContext = (user: any = {}, handlerMeta: any = {}) => {
    const request = {
      user,
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('should allow access to public routes', () => {
    const context = createExecutionContext();

    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return true;
        if (key === ROLES_KEY) return undefined;
        return undefined;
      });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access when no roles are required', () => {
    const context = createExecutionContext({ role: 'user' });

    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY) return undefined;
        return undefined;
      });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access when user has no role', () => {
    const context = createExecutionContext({});

    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY) return ['admin'] as UserRole[];
        return undefined;
      });

    expect(guard.canActivate(context)).toBe(false);
  });

  it('should allow access when user has required role', () => {
    const context = createExecutionContext({ role: 'admin' });

    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY) return ['admin', 'manager'] as UserRole[];
        return undefined;
      });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access when user role not in required roles', () => {
    const context = createExecutionContext({ role: 'user' });

    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY) return ['admin'] as UserRole[];
        return undefined;
      });

    expect(guard.canActivate(context)).toBe(false);
  });
});




