/**
 * Who may change a property's configuration from a terminal — payment accounts,
 * messaging integrations (LINE / Facebook), auto-reply templates (audit 2026-11-09 H1.3).
 * Front desk / housekeeping keep their day-to-day actions (take a payment, reply
 * to a chat) but cannot change where money goes or which channels are connected.
 * RolesGuard: exact match, else hierarchy floor = `manager` (80) — so front_desk (0),
 * housekeeper (40), waiter (50) are refused.
 */
export const MANAGER_WRITE_ROLES = [
  'platform_admin',
  'admin',
  'tenant_admin',
  'manager',
  'hotel_manager',
  'camp_manager',
] as const;
