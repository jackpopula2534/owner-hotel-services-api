/**
 * Data-fix helper for the 2026-11-09 Owner Console leak (see
 * scripts/fix-stale-main-access.ts). Pure, so it is unit-tested with the suite.
 */
import { computeAllowedSystems } from './terminal-registry';

export interface StaleMainCandidate {
  id: string;
  role: string;
  allowedSystems: string | null;
  grants: { terminal: string; role: string }[];
}

/** pure — คืน allowedSystems ใหม่ (ถอดแค่ 'main') หรือ null ถ้าไม่ต้องแก้ */
export function stripStaleMain(u: StaleMainCandidate): string[] | null {
  if (u.grants.length === 0 || !u.allowedSystems) return null;
  let current: string[];
  try {
    const parsed = JSON.parse(u.allowedSystems);
    if (!Array.isArray(parsed)) return null;
    current = parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return null;
  }
  if (!current.includes('main')) return null;
  if (computeAllowedSystems(u.role, u.grants).includes('main')) return null;
  return current.filter((s) => s !== 'main');
}
