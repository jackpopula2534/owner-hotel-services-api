/**
 * Test double for {@link RevenueQueryService} — the read side of the revenue
 * book, shared by every screen that reports money.
 *
 * It answers from a list of ledger rows using the *same filters the service was
 * asked with*, not the order the calls arrive in. That matters: most reports ask
 * the book several questions per request (this period, the comparison period,
 * one series per revenue type), and a stub that replies positionally will keep
 * passing after the service starts asking for the wrong window.
 *
 * Method names are checked against the real prototype for the reason spelled out
 * in `revenue-posting.stub.ts`: a stub that invents a method keeps the suite
 * green while the screen calls something that no longer exists.
 */
import {
  RevenueSegment,
  RevenueSourceModule,
  RevenueSourceType,
  RevenueType,
  SettlementType,
} from '@prisma/client';
import {
  RevenueDocument,
  RevenueFilter,
  RevenueGroup,
  RevenueQueryService,
  RevenueTotals,
} from '../revenue-query.service';

const REQUIRED_METHODS = [
  'where',
  'totals',
  'byDay',
  'byModule',
  'bySegment',
  'byRevenueType',
  'bySettlement',
  'byOutlet',
  'countDocuments',
  'documents',
  'totalsOfMany',
] as const;

/**
 * One line in the fake book. Only `businessDate`, `sourceId` and `amount` are
 * required — `amount` fills gross/net/total at once, which is what a sale with
 * no discount, service charge or VAT looks like.
 */
export interface LedgerRow {
  businessDate: string;
  sourceId: string;
  amount: number;
  sourceType?: RevenueSourceType;
  sourceModule?: RevenueSourceModule;
  segment?: RevenueSegment;
  revenueType?: RevenueType;
  settlement?: SettlementType;
  outletId?: string;
  outletName?: string;
  propertyId?: string | null;
  /** ส่วนลด — หักออกจาก net (gross ยังเป็น `amount`) */
  discount?: number;
  serviceCharge?: number;
  tax?: number;
}

const sum = (rows: LedgerRow[], pick: (row: LedgerRow) => number): number =>
  Math.round(rows.reduce((total, row) => total + pick(row), 0) * 100) / 100;

const netOf = (row: LedgerRow): number => row.amount - (row.discount ?? 0);

const totalOf = (row: LedgerRow): number =>
  netOf(row) + (row.serviceCharge ?? 0) + (row.tax ?? 0);

export const totalsOfRows = (rows: LedgerRow[]): RevenueTotals => ({
  gross: sum(rows, (row) => row.amount),
  discount: sum(rows, (row) => row.discount ?? 0),
  net: sum(rows, netOf),
  serviceCharge: sum(rows, (row) => row.serviceCharge ?? 0),
  tax: sum(rows, (row) => row.tax ?? 0),
  total: sum(rows, totalOf),
  entries: rows.length,
});

const matchesOneOrMany = <T>(value: T | undefined, wanted: T | T[] | undefined): boolean => {
  if (wanted === undefined) return true;
  return Array.isArray(wanted) ? wanted.includes(value as T) : value === wanted;
};

export function buildRevenueQueryStub(rows: LedgerRow[] = []) {
  const real = RevenueQueryService.prototype as unknown as Record<string, unknown>;
  for (const method of REQUIRED_METHODS) {
    if (typeof real[method] !== 'function') {
      throw new Error(
        `RevenueQueryService no longer exposes ${method}() — update this stub instead of ` +
          'letting the reporting specs pass against a method that is gone.',
      );
    }
  }

  const inRange = (filter: RevenueFilter): LedgerRow[] =>
    rows.filter((row) => {
      if (row.businessDate < filter.from || row.businessDate > filter.to) return false;
      // ระบุ property = ตัดแถวที่ไม่ผูก property ออก ตรงกับ where() ตัวจริง
      if (filter.propertyId && (row.propertyId ?? null) !== filter.propertyId) return false;
      if (!matchesOneOrMany(row.sourceModule, filter.sourceModule)) return false;
      if (!matchesOneOrMany(row.segment, filter.segment)) return false;
      if (!matchesOneOrMany(row.revenueType, filter.revenueType)) return false;
      if (!matchesOneOrMany(row.outletId, filter.outletId)) return false;
      if (!matchesOneOrMany(row.settlement, filter.settlement)) return false;
      return true;
    });

  const group = (
    filter: RevenueFilter,
    keyOf: (row: LedgerRow) => string,
    labelOf?: (row: LedgerRow) => string | undefined,
  ): RevenueGroup[] => {
    const buckets = new Map<string, LedgerRow[]>();
    for (const row of inRange(filter)) {
      const key = keyOf(row);
      buckets.set(key, [...(buckets.get(key) ?? []), row]);
    }
    return [...buckets.entries()]
      .map(([key, group]) => ({
        key,
        ...(labelOf ? { label: labelOf(group[0]) } : {}),
        ...totalsOfRows(group),
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  };

  const documents = (filter: RevenueFilter): RevenueDocument[] => {
    const buckets = new Map<string, LedgerRow[]>();
    for (const row of inRange(filter)) {
      const key = `${row.businessDate}:${row.sourceId}`;
      buckets.set(key, [...(buckets.get(key) ?? []), row]);
    }
    return [...buckets.values()]
      .map((group) => ({
        businessDate: group[0].businessDate,
        sourceType: group[0].sourceType ?? RevenueSourceType.ORDER,
        sourceId: group[0].sourceId,
        ...totalsOfRows(group),
      }))
      .sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  };

  return {
    where: jest.fn((filter: RevenueFilter) => ({ tenantId: filter.tenantId, status: 'POSTED' })),
    totals: jest.fn(async (filter: RevenueFilter) => totalsOfRows(inRange(filter))),
    byDay: jest.fn(async (filter: RevenueFilter) => group(filter, (row) => row.businessDate)),
    byModule: jest.fn(async (filter: RevenueFilter) =>
      group(filter, (row) => String(row.sourceModule ?? '')),
    ),
    bySegment: jest.fn(async (filter: RevenueFilter) =>
      group(filter, (row) => String(row.segment ?? '')),
    ),
    byRevenueType: jest.fn(async (filter: RevenueFilter) =>
      group(filter, (row) => String(row.revenueType ?? '')),
    ),
    bySettlement: jest.fn(async (filter: RevenueFilter) =>
      group(filter, (row) => String(row.settlement ?? '')),
    ),
    byOutlet: jest.fn(async (filter: RevenueFilter) =>
      group(filter, (row) => row.outletId ?? '', (row) => row.outletName),
    ),
    countDocuments: jest.fn(
      async (filter: RevenueFilter) => new Set(inRange(filter).map((row) => row.sourceId)).size,
    ),
    documents: jest.fn(async (filter: RevenueFilter) => documents(filter)),
    totalsOfMany: jest.fn(async (filters: RevenueFilter[]) =>
      filters.map((filter) => totalsOfRows(inRange(filter))),
    ),
  };
}

export type RevenueQueryStub = ReturnType<typeof buildRevenueQueryStub>;

/** ตัวกรองทุกใบที่หน้าจอยื่นให้สมุด — ไว้ยืนยันว่าถามถูกช่วงและถูกขอบเขต */
export const ledgerFiltersOf = (stub: RevenueQueryStub): RevenueFilter[] =>
  [
    ...stub.totals.mock.calls,
    ...stub.byDay.mock.calls,
    ...stub.byModule.mock.calls,
    ...stub.bySegment.mock.calls,
    ...stub.byRevenueType.mock.calls,
    ...stub.bySettlement.mock.calls,
    ...stub.byOutlet.mock.calls,
    ...stub.countDocuments.mock.calls,
    ...stub.documents.mock.calls,
  ].map(([filter]) => filter as RevenueFilter);
