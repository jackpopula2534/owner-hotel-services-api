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
  Min,
  Max,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnvironment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
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
  DB_PASSWORD: string;

  @IsString()
  DB_DATABASE: string;

  // ── JWT ──────────────────────────────────────────────────────────────────
  @IsString()
  @MinLength(32, {
    message: 'JWT_SECRET must be at least 32 characters for security',
  })
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
}

/**
 * Passed to ConfigModule.forRoot({ validate }).
 * Throws a descriptive error at startup if validation fails.
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
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('\n  ');
    throw new Error(
      `[Config] Environment validation failed:\n  ${messages}\n\nCheck your .env file.`,
    );
  }

  return validated;
}
