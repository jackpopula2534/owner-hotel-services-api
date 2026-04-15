import { SetMetadata } from '@nestjs/common';
import { AddonCode } from '@/modules/addons/addon.service';

export const REQUIRE_ADDON_KEY = 'require_addon';

/**
 * Marks an endpoint as requiring a specific add-on subscription.
 * Must be used together with AddonGuard.
 *
 * @example
 * @UseGuards(JwtAuthGuard, AddonGuard)
 * @RequireAddon('POS_MODULE')
 * @Post()
 * createOrder() { ... }
 */
export const RequireAddon = (addonCode: AddonCode) => SetMetadata(REQUIRE_ADDON_KEY, addonCode);
