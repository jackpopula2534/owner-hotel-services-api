import { BadRequestException } from '@nestjs/common';

/**
 * Shared multi-step approval chain used across HR flows
 * (manpower request, budget, equipment, leave, ...).
 *
 * Stored as a JSON column; `level` is 1-based and must be approved in order.
 */
export type ApproverRole = 'dept_head' | 'hr' | 'owner';

export interface ApprovalStep {
  level: number;
  role: ApproverRole;
  approverId: string | null;
  status: 'pending' | 'approved' | 'rejected';
  decidedAt: string | null;
  note: string | null;
}

export type ApprovalChain = ApprovalStep[];

const DEFAULT_ROLES: ApproverRole[] = ['dept_head', 'hr', 'owner'];

/** Build a fresh chain. Default = dept_head → hr → owner (3 levels). */
export function buildApprovalChain(roles: ApproverRole[] = DEFAULT_ROLES): ApprovalChain {
  return roles.map((role, i) => ({
    level: i + 1,
    role,
    approverId: null,
    status: 'pending',
    decidedAt: null,
    note: null,
  }));
}

/** Current pending step, or null when the chain is fully decided. */
export function currentStep(chain: ApprovalChain): ApprovalStep | null {
  return chain.find((s) => s.status === 'pending') ?? null;
}

export function isChainApproved(chain: ApprovalChain): boolean {
  return chain.length > 0 && chain.every((s) => s.status === 'approved');
}

export function isChainRejected(chain: ApprovalChain): boolean {
  return chain.some((s) => s.status === 'rejected');
}

/**
 * Approve the current pending step (immutable — returns a new chain).
 * Throws when the chain is already fully decided or rejected.
 */
export function approveStep(chain: ApprovalChain, approverId: string, note?: string): ApprovalChain {
  if (isChainRejected(chain)) throw new BadRequestException('Approval chain has been rejected');
  const step = currentStep(chain);
  if (!step) throw new BadRequestException('Approval chain is already fully approved');
  return chain.map((s) =>
    s.level === step.level
      ? { ...s, status: 'approved' as const, approverId, decidedAt: new Date().toISOString(), note: note ?? null }
      : s,
  );
}

/** Reject at the current pending step (immutable — returns a new chain). */
export function rejectStep(chain: ApprovalChain, approverId: string, note?: string): ApprovalChain {
  if (isChainRejected(chain)) throw new BadRequestException('Approval chain has already been rejected');
  const step = currentStep(chain);
  if (!step) throw new BadRequestException('Approval chain is already fully approved');
  return chain.map((s) =>
    s.level === step.level
      ? { ...s, status: 'rejected' as const, approverId, decidedAt: new Date().toISOString(), note: note ?? null }
      : s,
  );
}

/** Highest approved level (for the denormalized `currentApprovalLevel` column). */
export function approvedLevel(chain: ApprovalChain): number {
  return chain.filter((s) => s.status === 'approved').length;
}
