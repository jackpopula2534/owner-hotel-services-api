/**
 * Purchase Order Calculation Module
 * ---------------------------------------------------------------
 * Pure, side-effect-free math for purchase order totals that
 * supports:
 *
 *   - Line-level discounts: percentage OR fixed amount
 *   - Header-level discount: percentage OR fixed amount (applied
 *     on top of the subtotal after all line discounts)
 *   - VAT mode switch:
 *         BEFORE_VAT  (default) — discounts reduce VAT base
 *         AFTER_VAT              — VAT computed first on gross;
 *                                  discounts applied post-tax
 *   - Full step-by-step breakdown useful for audit logging /
 *     persisting as JSON on the PurchaseOrder row.
 *
 * All monetary values are rounded to 2 decimal places on output
 * but intermediate math is kept as floats — callers that need
 * strict Decimal precision should convert before persisting.
 *
 * This module is intentionally framework-agnostic so the same
 * logic can be shared across NestJS services, unit tests, and
 * (with a tsconfig import) Next.js front-end components.
 */

export type DiscountMode = 'BEFORE_VAT' | 'AFTER_VAT';
export type DiscountType = 'PERCENT' | 'AMOUNT';

export const DEFAULT_DISCOUNT_MODE: DiscountMode = 'BEFORE_VAT';

export interface LineInput {
  quantity: number;
  unitPrice: number;
  /** Percent (0-100) OR absolute amount depending on discountType */
  discountValue?: number;
  discountType?: DiscountType;
  /** VAT rate as percent (e.g. 7 for 7%). Defaults to 0 */
  taxRate?: number;
}

export interface LineBreakdown {
  /** quantity * unitPrice */
  gross: number;
  /** Absolute amount of the line discount in currency */
  discountAmount: number;
  /** gross - discountAmount */
  netAfterLineDiscount: number;
  /** VAT amount attributed to this line (mode-aware) */
  vatAmount: number;
  /** Final line total including VAT */
  lineTotal: number;
  discountType: DiscountType;
  discountValue: number;
  taxRate: number;
}

export interface HeaderDiscountInput {
  value?: number;
  type?: DiscountType;
}

export interface CalculationInput {
  lines: LineInput[];
  headerDiscount?: HeaderDiscountInput;
  discountMode?: DiscountMode;
}

export interface CalculationBreakdown {
  /** Sum of all line gross values (qty * price) */
  subtotal: number;
  /** Sum of all line-level discounts in currency */
  totalLineDiscount: number;
  /** Subtotal after line discounts, before header discount */
  subtotalAfterLineDiscount: number;
  /** Absolute header discount applied in currency */
  headerDiscountAmount: number;
  /** Subtotal after both line + header discount */
  netBeforeTax: number;
  /** Base used to compute VAT (mode-aware) */
  vatBase: number;
  /** Total VAT across all lines */
  vatAmount: number;
  /** Final payable: netBeforeTax + vatAmount (BEFORE_VAT mode)
   *  or grossWithTax - discounts (AFTER_VAT mode) */
  grandTotal: number;
  discountMode: DiscountMode;
  headerDiscountType: DiscountType;
  headerDiscountValue: number;
  lines: LineBreakdown[];
}

const round2 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
};

const clampNonNegative = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 0;

const computeLineDiscountAmount = (
  gross: number,
  discountType: DiscountType,
  discountValue: number,
): number => {
  if (gross <= 0 || discountValue <= 0) return 0;
  if (discountType === 'PERCENT') {
    const clampedPct = Math.min(Math.max(discountValue, 0), 100);
    return gross * (clampedPct / 100);
  }
  // AMOUNT — cap at gross so line cannot go negative
  return Math.min(clampNonNegative(discountValue), gross);
};

const computeHeaderDiscountAmount = (base: number, type: DiscountType, value: number): number => {
  if (base <= 0 || value <= 0) return 0;
  if (type === 'PERCENT') {
    const pct = Math.min(Math.max(value, 0), 100);
    return base * (pct / 100);
  }
  return Math.min(clampNonNegative(value), base);
};

/**
 * Main entry point — calculates all totals + breakdown for a PO.
 *
 * For BEFORE_VAT mode (default, matches Thai tax practice):
 *   subtotal        = Σ gross
 *   lineDiscount    = Σ per-line discount
 *   headerDiscount  = applied on (subtotal - lineDiscount)
 *   vatBase         = netBeforeTax
 *   vat             = vatBase * line-weighted rate
 *   grandTotal      = netBeforeTax + vat
 *
 * For AFTER_VAT mode:
 *   vat is computed first on the gross subtotal; discounts then
 *   reduce the gross+tax total. Used in some legacy supplier
 *   agreements where VAT is stated on sticker price.
 */
export function calculatePurchaseOrderTotals(input: CalculationInput): CalculationBreakdown {
  const mode: DiscountMode = input.discountMode ?? DEFAULT_DISCOUNT_MODE;
  const headerType: DiscountType = input.headerDiscount?.type ?? 'AMOUNT';
  const headerValue = clampNonNegative(input.headerDiscount?.value ?? 0);

  // ── Step 1 — per-line gross + line-level discount ────────────
  const prelim = input.lines.map((line) => {
    const qty = clampNonNegative(line.quantity);
    const price = clampNonNegative(line.unitPrice);
    const gross = qty * price;
    const lineDiscountType: DiscountType = line.discountType ?? 'PERCENT';
    const lineDiscountValue = clampNonNegative(line.discountValue ?? 0);
    const discountAmount = computeLineDiscountAmount(gross, lineDiscountType, lineDiscountValue);
    const netAfterLineDiscount = gross - discountAmount;
    const taxRate = clampNonNegative(line.taxRate ?? 0);
    return {
      gross,
      discountAmount,
      netAfterLineDiscount,
      taxRate,
      lineDiscountType,
      lineDiscountValue,
    };
  });

  const subtotal = prelim.reduce((acc, l) => acc + l.gross, 0);
  const totalLineDiscount = prelim.reduce((acc, l) => acc + l.discountAmount, 0);
  const subtotalAfterLineDiscount = subtotal - totalLineDiscount;

  // ── Step 2 — header discount (applied on subtotalAfterLine) ──
  const headerDiscountAmount = computeHeaderDiscountAmount(
    subtotalAfterLineDiscount,
    headerType,
    headerValue,
  );
  const netBeforeTax = Math.max(subtotalAfterLineDiscount - headerDiscountAmount, 0);

  // ── Step 3 — pro-rate header discount across lines so each
  //            line's VAT base reflects its share. ─────────────
  const proRateWeight =
    subtotalAfterLineDiscount > 0 ? headerDiscountAmount / subtotalAfterLineDiscount : 0;

  const lines: LineBreakdown[] = prelim.map((l) => {
    const headerShare = l.netAfterLineDiscount * proRateWeight;
    const lineNet = Math.max(l.netAfterLineDiscount - headerShare, 0);

    let vatAmount = 0;
    let lineTotal = 0;
    if (mode === 'BEFORE_VAT') {
      // discount already applied — VAT computed on post-discount line net
      vatAmount = lineNet * (l.taxRate / 100);
      lineTotal = lineNet + vatAmount;
    } else {
      // AFTER_VAT: VAT from gross, then proportional discount reduces total
      const grossVat = l.gross * (l.taxRate / 100);
      const grossWithVat = l.gross + grossVat;
      const lineDiscountRatio = l.gross > 0 ? l.discountAmount / l.gross : 0;
      // headerShareRatio computed from pre-discount share of subtotal
      const headerShareRatio =
        subtotal > 0 ? (headerDiscountAmount * (l.gross / subtotal)) / (l.gross || 1) : 0;
      const totalDiscountRatio = Math.min(1, lineDiscountRatio + headerShareRatio);
      lineTotal = grossWithVat * (1 - totalDiscountRatio);
      vatAmount = grossVat * (1 - totalDiscountRatio);
    }

    return {
      gross: round2(l.gross),
      discountAmount: round2(l.discountAmount),
      netAfterLineDiscount: round2(l.netAfterLineDiscount),
      vatAmount: round2(vatAmount),
      lineTotal: round2(lineTotal),
      discountType: l.lineDiscountType,
      discountValue: l.lineDiscountValue,
      taxRate: l.taxRate,
    };
  });

  const vatAmount = lines.reduce((acc, l) => acc + l.vatAmount, 0);
  const vatBase = mode === 'BEFORE_VAT' ? netBeforeTax : subtotal;
  const grandTotal =
    mode === 'BEFORE_VAT'
      ? netBeforeTax + vatAmount
      : lines.reduce((acc, l) => acc + l.lineTotal, 0);

  return {
    subtotal: round2(subtotal),
    totalLineDiscount: round2(totalLineDiscount),
    subtotalAfterLineDiscount: round2(subtotalAfterLineDiscount),
    headerDiscountAmount: round2(headerDiscountAmount),
    netBeforeTax: round2(netBeforeTax),
    vatBase: round2(vatBase),
    vatAmount: round2(vatAmount),
    grandTotal: round2(grandTotal),
    discountMode: mode,
    headerDiscountType: headerType,
    headerDiscountValue: headerValue,
    lines,
  };
}
