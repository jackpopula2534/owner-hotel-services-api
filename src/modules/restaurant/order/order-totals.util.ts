/**
 * The one place a restaurant bill is added up.
 *
 * Every path that writes an order's money columns (create, add/void an item,
 * apply a discount) must go through `calculateOrderTotals`. Before this existed
 * the arithmetic was copy-pasted in three places and had drifted apart, which is
 * how the VAT base ended up wrong on every bill the system has ever printed.
 *
 * ── VAT base ──────────────────────────────────────────────────────────────
 * Under the Revenue Code the taxable value of a sale is everything the seller
 * receives for it, and a service charge is part of that consideration — so VAT
 * is charged on food + service charge, not on food alone. A discount given at
 * the point of sale reduces the taxable value, so it comes off first.
 *
 *   net          = subtotal - discount
 *   serviceCharge = net x serviceRate%
 *   taxableBase  = net + serviceCharge
 *   taxAmount    = taxableBase x taxRate%
 *   total        = taxableBase + taxAmount
 *
 * Turning a charge off is expressed as a 0 rate, so a bill always stores what
 * it actually charged and a receipt printed a year later still reconciles even
 * if the outlet's policy has since changed.
 */

/** Money columns are DECIMAL(10,2) — keep every intermediate on the same grid. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface OrderTotalsInput {
  /** Sum of the non-cancelled line totals. */
  subtotal: number;
  /** Percentage, e.g. 7 for 7%. Pass 0 when the outlet is not VAT registered. */
  taxRate: number;
  /** Percentage, e.g. 10 for 10%. Pass 0 when the outlet takes no service charge. */
  serviceRate: number;
  /** Absolute baht taken off before service charge and VAT. */
  discount?: number;
}

export interface OrderTotals {
  subtotal: number;
  discount: number;
  serviceCharge: number;
  /** What VAT was actually charged on — surfaced so receipts can show it. */
  taxableBase: number;
  taxAmount: number;
  total: number;
}

export function calculateOrderTotals({
  subtotal,
  taxRate,
  serviceRate,
  discount = 0,
}: OrderTotalsInput): OrderTotals {
  const safeSubtotal = roundMoney(Math.max(0, toRate(subtotal)));
  // A discount can never exceed the bill: a negative net would hand the guest
  // negative VAT, which is a credit note, not a sale.
  const safeDiscount = roundMoney(Math.min(Math.max(0, toRate(discount)), safeSubtotal));
  const net = roundMoney(safeSubtotal - safeDiscount);

  const serviceCharge = roundMoney(net * (clampRate(serviceRate) / 100));
  const taxableBase = roundMoney(net + serviceCharge);
  const taxAmount = roundMoney(taxableBase * (clampRate(taxRate) / 100));
  const total = roundMoney(taxableBase + taxAmount);

  return {
    subtotal: safeSubtotal,
    discount: safeDiscount,
    serviceCharge,
    taxableBase,
    taxAmount,
    total,
  };
}

/**
 * Resolve the rates a new bill should be opened with.
 *
 * An explicit rate on the request wins (a manager waiving service charge for
 * one table), otherwise the outlet's configured policy applies, and a disabled
 * charge forces 0 no matter what rate is stored alongside the toggle.
 */
export interface OutletChargePolicy {
  vatEnabled?: boolean;
  vatRate?: unknown;
  serviceChargeEnabled?: boolean;
  serviceRate?: unknown;
}

export function resolveChargeRates(
  outlet: OutletChargePolicy | null | undefined,
  override: { taxRate?: number; serviceRate?: number } = {},
): { taxRate: number; serviceRate: number } {
  const vatEnabled = outlet?.vatEnabled ?? true;
  const serviceEnabled = outlet?.serviceChargeEnabled ?? true;

  const taxRate = vatEnabled
    ? clampRate(override.taxRate ?? toRate(outlet?.vatRate, DEFAULT_VAT_RATE))
    : 0;
  const serviceRate = serviceEnabled
    ? clampRate(override.serviceRate ?? toRate(outlet?.serviceRate, DEFAULT_SERVICE_RATE))
    : 0;

  return { taxRate, serviceRate };
}

export const DEFAULT_VAT_RATE = 7;
export const DEFAULT_SERVICE_RATE = 10;

/** Prisma hands Decimal columns over as strings; NaN here would poison a bill. */
function toRate(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** DECIMAL(5,2) tops out at 999.99, but a percentage outside 0–100 is a typo. */
function clampRate(value: unknown): number {
  return Math.min(100, Math.max(0, toRate(value)));
}
