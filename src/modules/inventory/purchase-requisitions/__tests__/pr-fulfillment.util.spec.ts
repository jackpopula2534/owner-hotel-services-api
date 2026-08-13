import {
  ReceiveRow,
  fulfillmentByItem,
  mapLinkedReceives,
  summariseFulfillment,
  toAmount,
} from '../pr-fulfillment.util';

const receive = (over: Partial<ReceiveRow> = {}): ReceiveRow => ({
  id: 'gr-1',
  grNumber: 'GR-202608-0001',
  receiveDate: new Date('2026-08-10T03:00:00.000Z'),
  status: 'ACCEPTED',
  source: 'CASH_PURCHASE',
  vendorName: 'ตลาดสี่มุมเมือง',
  paymentMethod: 'OWN_MONEY',
  hasNoReceipt: false,
  invoiceNumber: 'MOCK-3557',
  totalAmount: 3475.8,
  paidBy: 'user-1',
  warehouse: { name: 'คลังครัวกลาง' },
  items: [],
  ...over,
});

describe('pr-fulfillment.util', () => {
  describe('toAmount', () => {
    it('แปลง Decimal เป็นตัวเลข — ส่ง object ออกไปทาง JSON ฝั่งหน้าเว็บได้ค่าว่าง', () => {
      expect(toAmount('3475.80' as unknown as number)).toBe(3475.8);
      expect(toAmount(12)).toBe(12);
    });

    it('ค่าที่ไม่มีหรืออ่านไม่ออก คืน 0 ไม่ใช่ NaN', () => {
      expect(toAmount(null)).toBe(0);
      expect(toAmount(undefined)).toBe(0);
      expect(toAmount('ไม่ใช่ตัวเลข' as unknown as number)).toBe(0);
    });
  });

  describe('fulfillmentByItem', () => {
    it('รวมจำนวนที่ได้จากใบรับของหลายใบเข้าด้วยกัน', () => {
      const rows = [
        receive({
          items: [{ itemId: 'i-1', receivedQty: 600, unitCost: 0.5, totalCost: 300 }],
        }),
        receive({
          id: 'gr-2',
          items: [{ itemId: 'i-1', receivedQty: 400, unitCost: 0.75, totalCost: 300 }],
        }),
      ];

      expect(fulfillmentByItem(rows).get('i-1')).toEqual({
        receivedQty: 1000,
        // ถัวเฉลี่ยถ่วงน้ำหนัก ไม่ใช่ราคาครั้งล่าสุด — ไปตลาดสองรอบได้คนละราคา
        actualUnitCost: 0.6,
        actualTotalCost: 600,
      });
    });

    it('ไม่มีใบรับของ ก็ไม่มีบรรทัดไหนถูกอ้างว่าได้ของแล้ว', () => {
      expect(fulfillmentByItem([]).size).toBe(0);
    });

    it('จำนวน 0 ไม่หารเป็น Infinity', () => {
      const rows = [
        receive({ items: [{ itemId: 'i-1', receivedQty: 0, unitCost: 5, totalCost: 0 }] }),
      ];
      expect(fulfillmentByItem(rows).get('i-1')?.actualUnitCost).toBeNull();
    });
  });

  describe('summariseFulfillment', () => {
    const requested = [
      { itemId: 'i-1', quantity: 1000 },
      { itemId: 'i-2', quantity: 800 },
    ];

    it('ได้ของครบทุกบรรทัด ถึงจะนับว่าได้ของครบ', () => {
      const rows = [
        receive({
          items: [
            { itemId: 'i-1', receivedQty: 1000, unitCost: 0.87, totalCost: 870 },
            { itemId: 'i-2', receivedQty: 800, unitCost: 0.65, totalCost: 520 },
          ],
        }),
      ];

      const summary = summariseFulfillment(requested, rows);
      expect(summary.fullyReceived).toBe(true);
      expect(summary.linesComplete).toBe(2);
      expect(summary.cashPurchaseCount).toBe(1);
      expect(summary.totalPaid).toBe(3475.8);
    });

    it('ได้ของไม่ครบ ต้องไม่รายงานว่าครบ — ปิดใบไปแล้วแต่ของยังขาด เกิดขึ้นได้', () => {
      const rows = [
        receive({
          items: [{ itemId: 'i-1', receivedQty: 400, unitCost: 0.87, totalCost: 348 }],
        }),
      ];

      const summary = summariseFulfillment(requested, rows);
      expect(summary.fullyReceived).toBe(false);
      expect(summary.linesReceived).toBe(1);
      expect(summary.linesComplete).toBe(0);
      expect(summary.linesRequested).toBe(2);
    });

    it('ของที่ซื้อเกินจากใบขอซื้อ ต้องนับแยก ไม่กลืนไปกับของที่ขอไว้', () => {
      const rows = [
        receive({
          items: [
            { itemId: 'i-1', receivedQty: 1000, unitCost: 0.87, totalCost: 870 },
            { itemId: 'i-9', receivedQty: 5, unitCost: 20, totalCost: 100 },
          ],
        }),
      ];

      expect(summariseFulfillment(requested, rows).extraLines).toBe(1);
    });

    it('ใบขอซื้อที่ไม่มีรายการเลย ไม่นับว่าได้ของครบ', () => {
      expect(summariseFulfillment([], []).fullyReceived).toBe(false);
    });

    it('ใบรับของที่มาจาก PO ไม่ถูกนับเป็นการไปซื้อเอง', () => {
      const rows = [receive({ source: 'PURCHASE_ORDER' })];
      const summary = summariseFulfillment(requested, rows);
      expect(summary.receiptCount).toBe(1);
      expect(summary.cashPurchaseCount).toBe(0);
    });
  });

  describe('mapLinkedReceives', () => {
    it('แปลงยอดเงินเป็นตัวเลข และแทน id คนออกเงินด้วยชื่อ', () => {
      const names = new Map([['user-1', 'สมชาย ใจดี']]);
      const [row] = mapLinkedReceives(
        [receive({ items: [{ itemId: 'i-1', receivedQty: 1, unitCost: 1, totalCost: 1 }] })],
        names,
      );

      expect(row.totalAmount).toBe(3475.8);
      expect(row.paidByName).toBe('สมชาย ใจดี');
      expect(row.warehouseName).toBe('คลังครัวกลาง');
      expect(row.itemCount).toBe(1);
    });

    it('คนออกเงินที่หาชื่อไม่เจอ คืน null ไม่ใช่ id ดิบ ๆ', () => {
      // ชื่อหาไม่เจอเพราะอยู่คนละ tenant ก็ได้ — id ที่โผล่บนหน้าจอคือข้อมูลรั่ว
      const [row] = mapLinkedReceives([receive({ paidBy: 'user-เเปลกปลอม' })], new Map());
      expect(row.paidByName).toBeNull();
    });
  });
});
