/**
 * Startup environment validation using class-validator + class-transformer.
 *
 * Both packages are already installed as production dependencies via
 * @nestjs/common, so no new packages are needed.
 *
 * Usage in app.module.ts:
 *   ConfigModule.forRoot({ validate })
 *
 * If any required variable is missing or invalid the application will
 * throw at startup — preventing silent misconfiguration in production.
 */
import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  Max,
  MinLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  validateSync,
} from 'class-validator';

export enum NodeEnvironment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * Known-leaked / placeholder JWT secrets that MUST NOT be used in any
 * environment. The first entry is the historical value that was committed
 * to `.env.example` and rotated on 2026-05-17 (see GO_LIVE_PLAN.md W1.1).
 *
 * Anyone who clones the repo can derive valid tokens from these values, so
 * we hard-fail at boot to prevent accidental reuse on staging / production.
 */
const KNOWN_LEAKED_JWT_SECRETS: readonly string[] = [
  // Rotated 2026-05-17 — was the value committed in `.env.example` before W1
  '952b9e6b192d670b3ca46913f6bd825a614dcf5a5f1ccb1b40215359f726d250b2e92d5602086296b3e11d4d08274dcb12978379c9b3c7e8ecc196cf43f82448',
];

/**
 * Placeholder patterns from `.env.example` that indicate the operator forgot
 * to fill in a real value. Keeping these out of process.env prevents subtle
 * bugs where the app boots with literal placeholder strings.
 */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /^__REPLACE_/i,
  /^__GENERATE_WITH__/i,
  /^replace_with_/i,
  /^your-/i,
];

@ValidatorConstraint({ name: 'jwtSecretNotLeaked', async: false })
class JwtSecretNotLeakedConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    if (KNOWN_LEAKED_JWT_SECRETS.includes(value)) return false;
    if (PLACEHOLDER_PATTERNS.some((p) => p.test(value))) return false;
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    if (typeof args.value === 'string' && KNOWN_LEAKED_JWT_SECRETS.includes(args.value)) {
      return (
        'JWT_SECRET matches a known-leaked value (rotated 2026-05-17). ' +
        'Generate a new one with: openssl rand -hex 64'
      );
    }
    return (
      'JWT_SECRET looks like a placeholder from .env.example. ' +
      'Generate a real one with: openssl rand -hex 64'
    );
  }
}

@ValidatorConstraint({ name: 'notPlaceholder', async: false })
class NotPlaceholderConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return true; // optional fields handled separately
    return !PLACEHOLDER_PATTERNS.some((p) => p.test(value));
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} still contains a placeholder value from .env.example. Replace it before booting.`;
  }
}

export class EnvironmentVariables {
  @IsEnum(NodeEnvironment)
  @IsOptional()
  NODE_ENV: NodeEnvironment = NodeEnvironment.Development;

  // ── Database ─────────────────────────────────────────────────────────────
  @IsString()
  DB_HOST: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(65535)
  @IsOptional()
  DB_PORT: number = 3306;

  @IsString()
  DB_USERNAME: string;

  @IsString()
  @Validate(NotPlaceholderConstraint)
  DB_PASSWORD: string;

  @IsString()
  DB_DATABASE: string;

  // ── JWT ──────────────────────────────────────────────────────────────────
  /**
   * JWT signing secret.
   *
   * Required: 128 hex chars (64 bytes) — generated with `openssl rand -hex 64`.
   *
   * Hard rules enforced at boot:
   *   1. Length ≥ 64 chars (legacy floor; new keys must be 128)
   *   2. NOT the value committed to .env.example before 2026-05-17 rotation
   *   3. NOT a placeholder string like `__GENERATE_WITH__…`
   *
   * Rotating this secret invalidates every existing JWT — coordinate with
   * the frontend (force-logout) when rotating on production.
   */
  @IsString()
  @MinLength(64, {
    message:
      'JWT_SECRET must be at least 64 characters (recommended 128). Generate with: openssl rand -hex 64',
  })
  @Validate(JwtSecretNotLeakedConstraint)
  JWT_SECRET: string;

  @IsString()
  @IsOptional()
  JWT_EXPIRES_IN: string = '7d';

  // ── Redis ─────────────────────────────────────────────────────────────────
  @IsString()
  @IsOptional()
  REDIS_HOST: string = 'localhost';

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  REDIS_PORT: number = 6379;

  // ── App ──────────────────────────────────────────────────────────────────
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  PORT: number = 9011;

  // ── PDPA Encryption (S1-04) ───────────────────────────────────────────────
  /**
   * AES-256-GCM key for sensitive PDPA fields (nationalId, passport, bankAccount).
   * Must be exactly 64 hex chars (32 bytes). Generate with: openssl rand -hex 32
   *
   * Required in production, optional in dev/test. The conditional enforcement
   * happens in the {@link validate} function below — because class-validator
   * cannot read other fields' values from a decorator, we apply this rule
   * imperatively after the standard schema check passes.
   *
   * ⚠️ Rotating this key on production requires a re-encryption migration —
   * do NOT rotate without a migration plan, otherwise existing encrypted rows
   * become permanently undecryptable.
   */
  @IsString()
  @IsOptional()
  @Matches(/^[0-9a-fA-F]{64}$/, {
    message:
      'ENCRYPTION_KEY must be exactly 64 hex chars (32 bytes). Generate with: openssl rand -hex 32',
  })
  @Validate(NotPlaceholderConstraint)
  ENCRYPTION_KEY?: string;

  // ── Payment webhook signing secrets ───────────────────────────────────────
  /**
   * Shared secret used to verify the HMAC-SHA256 signature on inbound
   * PromptPay payment webhooks (header `x-promptpay-signature`).
   * Required in production — without it the webhook cannot be trusted and
   * the service rejects all calls (fail-closed). Optional in dev/test.
   */
  @IsString()
  @IsOptional()
  PROMPTPAY_WEBHOOK_SECRET?: string;
}

/**
 * Passed to ConfigModule.forRoot({ validate }).
 * Throws a descriptive error at startup if validation fails.
 *
 * @param config - Raw environment variables loaded from .env
 * @returns Validated, typed config object
 * @throws Error if any required variable is missing, malformed, or matches a
 *         known-leaked / placeholder value
 */
export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: true,
  });

  if (errors.length > 0) {
    const messages = errors
      .flatMap((e) => Object.values(e.constraints ?? {}))
      .map((m) => `  • ${m}`)
      .join('\n');
    throw new Error(
      `\n┌────────────────────────────────────────────────────────────────┐\n` +
        `│  [Config] Environment validation FAILED — refusing to start    │\n` +
        `└────────────────────────────────────────────────────────────────┘\n` +
        `${messages}\n\n` +
        `Fix your .env file and try again. See .env.example for required keys.\n`,
    );
  }

  // ── Conditional rule: ENCRYPTION_KEY is REQUIRED in production ──────────
  // We enforce this after the schema check because class-validator decorators
  // cannot read other fields' values directly. In dev/test the encryption
  // service falls back to a zero-buffer key (with a runtime warning), which
  // is acceptable for local work but is a PDPA violation in production.
  if (validated.NODE_ENV === NodeEnvironment.Production && !validated.ENCRYPTION_KEY) {
    throw new Error(
      `\n┌────────────────────────────────────────────────────────────────┐\n` +
        `│  [Config] ENCRYPTION_KEY is REQUIRED when NODE_ENV=production  │\n` +
        `└────────────────────────────────────────────────────────────────┘\n` +
        `  • Generate one with: openssl rand -hex 32\n` +
        `  • Add to your production .env: ENCRYPTION_KEY=<64-hex-chars>\n` +
        `  • Without this, PDPA-sensitive fields ship to MySQL UNENCRYPTED.\n`,
    );
  }

  return validated;
}
