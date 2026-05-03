/**
 * JwtAuthGuard — verifies that handlers/controllers decorated with
 * `@Public()` bypass JWT authentication. Without this support, public
 * endpoints (e.g. /coupons/preview, /coupons/public/active) would still
 * require a Bearer token, which breaks the unauthenticated pricing-page
 * flow.
 */
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

function makeContext(): ExecutionContext {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: jest.fn(() => ({
      getRequest: jest.fn(() => ({})),
      getResponse: jest.fn(),
    })),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
  });

  it('returns true immediately when @Public() metadata is set', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) =>
      key === IS_PUBLIC_KEY ? true : undefined,
    );
    const guard = new JwtAuthGuard(reflector);
    expect(guard.canActivate(makeContext())).toBe(true);
  });

  it('delegates to AuthGuard when @Public() is absent', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const guard = new JwtAuthGuard(reflector);
    // AuthGuard's canActivate may return a Promise/Observable — we only
    // care that it does NOT short-circuit to true.
    const superSpy = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
      .mockReturnValue(false as any);
    const result = guard.canActivate(makeContext());
    expect(superSpy).toHaveBeenCalled();
    expect(result).toBe(false);
  });
});
