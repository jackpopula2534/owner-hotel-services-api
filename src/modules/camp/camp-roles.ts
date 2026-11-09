import type { UserRole } from '../../common/decorators/roles.decorator';

/**
 * Who may do what in the campground module — one list for every camp controller.
 *
 * Master data (campground, zones & prices, pitches, facilities, rental catalogue,
 * map layout) is configured by the owner / a manager, normally from the Owner
 * Console. Front-line camp staff run the day: bookings, check-in/out, payments,
 * stock requisitions — and can read everything they need for that.
 *
 * `camp_manager` / `camp_staff` are the Camp Terminal roles granted through
 * tenant-users (terminal-registry.ts). They are not ranked in ROLE_LEVELS, so
 * they get in by exact match only and inherit nothing else.
 */
const MANAGERS: UserRole[] = ['platform_admin', 'admin', 'tenant_admin', 'manager', 'owner'];

/** Read campground data (lists, map, dashboard). */
export const CAMP_READ_ROLES: UserRole[] = [...MANAGERS, 'staff', 'user', 'camp_manager', 'camp_staff'];

/** Change master data: campgrounds, zones & prices, pitches, facilities, rentals, map. */
export const CAMP_MASTER_WRITE_ROLES: UserRole[] = [...MANAGERS, 'camp_manager'];

/** Daily operations: reservations, check-in/out, payments, requisitions. */
export const CAMP_OPS_WRITE_ROLES: UserRole[] = [...MANAGERS, 'staff', 'camp_manager', 'camp_staff'];
