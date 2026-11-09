/**
 * Unit tests for env.validation — focus on the W1.7 hardening:
 *   1. Reject the historical leaked JWT_SECRET
 *   2. Reject placeholder strings from .env.example
 *   3. Reject ENCRYPTION_KEY that isn't exactly 64 hex chars
 *
 * NOTE: reflect-metadata must be loaded before class-validator decorators are
 * evaluated, hence the side-effect import on line 1. The app entry point pulls
 * it in via @nestjs/core, but Jest test files need to import it explicitly.
 */
import 'reflect-metadata';
import { validate } from './env.validation';

describe('env.validation', () => {
  // Minimum viable config — JWT/ENC override per test
  const baseConfig = {
    NODE_ENV: 'test',
    DB_HOST: 'localhost',
    DB_PORT: '3306',
    DB_USERNAME: 'root',
    DB_PASSWORD: 'devpassword',
    DB_DATABASE: 'hotel_services_db',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    PORT: '9011',
  };

  const validJwt = 'a'.repeat(128); // 128 hex chars
  const validEncKey = 'b'.repeat(64); // 64 hex chars

  describe('happy path', () => {
    it('accepts a fresh JWT_SECRET and ENCRYPTION_KEY', () => {
      expect(() =>
        validate({
          ...baseConfig,
          JWT_SECRET: validJwt,
          ENCRYPTION_KEY: validEncKey,
        }),
      ).not.toThrow();
    });
  });

  describe('JWT_SECRET hardening (W1.7)', () => {
    const LEAKED_JWT =
      '952b9e6b192d670b3ca46913f6bd825a614dcf5a5f1ccb1b40215359f726d250b2e92d5602086296b3e11d4d08274dcb12978379c9b3c7e8ecc196cf43f82448';

    it('rejects the historical leaked JWT_SECRET (rotated 2026-05-17)', () => {
      expect(() =>
        validate({
          ...baseConfig,
          JWT_SECRET: LEAKED_JWT,
          ENCRYPTION_KEY: validEncKey,
        }),
      ).toThrow(/known-leaked|rotated 2026-05-17/);
    });

    it('rejects __GENERATE_WITH__ placeholder from .env.example', () => {
      expect(() =>
        validate({
          ...baseConfig,
          JWT_SECRET: '__GENERATE_WITH__openssl_rand_hex_64__MUST_BE_128_CHARS__',
          ENCRYPTION_KEY: validEncKey,
        }),
      ).toThrow(/placeholder|generate a real one/i);
    });

    it('rejects too-short JWT_SECRET (< 64 chars)', () => {
      expect(() =>
        validate({
          ...baseConfig,
          JWT_SECRET: 'short',
          ENCRYPTION_KEY: validEncKey,
        }),
      ).toThrow(/at least 64 characters/);
    });
  });

  describe('ENCRYPTION_KEY validation', () => {
    it('rejects non-hex ENCRYPTION_KEY when provided', () => {
      expect(() =>
        validate({
          ...baseConfig,
          JWT_SECRET: validJwt,
          ENCRYPTION_KEY: 'g'.repeat(64), // 'g' is not hex
        }),
      ).toThrow(/64 hex chars/);
    });

    it('rejects wrong-length ENCRYPTION_KEY when provided', () => {
      expect(() =>
        validate({
          ...baseConfig,
          JWT_SECRET: validJwt,
          ENCRYPTION_KEY: 'a'.repeat(32), // only 32 chars
        }),
      ).toThrow(/64 hex chars/);
    });

    it('rejects replace_with_ placeholder ENCRYPTION_KEY', () => {
      expect(() =>
        validate({
          ...baseConfig,
          JWT_SECRET: validJwt,
          ENCRYPTION_KEY: 'replace_with_64_hex_chars_generated_by_crypto_randomBytes_32',
        }),
      ).toThrow();
    });

    it('allows missing ENCRYPTION_KEY in dev/test (with runtime warning)', () => {
      expect(() =>
        validate({
          ...baseConfig,
          NODE_ENV: 'development',
          JWT_SECRET: validJwt,
          // ENCRYPTION_KEY intentionally omitted — should be allowed in dev
        }),
      ).not.toThrow();
    });

    it('REQUIRES ENCRYPTION_KEY in production', () => {
      expect(() =>
        validate({
          ...baseConfig,
          NODE_ENV: 'production',
          JWT_SECRET: validJwt,
          // ENCRYPTION_KEY intentionally omitted — must fail in production
        }),
      ).toThrow(/REQUIRED when NODE_ENV=production/);
    });

    it('accepts ENCRYPTION_KEY in production when properly set', () => {
      expect(() =>
        validate({
          ...baseConfig,
          NODE_ENV: 'production',
          JWT_SECRET: validJwt,
          ENCRYPTION_KEY: validEncKey,
        }),
      ).not.toThrow();
    });
  });

  describe('DB_PASSWORD placeholder check', () => {
    it('rejects __REPLACE_ placeholder DB_PASSWORD', () => {
      expect(() =>
        validate({
          ...baseConfig,
          DB_PASSWORD: '__REPLACE_WITH_STRONG_DB_PASSWORD__',
          JWT_SECRET: validJwt,
          ENCRYPTION_KEY: validEncKey,
        }),
      ).toThrow(/placeholder/i);
    });
  });
});
