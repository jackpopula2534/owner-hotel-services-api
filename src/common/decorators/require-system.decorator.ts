import { SetMetadata } from '@nestjs/common';

export type SystemContext = 'main' | 'pos';

export const REQUIRE_SYSTEM_KEY = 'require_system';

/**
 * Decorator that restricts an endpoint to a specific system context.
 *
 * Usage:
 *   @RequireSystem('main')   — only users whose token was issued by the main dashboard
 *   @RequireSystem('pos')    — only users whose token was issued by the POS system
 *
 * The system context is embedded in the JWT payload (field: systemContext).
 * This prevents POS tokens from being used to call management-dashboard APIs
 * and management-dashboard tokens from being used to call POS-specific APIs.
 */
export const RequireSystem = (system: SystemContext) => SetMetadata(REQUIRE_SYSTEM_KEY, system);
