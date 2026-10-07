# แผนระบบโปรโมชั่น Retail POS (โค้ดส่วนลด / ของแถม) — เชื่อม CRM + คลัง

> เอกสารติดตามงาน — อัปเดตสถานะ checkbox และ "บันทึกความคืบหน้า" ท้ายไฟล์ทุกครั้งที่ทำงานเสร็จ
> Backend: `owner-hotel-services-api` · Frontend: `owner-hotel-services` (หน้า `/retail`)

## 1. ข้อตัดสินใจ (ยืนยันกับเจ้าของงาน 2026-10-07)

| # | คำถาม | คำตอบ |
|---|---|---|
| 1 | 1 บิลใช้ได้กี่โค้ด | **1 โค้ดต่อบิล** (เฟส 1) |
| 2 | ของแถมหมด | **ให้ลูกค้าเลือกรับเฉพาะส่วนลดได้** (แคชเชียร์ต้องกดยืนยันเอง — ระบบไม่ตัดของแถมทิ้งเงียบ ๆ) |
| 3 | ผูกสมาชิก | **ต้องผูกสมาชิกทุกครั้งที่ใช้โค้ด** โดยใช้ระบบสมาชิกของระบบหลัก — ห้ามสร้างตารางสมาชิกใหม่ |
| 4 | ของแถมตัดจากคลังไหน | **แยกคลังของแถมโดยเฉพาะ** (Warehouse type `PROMOTION`) |
| 5 | เริ่มเฟส 1 | ✅ เริ่มแล้ว |

## 2. "สมาชิก" ของระบบหลักคืออะไร (ไม่สร้างใหม่)

ระบบมีตัวตนลูกค้าอยู่แล้ว 3 ชั้น — โปรโมชั่นต่อเข้ากับของเดิมทั้งหมด:

```
Guest (guests)              ← ตัวตนสมาชิก: ชื่อ เบอร์ อีเมล PDPA consent  [ใช้เป็น memberId]
 ├─ CrmContact (crm_contacts) ← โปรไฟล์ CRM: segment, RFM, tags  @@unique([tenantId, guestId])
 └─ LoyaltyPoint (loyalty_points) ← แต้ม + tier  @@unique([tenantId, guestId])
```

- POS ค้นสมาชิกจาก `Guest` (เบอร์โทร / ชื่อ / อีเมล) ใน tenant เดียวกัน แสดง tier + segment
- ไม่เจอ → "สมัครสมาชิก" = สร้างแถว `Guest` ปกติของระบบหลัก (พร้อม consent PDPA) ไม่ใช่ตารางใหม่
- ตอนใช้โค้ด ระบบ upsert `CrmContact` ของ guest นั้น (idempotent บน tenantId+guestId) แล้วผูก redemption กับ contact → CRM เห็นประวัติการใช้โปรทันที
- เงื่อนไขกลุ่มเป้าหมาย (tier / segment) อ่านจาก LoyaltyPoint / CrmContact ตัวเดิม

## 3. โมเดลข้อมูล (tenant-scoped ทุกตัว)

| Model | หน้าที่ |
|---|---|
| `RetailPromotion` | ตัวโปร: ส่วนลด (NONE/PERCENT/FIXED, maxDiscount), minSpend, สินค้าที่ร่วมรายการ, tier/segment ที่มีสิทธิ์, ช่วงเวลา, โควตารวม, โควตาต่อสมาชิก, คลังของแถม, สถานะ |
| `RetailPromoCode` | โค้ด `@@unique([tenantId, code])` แบบ SHARED (ใช้ร่วม) หรือ UNIQUE (ใช้ครั้งเดียว/ออกให้สมาชิกรายคน) |
| `RetailPromotionGift` | ของแถมต่อโปร: item, จำนวนต่อครั้ง, งบจำนวน (budgetQty) / แจกไปแล้ว (issuedQty) |
| `RetailPromotionMemberUsage` | ตัวนับการใช้ต่อสมาชิก `@@unique([promotionId, guestId])` — กัน race ของโควตาต่อคน |
| `RetailPromotionRedemption` | ประวัติการใช้ 1 แถวต่อบิล: โค้ด สมาชิก contact ส่วนลด ต้นทุนของแถม ข้ามของแถมหรือไม่ สถานะ APPLIED/REVERSED |

เพิ่มใน `RetailSale`: `memberGuestId`, `memberContactId`, `promotionId`, `promoCode`, `promoDiscount`, `promoGiftCost`
เพิ่มใน `RetailSaleItem`: `isGift`, `promotionId`, `sourceWarehouseId` (บรรทัดของแถมตัดจากคลังของแถม)
เพิ่ม enum `WarehouseType.PROMOTION` = คลังของแถม

### กันใช้เกินโควตา (race-safe)
ทุกตัวนับใช้ conditional increment ใน transaction เดียวกับการขาย:
`updateMany({ where: { id, usedCount: { lt: limit } }, data: { usedCount: { increment: 1 } } })` → count 0 = เต็ม → rollback ทั้งบิล
ใช้กับ: promotion.usageLimit, code.maxUses, memberUsage.perMemberLimit, gift.budgetQty (เพิ่มทีละจำนวนชิ้น)

## 4. Flow ที่ POS

1. ตะกร้า → ปุ่ม "สมาชิก" ค้นหา/สมัคร → ผูกสมาชิกกับบิล
2. กรอกโค้ด → `POST /inventory/retail/promotions/preview` (ต้องมีสมาชิกก่อน) → ได้ส่วนลด + รายการของแถม + สต็อกของแถม
3. ของแถมไม่พอ → แสดงคำเตือน + ปุ่ม "รับเฉพาะส่วนลด" (ถ้าโปรนั้นมีส่วนลด) — โปรที่มีแต่ของแถมแล้วของหมด = ใช้ไม่ได้
4. Modal สรุปการสั่งซื้อแสดง: สมาชิก โค้ด ส่วนลดโปร ของแถม ฿0
5. ยืนยัน → `POST /inventory/retail/sales` พร้อม `promoCode`, `memberGuestId`, `acceptWithoutGift` → server **คำนวณโปรใหม่ทั้งหมด** ใน transaction (ไม่เชื่อยอดจาก client) → ตัดสต็อกสินค้า (คลังขาย) + ของแถม (คลังของแถม) + ตัดโควตา + บันทึก redemption + ออกใบเสร็จ — พลาดจุดเดียว rollback ทั้งหมด

## 5. คลัง / บัญชี

- ของแถม: `StockMovement` GOODS_ISSUE, `referenceType = 'PROMO_GIFT'`, `referenceId = saleId`, ตัด FEFO ที่ต้นทุนจริง
- บรรทัดของแถมใน `RetailSaleItem`: unitPrice 0, lineTotal 0, `lineCost` = ต้นทุนจริง, `isGift = true`
- `costTotal` = ต้นทุนสินค้าที่ขายเท่านั้น; ต้นทุนของแถมแยกไว้ที่ `promoGiftCost` (ค่าใช้จ่ายส่งเสริมการขาย); `profitTotal = taxable − costTotal − promoGiftCost`
- ส่วนลดโปรลดฐาน VAT (รวมใน `discountTotal`)
- ⚠️ VAT ของแถมตามมูลค่าตลาด: ยังไม่คิด — รอฝ่ายบัญชียืนยัน (บันทึกต้นทุนไว้ให้รายงานแล้ว)

## 6. Phase & Checklist

### Phase 1 — Core ✅ (2026-10-07)
- [x] Schema + migration (models, enums, ฟิลด์ใน RetailSale/RetailSaleItem, WarehouseType.PROMOTION) — `20261007090000_retail_promotions`
- [x] regenerate tenant-scoped-models
- [x] Backend: promotions engine (คำนวณส่วนลด/ของแถม/ตรวจเงื่อนไข) + unit test
- [x] Backend: CRUD โปรโมชั่น + โค้ด (สร้างเอง / สุ่มทีละชุด) + ของแถม
- [x] Backend: ค้นหา/สมัครสมาชิก (Guest) สำหรับ POS
- [x] Backend: preview endpoint
- [x] Backend: ผูกโปรเข้า `RetailSalesService.create` (transaction เดียว, race-safe counters, ตัดของแถมจากคลังของแถม, redemption, CrmContact upsert)
- [x] Backend: ห้ามขายตรงจากคลังของแถม (`GIFT_WAREHOUSE_NOT_SELLABLE`)
- [x] curl API จริงทุก endpoint (mock Prisma ไม่ผ่าน tenant middleware)
- [x] Frontend: api client + types (`lib/types/retail-promotion.ts`)
- [x] Frontend: หน้า `/dashboard/inventory/promotions` จัดการโปร/โค้ด/ของแถม + เมนู sidebar
- [x] Frontend: POS — เลือกสมาชิก (`MemberPicker`), กรอกโค้ด (`PromoCodeField`), แสดงส่วนลด/ของแถม, "รับเฉพาะส่วนลด"
- [x] Frontend: Modal สรุปการสั่งซื้อแสดงสมาชิก/โค้ด/ของแถม ฿0
- [x] Frontend: ซ่อนคลังของแถมจากตัวเลือกคลังขาย + หน้าคลังสินค้ารู้จัก type `PROMOTION` (เดิมจะพัง)
- [x] Jest ฝั่ง POS + MemberPicker + ฟอร์มโปรโมชั่น
- [x] Seed: คลังของแถม + โปรตัวอย่าง (WELCOME10 / TOTE300 / GOLD50) + `npm run db:refresh`
- [ ] ทดสอบผ่านเบราว์เซอร์จริงทั้ง flow (ยังไม่ได้ทำ — เทสต์อัตโนมัติ + curl ผ่านแล้ว)

### Phase 2 — Void & รายงาน
- [ ] Void/คืนบิล: คืนสต็อกสินค้า + ของแถม (ADJUSTMENT_IN), ลดตัวนับทุกตัว, redemption → REVERSED
- [ ] แจ้งเตือนของแถมใกล้หมด / budget ใกล้เต็ม, auto-pause เมื่อของหมดและโปรไม่มีส่วนลด
- [ ] รายงานโปรโมชั่น: ใช้กี่ครั้ง ยอดขาย ส่วนลด ต้นทุนของแถม ต่อโปร/ต่อโค้ด
- [ ] โอนสต็อกเข้าคลังของแถม (ใช้ transfer เดิม) + หน้าสต็อกคลังของแถม

### Phase 3 — CRM
- [ ] ออกโค้ด UNIQUE ให้สมาชิกตาม segment ผ่าน `CrmCampaign` (LINE/อีเมล) + ติดตาม sent → redeemed
- [ ] event `PROMO_REDEEMED` → crm-event.listener (tag, automation, lifetimeValue retail)
- [ ] หน้า Contact 360 แสดงประวัติการใช้โปร

### Phase 4 — ทางเลือก
- [ ] Loyalty: แลกแต้มเป็นโค้ด / ให้แต้มจากยอดหลังส่วนลด
- [ ] GIFT_WITH_PURCHASE อัตโนมัติ (ไม่ต้องกรอกโค้ด)
- [ ] ใช้หลายโปรร่วมกัน (stacking rules)

## 7. คำถามค้าง
- VAT ของแถมตามมูลค่าตลาด — รอฝ่ายบัญชี
- ข้อความ PDPA consent ตอนสมัครสมาชิกที่ POS (ใช้ consentVersion เดิมของ Guest)

## 8. บันทึกความคืบหน้า
- 2026-10-07 — สรุปข้อตัดสินใจ 5 ข้อ, ออกแบบ data model, เริ่ม Phase 1
- 2026-10-07 — Backend Phase 1 เสร็จ + curl ครบ (preview, ขายพร้อมโค้ด, ของแถมหมด→รับเฉพาะส่วนลด, โควตาเต็ม, ขายจากคลังของแถมถูกปฏิเสธ) · backend spec 80 ผ่าน
- 2026-10-07 — Frontend Phase 1 เสร็จ: หน้าจัดการโปร, POS สมาชิก+โค้ด, modal สรุปบิล · Jest 37 ผ่าน, `tsc --noEmit` 0 error
  - เจอระหว่างทาง: หน้าคลังสินค้าจะพังเมื่อมีคลัง type PROMOTION (แก้แล้ว), POS เลือกคลังของแถมเป็นคลังขายได้ (ซ่อน + กันที่ backend แล้ว)
  - ตั้งข้อสังเกต: Sidebar Jest 24 เคสพังอยู่ก่อนแล้ว (พังเท่าเดิมบน HEAD) — ไม่เกี่ยวกับงานนี้
