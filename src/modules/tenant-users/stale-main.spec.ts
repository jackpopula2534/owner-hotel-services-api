import { stripStaleMain } from './stale-main';

describe('stripStaleMain (data fix for 2026-11-09 Owner Console leak)', () => {
  it('strips main from a demoted POS·waiter', () => {
    expect(
      stripStaleMain({
        id: 'u',
        role: 'waiter',
        allowedSystems: '["main","pos"]',
        grants: [{ terminal: 'pos', role: 'waiter' }],
      }),
    ).toEqual(['pos']);
  });

  it('strips main from a manager-level account too (Owner Console = owner only)', () => {
    expect(
      stripStaleMain({
        id: 'u',
        role: 'waiter',
        allowedSystems: '["main","pos","hr"]',
        grants: [
          { terminal: 'pos', role: 'waiter' },
          { terminal: 'hr', role: 'hr_manager' },
        ],
      }),
    ).toEqual(['pos', 'hr']);
  });

  it('never touches owners', () => {
    expect(
      stripStaleMain({ id: 'o', role: 'tenant_admin', allowedSystems: '["main"]', grants: [{ terminal: 'pos', role: 'waiter' }] }),
    ).toBeNull();
  });

  it('skips legacy accounts with no user_terminal_access rows', () => {
    expect(stripStaleMain({ id: 'l', role: 'receptionist', allowedSystems: '["main"]', grants: [] })).toBeNull();
  });

  it('only removes main — keeps other legacy entries', () => {
    expect(
      stripStaleMain({
        id: 'u',
        role: 'chef',
        allowedSystems: '["main","pos","kds-legacy"]',
        grants: [{ terminal: 'pos', role: 'chef' }],
      }),
    ).toEqual(['pos', 'kds-legacy']);
  });

  it('ignores malformed allowedSystems', () => {
    expect(stripStaleMain({ id: 'u', role: 'chef', allowedSystems: 'not-json', grants: [{ terminal: 'pos', role: 'chef' }] })).toBeNull();
  });
});
