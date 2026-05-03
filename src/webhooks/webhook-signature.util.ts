import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verify a webhook signature using HMAC-SHA256.
 *
 * Many gateways send the signature as a hex string in a header. We sign
 * the raw body with the gateway's shared secret and compare with
 * timingSafeEqual to prevent timing-attack leakage.
 *
 * Returns true on match. Returns false on mismatch or any structural
 * problem (bad hex, wrong length, missing inputs).
 */
export function verifyHmacSha256(
  rawBody: string | Buffer,
  signatureHex: string | undefined | null,
  secret: string,
): boolean {
  if (!signatureHex || !secret) return false;

  const expected = createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody)
    .digest();

  let received: Buffer;
  try {
    received = Buffer.from(signatureHex, 'hex');
  } catch {
    return false;
  }

  if (received.length !== expected.length) return false;
  try {
    return timingSafeEqual(received, expected);
  } catch {
    return false;
  }
}
