/**
 * Compare a PO being created against the supplier quote it was issued
 * from. A PO built from the winning quote must reproduce it; any
 * deviation (price, discount, quantity, items, header discount) is a
 * "variance" that requires a reason and is persisted for audit.
 *
 * VAT-inclusive quotes are compared after converting to ex-VAT the same
 * way the front-end does when it pre-fills the PO (2 dp rounding).
 */
import type { DiscountMode, DiscountType } from './po-calculation';

const EPS = 0.01;
const r2 = (v: number): number => Math.round(v * 100) / 100;
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface VarianceQuoteItem {
  itemId: string;
  quantity: number | string;
  unitPrice: number | string;
  discount: number | string;
  discountType?: DiscountType | string | null;
  taxRate: number | string;
}

export interface VarianceQuote {
  discountMode?: DiscountMode | string | null;
  headerDiscount?: number | string | null;
  headerDiscountType?: DiscountType | string | null;
  pricesIncludeVat?: boolean | null;
  items: VarianceQuoteItem[];
}

export interface VariancePoItem {
  itemId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  discountType?: DiscountType;
}

export interface VariancePo {
  discountMode?: DiscountMode;
  headerDiscount?: number;
  headerDiscountType?: DiscountType;
  items: VariancePoItem[];
}

export interface VarianceEntry {
  field:
    | 'item'
    | 'quantity'
    | 'unitPrice'
    | 'discount'
    | 'discountType'
    | 'headerDiscount'
    | 'discountMode';
  itemId?: string;
  quote: string | number | null;
  po: string | number | null;
}

export function detectQuoteVariance(quote: VarianceQuote, po: VariancePo): VarianceEntry[] {
  const out: VarianceEntry[] = [];
  const inclusive = quote.pricesIncludeVat === true;
  const factor = (rate: unknown): number => 1 + num(rate) / 100;

  const quoteById = new Map(quote.items.map((q) => [q.itemId, q]));
  const poIds = new Set(po.items.map((p) => p.itemId));

  for (const q of quote.items) {
    if (!poIds.has(q.itemId))
      out.push({ field: 'item', itemId: q.itemId, quote: 'present', po: null });
  }

  for (const p of po.items) {
    const q = quoteById.get(p.itemId);
    if (!q) {
      out.push({ field: 'item', itemId: p.itemId, quote: null, po: 'added' });
      continue;
    }
    const qType: DiscountType = q.discountType === 'AMOUNT' ? 'AMOUNT' : 'PERCENT';
    const pType: DiscountType = p.discountType ?? 'PERCENT';
    const qPrice = inclusive ? r2(num(q.unitPrice) / factor(q.taxRate)) : num(q.unitPrice);
    const qDisc =
      inclusive && qType === 'AMOUNT' ? r2(num(q.discount) / factor(q.taxRate)) : num(q.discount);

    if (num(q.quantity) !== num(p.quantity)) {
      out.push({
        field: 'quantity',
        itemId: p.itemId,
        quote: num(q.quantity),
        po: num(p.quantity),
      });
    }
    if (Math.abs(qPrice - num(p.unitPrice)) > EPS) {
      out.push({ field: 'unitPrice', itemId: p.itemId, quote: qPrice, po: num(p.unitPrice) });
    }
    if (qType !== pType) {
      out.push({ field: 'discountType', itemId: p.itemId, quote: qType, po: pType });
    } else if (Math.abs(qDisc - num(p.discount ?? 0)) > EPS) {
      out.push({ field: 'discount', itemId: p.itemId, quote: qDisc, po: num(p.discount ?? 0) });
    }
  }

  const qHeaderType: DiscountType = quote.headerDiscountType === 'PERCENT' ? 'PERCENT' : 'AMOUNT';
  const pHeaderType: DiscountType = po.headerDiscountType ?? 'AMOUNT';
  const firstRate = quote.items[0]?.taxRate ?? 7;
  const qHeader =
    inclusive && qHeaderType === 'AMOUNT'
      ? r2(num(quote.headerDiscount) / factor(firstRate))
      : num(quote.headerDiscount);
  const pHeader = num(po.headerDiscount ?? 0);
  if (qHeader > 0 || pHeader > 0) {
    if (qHeaderType !== pHeaderType || Math.abs(qHeader - pHeader) > EPS) {
      out.push({
        field: 'headerDiscount',
        quote: `${qHeader}${qHeaderType === 'PERCENT' ? '%' : ''}`,
        po: `${pHeader}${pHeaderType === 'PERCENT' ? '%' : ''}`,
      });
    }
  }

  const qMode: DiscountMode =
    !inclusive && quote.discountMode === 'AFTER_VAT' ? 'AFTER_VAT' : 'BEFORE_VAT';
  const pMode: DiscountMode = po.discountMode ?? 'BEFORE_VAT';
  if (qMode !== pMode) out.push({ field: 'discountMode', quote: qMode, po: pMode });

  return out;
}
