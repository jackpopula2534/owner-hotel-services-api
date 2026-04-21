import { SetMetadata } from '@nestjs/common';

export const SKIP_SUBSCRIPTION_CHECK_KEY = 'skipSubscriptionCheck';

/**
 * Skip subscription validation for this route/controller.
 * Use on: auth, health, billing, subscription management, admin, public endpoints
 */
export const SkipSubscriptionCheck = () => SetMetadata(SKIP_SUBSCRIPTION_CHECK_KEY, true);
