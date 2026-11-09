import { computeAllowedSystems, isTerminalAccountRole, mainSessionScope } from './terminal-registry';

/**
 * H1.2 (audit 2026-11-09) — Camp / Retail / CRM have no login of their own, so
 * their staff run on a main session. `mainSessionScope` decides which terminals
 * that session is limited to; the result goes into the JWT `terminals` claim and
 * SystemGuard enforces it.
 */
describe('mainSessionScope', () => {
  it('owners and admins are never scoped', () => {
    for (const role of ['tenant_admin', 'admin', 'platform_admin']) {
      expect(mainSessionScope(role, '["main","crm","retail"]')).toBeNull();
    }
  });

  it("a terminal role is scoped to its own terminal even with no grant row", () => {
    expect(mainSessionScope('crm_manager', '[]')).toEqual(['crm']);
    expect(mainSessionScope('crm_manager', null)).toEqual(['crm']);
  });

  it('grants on main-session terminals are added; other grants are ignored', () => {
    expect(mainSessionScope('crm_manager', '["main","retail","hotel-terminal","pos"]')?.sort()).toEqual([
      'crm',
      'retail',
    ]);
  });

  it('a hotel_manager with a crm grant is scoped to crm', () => {
    expect(mainSessionScope('hotel_manager', '["hotel-terminal","crm"]')).toEqual(['crm']);
  });

  it('a role with no Camp / Retail / CRM link stays an ordinary main session', () => {
    expect(mainSessionScope('manager', '["main"]')).toBeNull();
    expect(mainSessionScope('hotel_manager', '["hotel-terminal"]')).toBeNull();
  });

  it('a malformed grant list falls back to the role alone', () => {
    expect(mainSessionScope('crm_manager', 'not json')).toEqual(['crm']);
  });

  it('no role → no scope', () => {
    expect(mainSessionScope(undefined, '["crm"]')).toBeNull();
  });
});

describe('main-session terminal accounts', () => {
  it('crm / retail / camp roles are not treated as terminal-only accounts', () => {
    expect(isTerminalAccountRole('crm_manager')).toBe(false);
  });

  it('a grant on a main-session terminal implies main', () => {
    expect(computeAllowedSystems('crm_manager', [{ terminal: 'crm', role: 'crm_manager' }])).toContain('main');
  });
});
