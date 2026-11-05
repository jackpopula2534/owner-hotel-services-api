// =============================================================================
// Terminal refresh-token cookie (Test Report — Sub Systems, BUG-01 / TC-17)
//
// The six staff terminals (POS, purchasing, warehouse, hotel terminal,
// accounting, HR) used to persist access + refresh tokens in localStorage,
// readable by any script on the page. The browser now keeps only the user
// profile; the refresh token lives in an httpOnly cookie per terminal, scoped
// to /api/v1/auth, and a reload restores the session with
// POST /auth/refresh { context } — no token ever touches web storage.
//
// The main dashboard uses the same mechanism (`ss_rt_main`) — its JS-readable
// `hotel-auth-storage` cookie now carries only the profile the Next.js
// middleware routes on, never a token.
//
// One cookie per system so terminals stay independent (logging out of the POS
// never ends the warehouse session), mirroring RefreshToken.systemContext.
// =============================================================================

import type { CookieOptions, Request, Response } from 'express';

export const TERMINAL_CONTEXTS = [
  'pos',
  'procurement',
  'warehouse',
  'hotel-terminal',
  'accounting',
  'hr',
] as const;

export type TerminalContext = (typeof TERMINAL_CONTEXTS)[number];

/**
 * Every session that keeps its refresh token in an httpOnly cookie: the main
 * dashboard (`hotel-auth-storage` no longer carries tokens) + the six terminals.
 */
export const SESSION_CONTEXTS = ['main', ...TERMINAL_CONTEXTS] as const;

export type SessionContext = (typeof SESSION_CONTEXTS)[number];

export const isTerminalContext = (value: unknown): value is TerminalContext =>
  typeof value === 'string' && (TERMINAL_CONTEXTS as readonly string[]).includes(value);

export const isSessionContext = (value: unknown): value is SessionContext =>
  typeof value === 'string' && (SESSION_CONTEXTS as readonly string[]).includes(value);

export const refreshCookieName = (ctx: SessionContext): string => `ss_rt_${ctx}`;

/** Same lifetime as the refresh token row (auth.service generateTokens: 7 days). */
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Only the auth endpoints (refresh / logout) ever need to see it. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

type SameSite = 'lax' | 'strict' | 'none';

/** Public suffixes with two labels that StaySync is likely to be hosted under. */
const TWO_LABEL_SUFFIX = /^(co|ac|go|in|or|net|mi|com|org|edu|gov)\.[a-z]{2}$/;

/** Registrable domain ("site") of a URL — app.x.co.th and api.x.co.th → x.co.th. */
export function siteOf(url: string | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return null;
  if (host === 'localhost' || /^[\d.]+$/.test(host) || host.includes(':')) return host;
  const labels = host.split('.');
  const lastTwo = labels.slice(-2).join('.');
  const take = labels.length > 2 && TWO_LABEL_SUFFIX.test(lastTwo) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/**
 * SameSite for the refresh cookie.
 *  1. REFRESH_COOKIE_SAMESITE wins when set (lax | strict | none).
 *  2. Production: the web app (FRONTEND_URL) and the API (APP_BASE_URL) on
 *     different sites → 'none' (+ Secure), otherwise the browser would never
 *     send the cookie on the app's fetch to /auth/refresh and every reload
 *     would sign the user out.
 *  3. Otherwise 'lax' (same site: app.example.com + api.example.com, or dev).
 */
export function resolveSameSite(env: NodeJS.ProcessEnv = process.env): SameSite {
  const explicit = env.REFRESH_COOKIE_SAMESITE?.trim().toLowerCase();
  if (explicit === 'lax' || explicit === 'strict' || explicit === 'none') return explicit;
  if (env.NODE_ENV === 'production') {
    const app = siteOf(env.FRONTEND_URL);
    const api = siteOf(env.APP_BASE_URL);
    if (app && api && app !== api) return 'none';
  }
  return 'lax';
}

const sameSite = (): SameSite => resolveSameSite();

export const refreshCookieOptions = (): CookieOptions => {
  const site = sameSite();
  return {
    httpOnly: true,
    // SameSite=None is only accepted by browsers together with Secure.
    secure: process.env.NODE_ENV === 'production' || site === 'none',
    sameSite: site,
    path: REFRESH_COOKIE_PATH,
  };
};

export function setTerminalRefreshCookie(res: Response, ctx: SessionContext, token: string): void {
  res.cookie(refreshCookieName(ctx), token, { ...refreshCookieOptions(), maxAge: REFRESH_COOKIE_MAX_AGE_MS });
}

export function clearTerminalRefreshCookie(res: Response, ctx: SessionContext): void {
  res.clearCookie(refreshCookieName(ctx), refreshCookieOptions());
}

/** Reads one cookie from the raw header (the app does not mount cookie-parser). */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers?.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw) || undefined;
    } catch {
      return raw || undefined;
    }
  }
  return undefined;
}
