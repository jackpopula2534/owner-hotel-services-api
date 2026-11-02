import { createHash } from 'crypto';

export interface StatementFingerprintInput {
  txnDate: string;
  txnTime?: string | null;
  amount: number;
  reference?: string | null;
  description: string;
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * ลายนิ้วมือของแต่ละแถว — แถวที่เหมือนกันทุกช่องในไฟล์เดียวกัน (เช่นโอนยอดเท่ากันสองครั้งโดยไม่มีเลขอ้างอิง)
 * ต่อท้ายลำดับที่เจอ ทำให้นำเข้าไฟล์เดิมซ้ำได้ลายนิ้วมือเดิม แต่ไม่รวมสองแถวเป็นแถวเดียว
 */
export function fingerprintLines(lines: StatementFingerprintInput[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = [
      l.txnDate.slice(0, 10),
      norm(l.txnTime),
      Number(l.amount).toFixed(2),
      norm(l.reference),
      norm(l.description),
    ].join('|');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return createHash('sha256').update(`${base}#${n}`).digest('hex');
  });
}

export interface BookLineCandidate {
  journalLineId: string;
  entryDate: Date | string;
  amount: number;
  cleared: boolean;
}

export interface StatementLineCandidate {
  id: string;
  txnDate: Date | string;
  amount: number;
  journalLineId: string | null;
}

const DAY = 86_400_000;
const toTime = (d: Date | string) =>
  new Date(typeof d === 'string' ? `${d.slice(0, 10)}T00:00:00Z` : d).getTime();

/**
 * แนะนำคู่ Statement ↔ สมุดบัญชี: ใช้ journalLineId ที่ผูกไว้แล้วก่อน (เช่นรับชำระจากหน้า AR)
 * ที่เหลือจับยอดเท่ากันพอดี วันที่ห่างไม่เกิน `windowDays` เลือกวันที่ใกล้สุด ใช้รายการสมุดบัญชีได้ครั้งเดียว
 */
export function suggestBookMatches(
  statement: StatementLineCandidate[],
  book: BookLineCandidate[],
  windowDays = 5,
): Map<string, string> {
  const result = new Map<string, string>();
  const bookIds = new Set(book.filter((b) => !b.cleared).map((b) => b.journalLineId));
  const used = new Set<string>();
  for (const s of statement) {
    if (s.journalLineId && bookIds.has(s.journalLineId) && !used.has(s.journalLineId)) {
      result.set(s.id, s.journalLineId);
      used.add(s.journalLineId);
    }
  }
  const rest = statement
    .filter((s) => !result.has(s.id))
    .sort((a, b) => toTime(a.txnDate) - toTime(b.txnDate));
  for (const s of rest) {
    const amt = Math.round(Number(s.amount) * 100);
    let best: { id: string; gap: number } | null = null;
    for (const b of book) {
      if (b.cleared || used.has(b.journalLineId)) continue;
      if (Math.round(b.amount * 100) !== amt) continue;
      const gap = Math.abs(toTime(b.entryDate) - toTime(s.txnDate)) / DAY;
      if (gap > windowDays) continue;
      if (!best || gap < best.gap) best = { id: b.journalLineId, gap };
    }
    if (best) {
      result.set(s.id, best.id);
      used.add(best.id);
    }
  }
  return result;
}
