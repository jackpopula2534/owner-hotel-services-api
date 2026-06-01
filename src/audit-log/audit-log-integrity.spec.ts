import { AuditLogService } from './audit-log.service';

// ─────────────────────────────────────────────────────────────────────────────
// AuditLogService - tamper-evidence (LEGAL-05)
// ─────────────────────────────────────────────────────────────────────────────

const baseRow = () => ({
  id: '11111111-1111-1111-1111-111111111111',
  action: 'UPDATE',
  resource: 'guest',
  resourceId: 'guest-1',
  category: 'general',
  oldValues: { a: 1, b: 2 },
  newValues: { b: 3, a: 1 },
  description: 'changed',
  tenantId: 'tenant-1',
  userId: 'user-1',
  adminId: null,
  ipAddress: '203.0.113.5',
  userAgent: 'jest',
  createdAt: new Date('2026-05-31T00:00:00.000Z'),
});

describe('AuditLogService.computeEntryHash', () => {
  it('is deterministic and independent of JSON key order', () => {
    const a = AuditLogService.computeEntryHash(baseRow());
    const reordered = { ...baseRow(), oldValues: { b: 2, a: 1 }, newValues: { a: 1, b: 3 } };
    const b = AuditLogService.computeEntryHash(reordered);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any content field changes', () => {
    const original = AuditLogService.computeEntryHash(baseRow());
    const tampered = AuditLogService.computeEntryHash({ ...baseRow(), description: 'HACKED' });
    expect(tampered).not.toBe(original);
  });
});

describe('AuditLogService.verifyIntegrity', () => {
  const buildService = (rows: any[]) => {
    const prismaMock: any = { auditLog: { findMany: jest.fn().mockResolvedValue(rows) } };
    return new AuditLogService(prismaMock);
  };

  it('flags rows whose stored hash no longer matches their content', async () => {
    const good = baseRow();
    const goodHash = AuditLogService.computeEntryHash(good);

    const tampered = { ...baseRow(), id: '22222222-2222-2222-2222-222222222222' };
    const staleHash = AuditLogService.computeEntryHash(tampered);
    // simulate after-the-fact edit: content changed but hash not updated
    tampered.description = 'EDITED AFTER THE FACT';

    const unhashed = { ...baseRow(), id: '33333333-3333-3333-3333-333333333333', entryHash: null };

    const service = buildService([
      { ...good, entryHash: goodHash },
      { ...tampered, entryHash: staleHash },
      unhashed,
    ]);

    const result = await service.verifyIntegrity({ tenantId: 'tenant-1' });

    expect(result.checked).toBe(3);
    expect(result.valid).toBe(1);
    expect(result.tampered).toEqual(['22222222-2222-2222-2222-222222222222']);
    expect(result.unhashed).toEqual(['33333333-3333-3333-3333-333333333333']);
  });
});
