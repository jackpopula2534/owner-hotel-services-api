/**
 * Auth error catalog — centralises every error thrown by the auth module so:
 *
 *   1. Every error response carries a stable `code` (e.g. AUTH_INVALID_CREDENTIALS)
 *      that the frontend can map to a translation key without parsing English
 *      sentences.
 *
 *   2. The i18n key in `messageKey` is looked up by AllExceptionsFilter via the
 *      request's `Accept-Language` header so the default message in the response
 *      body comes out in the caller's language even if the frontend doesn't have
 *      its own translation yet.
 *
 *   3. NestJS HttpException subclasses accept either a string or an object as
 *      the response body. Passing the object preserves `code` + `messageKey`
 *      on the wire — see api-design.md (success/error envelope).
 *
 * Usage:
 *   throw AuthErrors.invalidCredentials();
 *   throw AuthErrors.emailAlreadyExists(email);
 *
 * Adding a new error:
 *   1. Add the key here.
 *   2. Add the translation to BOTH `src/i18n/translations/th.json` AND
 *      `src/i18n/translations/en.json` under `auth.<key>`.
 *   3. Add the matching frontend code in `lib/i18n/auth-error-map.ts` (parallel
 *      file in the frontend repo).
 */
import {
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

/**
 * Stable, machine-readable error codes for auth failures.
 * Prefix with AUTH_ so they don't collide with other modules.
 */
export const AUTH_ERROR_CODES = {
  INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  ACCOUNT_SUSPENDED: 'AUTH_ACCOUNT_SUSPENDED',
  ACCOUNT_EXPIRED: 'AUTH_ACCOUNT_EXPIRED',
  ACCOUNT_INACTIVE: 'AUTH_ACCOUNT_INACTIVE',
  ACCOUNT_NOT_ACTIVE: 'AUTH_ACCOUNT_NOT_ACTIVE',
  ACCOUNT_NOT_FOUND: 'AUTH_ACCOUNT_NOT_FOUND',
  EMAIL_ALREADY_EXISTS: 'AUTH_EMAIL_ALREADY_EXISTS',
  ADMIN_ENDPOINT_ONLY: 'AUTH_ADMIN_ENDPOINT_ONLY',
  NOT_AUTHORIZED_POS: 'AUTH_NOT_AUTHORIZED_POS',
  NOT_AUTHORIZED_PROCUREMENT: 'AUTH_NOT_AUTHORIZED_PROCUREMENT',
  NOT_AUTHORIZED_WAREHOUSE: 'AUTH_NOT_AUTHORIZED_WAREHOUSE',
  NOT_AUTHORIZED_HOTEL_TERMINAL: 'AUTH_NOT_AUTHORIZED_HOTEL_TERMINAL',
  NOT_AUTHORIZED_MAIN: 'AUTH_NOT_AUTHORIZED_MAIN',
  REFRESH_TOKEN_INVALID: 'AUTH_REFRESH_TOKEN_INVALID',
  REFRESH_TOKEN_EXPIRED: 'AUTH_REFRESH_TOKEN_EXPIRED',
  REFRESH_TOKEN_REVOKED: 'AUTH_REFRESH_TOKEN_REVOKED',
  RESET_TOKEN_INVALID: 'AUTH_RESET_TOKEN_INVALID',
  SESSION_CREATE_FAILED: 'AUTH_SESSION_CREATE_FAILED',
  TWO_FACTOR_INVALID: 'AUTH_TWO_FACTOR_INVALID',
  TWO_FACTOR_REQUIRED: 'AUTH_TWO_FACTOR_REQUIRED',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

/**
 * Body shape passed to HttpException constructors so AllExceptionsFilter
 * can extract { code, message } and i18n key.
 */
interface AuthErrorBody {
  /** Stable machine code — frontend uses this to pick a translation. */
  code: AuthErrorCode;
  /** i18n key inside `auth.*` namespace. */
  messageKey: string;
  /** English fallback message — used when i18n lookup misses. */
  message: string;
  /** Optional context (e.g. duplicate email value). Never include secrets. */
  details?: Record<string, unknown>;
}

/**
 * Factory: build the response body the filter will serialise.
 */
function body(
  code: AuthErrorCode,
  key: string,
  message: string,
  details?: Record<string, unknown>,
): AuthErrorBody {
  return { code, messageKey: `auth.${key}`, message, ...(details ? { details } : {}) };
}

export const AuthErrors = {
  invalidCredentials(): HttpException {
    return new UnauthorizedException(
      body(AUTH_ERROR_CODES.INVALID_CREDENTIALS, 'invalidCredentials', 'Invalid email or password'),
    );
  },

  accountSuspended(): HttpException {
    return new UnauthorizedException(
      body(
        AUTH_ERROR_CODES.ACCOUNT_SUSPENDED,
        'accountSuspended',
        'Your account has been suspended. Please contact your administrator.',
      ),
    );
  },

  accountExpired(): HttpException {
    return new UnauthorizedException(
      body(
        AUTH_ERROR_CODES.ACCOUNT_EXPIRED,
        'accountExpired',
        'Your account has expired. Please contact your administrator to renew.',
      ),
    );
  },

  accountInactive(): HttpException {
    return new UnauthorizedException(
      body(
        AUTH_ERROR_CODES.ACCOUNT_INACTIVE,
        'accountInactive',
        'Your account has been deactivated. Please contact your administrator.',
      ),
    );
  },

  accountNotActive(): HttpException {
    return new UnauthorizedException(
      body(AUTH_ERROR_CODES.ACCOUNT_NOT_ACTIVE, 'accountNotActive', 'Your account is not active.'),
    );
  },

  accountNotFound(): HttpException {
    return new UnauthorizedException(
      body(AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND, 'accountNotFound', 'Account not found.'),
    );
  },

  emailAlreadyExists(email?: string): HttpException {
    return new ConflictException(
      body(
        AUTH_ERROR_CODES.EMAIL_ALREADY_EXISTS,
        'emailAlreadyExists',
        'This email is already in use. Please use a different email or sign in.',
        email ? { email } : undefined,
      ),
    );
  },

  adminEndpointOnly(): HttpException {
    return new UnauthorizedException(
      body(
        AUTH_ERROR_CODES.ADMIN_ENDPOINT_ONLY,
        'adminEndpointOnly',
        'Admin accounts cannot log in here. Please use the admin sign-in page.',
      ),
    );
  },

  notAuthorizedForSystem(
    system: 'pos' | 'procurement' | 'warehouse' | 'hotel-terminal' | 'main',
  ): HttpException {
    const map = {
      pos: {
        code: AUTH_ERROR_CODES.NOT_AUTHORIZED_POS,
        key: 'notAuthorizedPos',
        en: 'This account is not authorized to access the POS system. Please use a POS staff account.',
      },
      procurement: {
        code: AUTH_ERROR_CODES.NOT_AUTHORIZED_PROCUREMENT,
        key: 'notAuthorizedProcurement',
        en: 'This account is not authorized to access the Procurement system. Please contact your administrator.',
      },
      warehouse: {
        code: AUTH_ERROR_CODES.NOT_AUTHORIZED_WAREHOUSE,
        key: 'notAuthorizedWarehouse',
        en: 'This account is not authorized to access the Warehouse system. Please contact your administrator.',
      },
      'hotel-terminal': {
        code: AUTH_ERROR_CODES.NOT_AUTHORIZED_HOTEL_TERMINAL,
        key: 'notAuthorizedHotelTerminal',
        en: 'This account is not authorized to access the Hotel Management Terminal. Please contact your administrator.',
      },
      main: {
        code: AUTH_ERROR_CODES.NOT_AUTHORIZED_MAIN,
        key: 'notAuthorizedMain',
        en: 'This account is not authorized to access the management dashboard.',
      },
    } as const;
    const entry = map[system];
    return new UnauthorizedException(body(entry.code, entry.key, entry.en));
  },

  refreshTokenInvalid(): HttpException {
    return new UnauthorizedException(
      body(AUTH_ERROR_CODES.REFRESH_TOKEN_INVALID, 'refreshTokenInvalid', 'Invalid refresh token.'),
    );
  },

  refreshTokenExpired(): HttpException {
    return new UnauthorizedException(
      body(
        AUTH_ERROR_CODES.REFRESH_TOKEN_EXPIRED,
        'refreshTokenExpired',
        'Refresh token expired. Please sign in again.',
      ),
    );
  },

  refreshTokenRevoked(): HttpException {
    return new UnauthorizedException(
      body(
        AUTH_ERROR_CODES.REFRESH_TOKEN_REVOKED,
        'refreshTokenRevoked',
        'Refresh token has been revoked. Please sign in again.',
      ),
    );
  },

  resetTokenInvalid(): HttpException {
    return new BadRequestException(
      body(
        AUTH_ERROR_CODES.RESET_TOKEN_INVALID,
        'resetTokenInvalid',
        'Invalid or expired password reset link.',
      ),
    );
  },

  sessionCreateFailed(): HttpException {
    return new BadRequestException(
      body(
        AUTH_ERROR_CODES.SESSION_CREATE_FAILED,
        'sessionCreateFailed',
        'Could not create session. Please try again later.',
      ),
    );
  },

  twoFactorInvalid(): HttpException {
    return new UnauthorizedException(
      body(AUTH_ERROR_CODES.TWO_FACTOR_INVALID, 'twoFactorInvalid', 'Invalid 2FA code.'),
    );
  },

  twoFactorRequired(): HttpException {
    return new UnauthorizedException(
      body(
        AUTH_ERROR_CODES.TWO_FACTOR_REQUIRED,
        'twoFactorRequired',
        'Please enter your 2FA code.',
      ),
    );
  },

  /** For unknown statuses where the message itself is the best info we have. */
  unknown(message: string): HttpException {
    return new BadRequestException(
      body(AUTH_ERROR_CODES.SESSION_CREATE_FAILED, 'errors.generic', message),
    );
  },
} as const;

// Suppress unused imports lint — these are kept for clarity and future codes.
export type { NotFoundException, ForbiddenException };
export { HttpStatus };
