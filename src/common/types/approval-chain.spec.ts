import { BadRequestException } from '@nestjs/common';
import {
  buildApprovalChain,
  approveStep,
  rejectStep,
  currentStep,
  isChainApproved,
  isChainRejected,
  approvedLevel,
} from './approval-chain';

describe('ApprovalChain helpers', () => {
  it('builds a default 3-level chain (dept_head → hr → owner)', () => {
    const chain = buildApprovalChain();
    expect(chain).toHaveLength(3);
    expect(chain.map((s) => s.role)).toEqual(['dept_head', 'hr', 'owner']);
    expect(chain.every((s) => s.status === 'pending')).toBe(true);
  });

  it('approves steps strictly in order', () => {
    let chain = buildApprovalChain();
    chain = approveStep(chain, 'u1', 'ok');
    expect(chain[0].status).toBe('approved');
    expect(chain[0].approverId).toBe('u1');
    expect(approvedLevel(chain)).toBe(1);
    expect(currentStep(chain)?.level).toBe(2);
    expect(isChainApproved(chain)).toBe(false);

    chain = approveStep(chain, 'u2');
    chain = approveStep(chain, 'u3');
    expect(isChainApproved(chain)).toBe(true);
    expect(currentStep(chain)).toBeNull();
  });

  it('does not mutate the original chain (immutability)', () => {
    const chain = buildApprovalChain();
    const next = approveStep(chain, 'u1');
    expect(chain[0].status).toBe('pending');
    expect(next).not.toBe(chain);
  });

  it('throws when approving a fully approved chain', () => {
    let chain = buildApprovalChain(['hr']);
    chain = approveStep(chain, 'u1');
    expect(() => approveStep(chain, 'u2')).toThrow(BadRequestException);
  });

  it('reject marks the chain rejected and blocks further approval', () => {
    let chain = buildApprovalChain();
    chain = rejectStep(chain, 'u1', 'งบไม่พอ');
    expect(isChainRejected(chain)).toBe(true);
    expect(chain[0].note).toBe('งบไม่พอ');
    expect(() => approveStep(chain, 'u2')).toThrow(BadRequestException);
  });

  it('supports custom role chains', () => {
    const chain = buildApprovalChain(['hr', 'owner']);
    expect(chain).toHaveLength(2);
    expect(chain.map((s) => s.role)).toEqual(['hr', 'owner']);
  });
});
