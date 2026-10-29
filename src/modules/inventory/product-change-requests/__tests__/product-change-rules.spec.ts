import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  ProcurementSnapshot,
  buildChanges,
  getFieldDef,
  normalizeValue,
  requestLevel,
} from '../product-change-fields';
import { decideFields, definedEntries, isOverdue, permissionsFor } from '../product-change-shared';
import {
  assertCanWriteItemSuppliers,
  assertNotProcurementOnly,
  assertProcurementOwnedFieldsUnchanged,
  assertRole,
  REVIEWER_ROLES,
} from '../product-change-access';

const baseline: ProcurementSnapshot = {
  name: 'น้ำดื่ม 600ml',
  description: null,
  brand: null,
  preferredSupplierId: 'sup-old',
  unitPrice: 156,
  minOrderQty: 10,
  leadDays: 3,
  purchaseUnit: 'BOX',
  purchaseUnitFactor: 24,
};

describe('product-change-fields', () => {
  it('normalizes blanks to null and numeric strings to numbers', () => {
    expect(normalizeValue(getFieldDef('brand'), '   ')).toBeNull();
    expect(normalizeValue(getFieldDef('unitPrice'), '168.50')).toBe(168.5);
    expect(normalizeValue(getFieldDef('unitPrice'), '')).toBeNull();
    expect(normalizeValue(getFieldDef('name'), '  ชื่อ  ')).toBe('ชื่อ');
  });

  it('returns only the fields that actually changed', () => {
    const changes = buildChanges(baseline, {
      name: 'น้ำดื่ม 600ml', // same
      unitPrice: '156.00', // same after normalisation
      leadDays: 5,
      preferredSupplierId: 'sup-new',
    });
    expect(changes.map((c) => c.field)).toEqual(['preferredSupplierId', 'leadDays']);
    expect(changes[0]).toMatchObject({
      from: 'sup-old',
      to: 'sup-new',
      level: 'ACKNOWLEDGE',
      decision: 'PENDING',
    });
  });

  it('ignores keys that were not sent (not sent ≠ clear)', () => {
    expect(buildChanges(baseline, {})).toEqual([]);
  });

  it('treats clearing a value as a change', () => {
    const [change] = buildChanges(baseline, { minOrderQty: null });
    expect(change).toMatchObject({ field: 'minOrderQty', from: 10, to: null });
  });

  it('escalates to APPROVAL when a stock-affecting field changes', () => {
    expect(requestLevel(buildChanges(baseline, { unitPrice: 168 }))).toBe('ACKNOWLEDGE');
    expect(requestLevel(buildChanges(baseline, { unitPrice: 168, purchaseUnitFactor: 12 }))).toBe(
      'APPROVAL',
    );
    expect(requestLevel(buildChanges(baseline, { purchaseUnit: 'PACK' }))).toBe('APPROVAL');
  });

  it('definedEntries drops undefined and unknown keys', () => {
    const result = definedEntries({
      unitPrice: 10,
      brand: undefined,
      sku: 'X',
    } as unknown as Parameters<typeof definedEntries>[0]);
    expect(result).toEqual({ unitPrice: 10 });
  });
});

describe('permissionsFor', () => {
  const pending = { status: 'PENDING' as const, requestedById: 'buyer-1' };

  it('lets a warehouse manager review someone else’s request', () => {
    const p = permissionsFor({ userId: 'wh-1', tenantId: 't', role: 'warehouse_manager' }, pending);
    expect(p).toEqual({ canReview: true, canCancel: false, canResubmit: false });
  });

  it('never lets procurement review, only cancel its own', () => {
    const p = permissionsFor({ userId: 'buyer-1', tenantId: 't', role: 'buyer' }, pending);
    expect(p).toEqual({ canReview: false, canCancel: true, canResubmit: false });
    const other = permissionsFor(
      { userId: 'buyer-2', tenantId: 't', role: 'procurement_manager' },
      pending,
    );
    expect(other.canCancel).toBe(false);
  });

  it('blocks self-review except for owners/admins', () => {
    const own = { status: 'PENDING' as const, requestedById: 'u-1' };
    expect(
      permissionsFor({ userId: 'u-1', tenantId: 't', role: 'warehouse_manager' }, own).canReview,
    ).toBe(false);
    expect(
      permissionsFor({ userId: 'u-1', tenantId: 't', role: 'tenant_admin' }, own).canReview,
    ).toBe(true);
    const gm = permissionsFor({ userId: 'u-1', tenantId: 't', role: 'manager' }, own);
    expect(gm.canReview).toBe(false);
    expect(
      permissionsFor({ userId: 'u-2', tenantId: 't', role: 'manager' }, own).canReview,
    ).toBe(true);
  });

  it('allows resubmit only while NEEDS_INFO', () => {
    const actor = { userId: 'buyer-1', tenantId: 't', role: 'buyer' };
    expect(permissionsFor(actor, { ...pending, status: 'NEEDS_INFO' }).canResubmit).toBe(true);
    expect(permissionsFor(actor, { ...pending, status: 'APPROVED' })).toEqual({
      canReview: false,
      canCancel: false,
      canResubmit: false,
    });
  });
});

describe('decideFields', () => {
  const changes = buildChanges(baseline, { unitPrice: 168, leadDays: 5 });

  it('approves everything when no subset is given', () => {
    expect(decideFields(changes).every((c) => c.decision === 'APPROVED')).toBe(true);
  });

  it('marks unlisted fields as rejected', () => {
    const decided = decideFields(changes, ['leadDays']);
    expect(decided.find((c) => c.field === 'unitPrice')?.decision).toBe('REJECTED');
    expect(decided.find((c) => c.field === 'leadDays')?.decision).toBe('APPROVED');
  });

  it('refuses fields that are not part of the request', () => {
    expect(() => decideFields(changes, ['brand'])).toThrow(BadRequestException);
  });
});

describe('isOverdue', () => {
  it('flags pending requests older than the SLA', () => {
    const now = Date.parse('2026-10-28T12:00:00Z');
    const old = { status: 'PENDING' as const, createdAt: new Date('2026-10-27T10:00:00Z') };
    const fresh = { status: 'PENDING' as const, createdAt: new Date('2026-10-28T10:00:00Z') };
    expect(isOverdue(old, now)).toBe(true);
    expect(isOverdue(fresh, now)).toBe(false);
    expect(isOverdue({ ...old, status: 'APPROVED' }, now)).toBe(false);
  });
});

describe('access helpers', () => {
  it('blocks procurement-only roles from the item master', () => {
    expect(() => assertNotProcurementOnly('buyer')).toThrow(ForbiddenException);
    expect(() => assertNotProcurementOnly('procurement_manager')).toThrow(ForbiddenException);
    expect(() => assertNotProcurementOnly('warehouse_manager')).not.toThrow();
    // receiver is shared with the warehouse side
    expect(() => assertNotProcurementOnly('receiver')).not.toThrow();
  });

  it('rejects callers without a tenant or with the wrong role', () => {
    expect(() =>
      assertRole({ userId: 'u', tenantId: '', role: 'warehouse_manager' }, REVIEWER_ROLES, 'x'),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertRole({ userId: 'u', tenantId: 't', role: 'buyer' }, REVIEWER_ROLES, 'x'),
    ).toThrow(ForbiddenException);
  });
});

describe('procurement-owned item fields', () => {
  const current = { name: 'น้ำดื่ม 600ml', description: null, brand: 'A' };

  it('lets the warehouse save a form that resends the same values', () => {
    expect(() =>
      assertProcurementOwnedFieldsUnchanged('warehouse_manager', current, {
        name: ' น้ำดื่ม 600ml ',
        description: '',
        brand: 'A',
      }),
    ).not.toThrow();
  });

  it('blocks the warehouse from renaming an item', () => {
    expect(() =>
      assertProcurementOwnedFieldsUnchanged('inventory_clerk', current, { name: 'น้ำดื่ม 1L' }),
    ).toThrow(ForbiddenException);
  });

  it('still lets owners fix master data directly', () => {
    expect(() =>
      assertProcurementOwnedFieldsUnchanged('tenant_admin', current, { brand: 'B' }),
    ).not.toThrow();
  });

  it('only owners write item_suppliers directly', () => {
    expect(() => assertCanWriteItemSuppliers('warehouse_manager')).toThrow(ForbiddenException);
    expect(() => assertCanWriteItemSuppliers('buyer')).toThrow(ForbiddenException);
    expect(() => assertCanWriteItemSuppliers('manager')).not.toThrow();
  });
});
