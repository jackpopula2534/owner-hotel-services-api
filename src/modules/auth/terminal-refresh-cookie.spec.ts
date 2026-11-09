import { refreshCookieOptions, resolveSameSite, siteOf } from './terminal-refresh-cookie';

describe('refresh cookie SameSite', () => {
  it.each([
    ['https://app.staysync.io', 'staysync.io'],
    ['https://api.staysync.io/api/v1', 'staysync.io'],
    ['https://app.hotel.co.th', 'hotel.co.th'],
    ['http://localhost:9010', 'localhost'],
    ['not a url', null],
  ])('siteOf(%s) = %s', (url, site) => expect(siteOf(url)).toBe(site));

  it('defaults to lax in development', () => {
    expect(resolveSameSite({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe('lax');
  });

  it('stays lax in production when app and API share a site', () => {
    expect(
      resolveSameSite({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://app.staysync.io',
        APP_BASE_URL: 'https://api.staysync.io',
      } as NodeJS.ProcessEnv),
    ).toBe('lax');
  });

  it('switches to none in production when app and API are on different sites', () => {
    expect(
      resolveSameSite({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://staysync.vercel.app',
        APP_BASE_URL: 'https://api.staysync.io',
      } as NodeJS.ProcessEnv),
    ).toBe('none');
  });

  it('REFRESH_COOKIE_SAMESITE always wins', () => {
    expect(
      resolveSameSite({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://a.com',
        APP_BASE_URL: 'https://b.com',
        REFRESH_COOKIE_SAMESITE: 'Strict',
      } as NodeJS.ProcessEnv),
    ).toBe('strict');
  });

  it('SameSite=None always comes with Secure', () => {
    const prev = process.env.REFRESH_COOKIE_SAMESITE;
    process.env.REFRESH_COOKIE_SAMESITE = 'none';
    try {
      expect(refreshCookieOptions()).toEqual(expect.objectContaining({ sameSite: 'none', secure: true, httpOnly: true }));
    } finally {
      if (prev === undefined) delete process.env.REFRESH_COOKIE_SAMESITE;
      else process.env.REFRESH_COOKIE_SAMESITE = prev;
    }
  });
});
