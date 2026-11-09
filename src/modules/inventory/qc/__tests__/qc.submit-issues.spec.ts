import { findQcSubmitIssues, hasQcAnswer, QcItemRule } from '../qc.service';

const items: QcItemRule[] = [
  { id: 'a', label: 'ฉลาก', type: 'BOOLEAN', required: true, orderIndex: 0 },
  {
    id: 'b',
    label: 'อุณหภูมิ',
    type: 'NUMERIC',
    required: true,
    orderIndex: 1,
    requireNoteOnFail: true,
  },
  { id: 'c', label: 'รูป', type: 'PHOTO', required: true, orderIndex: 2 },
  { id: 'd', label: 'ข้อสังเกต', type: 'TEXT', required: false, orderIndex: 3 },
];

describe('QC submit validation', () => {
  it('hasQcAnswer: blank values are not answers', () => {
    expect(hasQcAnswer('BOOLEAN', { checklistItemId: 'a', passed: true })).toBe(false);
    expect(hasQcAnswer('NUMERIC', { checklistItemId: 'b', passed: true, valueNumeric: 0 })).toBe(
      true,
    );
    expect(hasQcAnswer('TEXT', { checklistItemId: 'd', passed: false, valueText: '  ' })).toBe(
      false,
    );
    expect(hasQcAnswer('PHOTO', { checklistItemId: 'c', passed: false, photoUrls: [] })).toBe(
      false,
    );
  });

  it('reports required items without a real answer, numbered as the inspector sees them', () => {
    const { missing } = findQcSubmitIssues(items, [
      { checklistItemId: 'a', valueBool: true, passed: true },
      { checklistItemId: 'b', valueNumeric: 3, passed: true },
      { checklistItemId: 'c', photoUrls: [], passed: false },
    ]);
    expect(missing).toEqual([{ no: 3, label: 'รูป' }]);
  });

  it('a failed item that requires a finding note must carry one', () => {
    const base = [
      { checklistItemId: 'a', valueBool: true, passed: true },
      { checklistItemId: 'c', photoUrls: ['x'], passed: true },
    ];
    const without = findQcSubmitIssues(items, [
      ...base,
      { checklistItemId: 'b', valueNumeric: 8.5, passed: false },
    ]);
    expect(without.noteRequired).toEqual([{ no: 2, label: 'อุณหภูมิ' }]);
    const withNote = findQcSubmitIssues(items, [
      ...base,
      { checklistItemId: 'b', valueNumeric: 8.5, passed: false, note: 'รถไม่มีห้องเย็น' },
    ]);
    expect(withNote.noteRequired).toEqual([]);
    expect(withNote.missing).toEqual([]);
  });
});
