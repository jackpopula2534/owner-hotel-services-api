/**
 * Short-lived proof that a QR-ordering guest identified themselves
 * (audit 2026-11-09 M1).
 *
 * Before: the public guest lookup matched 2+ characters of a name and returned
 * the guest's id, and the public order endpoint trusted any `guestId` → anyone
 * holding the table QR could list in-house guests' names and get their discount.
 *
 * Now: lookup needs exact first + last name + last 4 phone digits, and returns
 * this token instead of the id. The order endpoint only accepts the token, bound
 * to one restaurant + tenant, valid for TTL_SECONDS. HMAC-SHA256 with a key
 * derived from JWT_SECRET (domain-separated, so it can never pass as a JWT).
 */
import { createHmac, timingSafeEqual } from 'crypto';

export const QR_GUEST_TOKEN_TTL_SECONDS = 2 * 60 * 60;

export interface QrGuestClaims {
  guestId: string;
  restaurantId: string;
  tenantId: string;
}

interface Payload extends QrGuestClaims {
  exp: number; // unix seconds
}

const keyFrom = (secret: string) => createHmac('sha256', secret).update('qr-guest-token:v1').digest();

const b64url = (buf: Buffer) => buf.toString('base64url');

export function signQrGuestToken(
  claims: QrGuestClaims,
  secret: string,
  nowMs: number = Date.now(),
): string {
  if (!secret) throw new Error('qr-guest-token: missing secret');
  const payload: Payload = { ...claims, exp: Math.floor(nowMs / 1000) + QR_GUEST_TOKEN_TTL_SECONDS };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', keyFrom(secret)).update(body).digest());
  return `${body}.${sig}`;
}

/** Returns the claims, or null when the token is malformed, forged, expired or for another restaurant. */
export function verifyQrGuestToken(
  token: string | undefined | null,
  expect: { restaurantId: string; tenantId: string },
  secret: string,
  nowMs: number = Date.now(),
): QrGuestClaims | null {
  if (!token || typeof token !== 'string' || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = createHmac('sha256', keyFrom(secret)).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || payload.exp * 1000 < nowMs) return null;
  if (payload.restaurantId !== expect.restaurantId || payload.tenantId !== expect.tenantId) return null;
  if (typeof payload.guestId !== 'string' || !payload.guestId) return null;
  return { guestId: payload.guestId, restaurantId: payload.restaurantId, tenantId: payload.tenantId };
}

/** Last 4 digits of a phone number, ignoring spaces / dashes / +66. */
export function phoneLast4(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}
