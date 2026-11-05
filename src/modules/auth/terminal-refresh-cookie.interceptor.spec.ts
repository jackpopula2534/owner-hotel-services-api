import { of, lastValueFrom } from 'rxjs';
import { TerminalRefreshCookieInterceptor } from './terminal-refresh-cookie.interceptor';

const ctxWith = (res: unknown) =>
  ({ switchToHttp: () => ({ getResponse: () => res }) }) as any;

describe('TerminalRefreshCookieInterceptor (BUG-01)', () => {
  const findUnique = jest.fn();
  const interceptor = new TerminalRefreshCookieInterceptor({ refreshToken: { findUnique } } as any);
  const run = async (body: unknown, res: any) =>
    lastValueFrom(interceptor.intercept(ctxWith(res), { handle: () => of(body) }));

  beforeEach(() => findUnique.mockReset());

  it('sets an httpOnly cookie scoped to /api/v1/auth for a terminal token', async () => {
    findUnique.mockResolvedValue({ systemContext: 'warehouse' });
    const res = { cookie: jest.fn(), headersSent: false };
    const body = { accessToken: 'a', refreshToken: 'wh-rt' };
    expect(await run(body, res)).toBe(body);
    expect(res.cookie).toHaveBeenCalledWith(
      'ss_rt_warehouse',
      'wh-rt',
      expect.objectContaining({ httpOnly: true, path: '/api/v1/auth', sameSite: 'lax' }),
    );
  });

  it('sets ss_rt_main for a main-dashboard token (enveloped response too)', async () => {
    findUnique.mockResolvedValue({ systemContext: 'main' });
    const res = { cookie: jest.fn(), headersSent: false };
    await run({ success: true, data: { refreshToken: 'main-rt' } }, res);
    expect(res.cookie).toHaveBeenCalledWith('ss_rt_main', 'main-rt', expect.objectContaining({ httpOnly: true }));
  });

  it('ignores an unknown context', async () => {
    findUnique.mockResolvedValue({ systemContext: 'supplier' });
    const res = { cookie: jest.fn(), headersSent: false };
    await run({ refreshToken: 'x' }, res);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('ignores responses without a refresh token', async () => {
    const res = { cookie: jest.fn(), headersSent: false };
    await run({ success: true }, res);
    expect(findUnique).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });
});
