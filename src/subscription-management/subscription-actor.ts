/**
 * The authenticated caller, as attached to `req.user` by JwtStrategy.
 *
 * `isPlatformAdmin` is derived from the table the account authenticated against,
 * not from `role` — never widen an ownership check to accept a role name here.
 */
export interface SubscriptionActor {
  tenantId?: string;
  isPlatformAdmin?: boolean;
}
