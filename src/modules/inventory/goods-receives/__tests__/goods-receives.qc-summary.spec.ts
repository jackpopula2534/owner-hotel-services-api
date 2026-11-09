import { summarizeGrQc } from '../goods-receives.service';

describe('summarizeGrQc', () => {
  it('no QC records → nothing to inspect', () => {
    expect(summarizeGrQc([])).toEqual({
      total: 0,
      pending: 0,
      passed: 0,
      partialFail: 0,
      failed: 0,
      pendingRecordId: null,
      firstRecordId: null,
    });
    expect(summarizeGrQc(undefined).total).toBe(0);
  });

  it('counts per status and points at the first record still waiting', () => {
    const s = summarizeGrQc([
      { id: 'q1', status: 'PASSED' },
      { id: 'q2', status: 'PENDING' },
      { id: 'q3', status: 'FAILED' },
    ]);
    expect(s).toMatchObject({
      total: 3,
      pending: 1,
      passed: 1,
      failed: 1,
      pendingRecordId: 'q2',
      firstRecordId: 'q1',
    });
  });

  it('placeholder rows from create (empty id) count but are never linked', () => {
    const s = summarizeGrQc([{ id: '', status: 'PENDING' }]);
    expect(s).toMatchObject({ total: 1, pending: 1, pendingRecordId: null, firstRecordId: null });
  });
});
