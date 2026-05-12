---
name: hotel-management-expert
description: |
  ผู้เชี่ยวชาญด้านระบบจัดการโรงแรม (Hotel Management Expert) — PMS, Revenue Management, Hotel Operations, OTA, SOP ของโรงแรมไทยและสากล

  ใช้ทุกครั้งที่มีคำถาม/งานเกี่ยวกับ: hotel workflow, SOP โรงแรม, check-in/check-out flow, booking logic, revenue management (ADR/RevPAR/occupancy), OTA integration (Booking.com/Agoda/channel manager), housekeeping workflow, room status, F&B/restaurant POS, guest experience, loyalty program, VIP handling, hotel HR/shift management, front desk operations, night audit, folio management, database schema สำหรับโรงแรม, business logic ตาม industry standard, มาตรฐานโรงแรม 5 ดาว

  ใช้ก่อนออกแบบ feature ใหม่ใน StaySync เสมอ เพื่อให้ logic ตรงความเป็นจริงของโรงแรม
---

# Hotel Management Expert

ความรู้เชิงลึกเรื่องการจัดการโรงแรม สำหรับออกแบบและพัฒนา StaySync Hotel SaaS ให้ตรงกับความต้องการจริงของโรงแรม

---

## ภาพรวม Hotel Operations

โรงแรมมีแผนกหลักที่ต้องทำงานร่วมกัน:

```
Front Office ←→ Housekeeping ←→ Maintenance
     ↕               ↕
  F&B/Restaurant   Revenue Mgmt
     ↕               ↕
   Finance         HR/Payroll
```

---

## 1. Front Office / Reservations

### Booking Flow (การจอง)
```
ลูกค้าจอง → Check Availability → Create Reservation → Confirmation Email
    ↓
  Check-in → Assign Room → Issue Key → Post Charges
    ↓
  Stay → Daily Folio → Additional Charges (minibar, laundry, F&B)
    ↓
  Check-out → Final Folio Review → Payment → Key Return → Room Released
```

### Room Status Flow (สถานะห้อง)
- **Vacant Clean (VC)** — ว่าง สะอาด พร้อม check-in
- **Vacant Dirty (VD)** — ว่าง ยังไม่ทำความสะอาด (หลัง check-out)
- **Occupied Clean (OC)** — มีแขก ทำความสะอาดแล้ว
- **Occupied Dirty (OD)** — มีแขก ยังไม่ทำความสะอาด
- **Out of Order (OOO)** — ซ่อม/บำรุง ใช้งานไม่ได้
- **Out of Service (OOS)** — พักการใช้งานชั่วคราว (ทำความสะอาดใหญ่ ฯลฯ)

**กฎ:** ห้องต้องเป็น VC เท่านั้นก่อน assign ให้ลูกค้า

### Folio Management
- **Guest Folio** — บิลค่าใช้จ่ายของแขกแต่ละคน
- **Room Folio** — ค่าห้อง + ค่าบริการที่เกี่ยวกับห้อง
- **City Ledger** — ลูกค้า corporate ที่จ่ายทีหลัง (เครดิต)
- **Split Folio** — แยกบิล (เช่น บิลค่าห้องแขก, บิลค่า F&B บริษัทออกให้)

### Check-in/Check-out Best Practices
- Standard check-in: 14:00, check-out: 12:00 (ปรับได้ตาม property)
- Early check-in / Late check-out → คิดค่าใช้จ่ายเพิ่ม หรือ complimentary ตามสถานะสมาชิก
- Walk-in guest → ต้องตรวจ availability real-time
- Group booking → ต้องจัดการ rooming list แยก

---

## 2. Revenue Management

### KPIs หลักที่โรงแรมดู
| KPI | สูตร | ความหมาย |
|-----|------|-----------|
| **Occupancy Rate** | Rooms Sold / Total Rooms × 100 | % ห้องที่ขายได้ |
| **ADR** (Average Daily Rate) | Revenue / Rooms Sold | ราคาเฉลี่ยต่อห้อง |
| **RevPAR** | Occupancy × ADR | Revenue per Available Room |
| **GOPPAR** | GOP / Available Rooms | Gross Operating Profit per Room |
| **TrevPAR** | Total Revenue / Available Rooms | รวม F&B, Spa ฯลฯ |

### Dynamic Pricing Logic
```
ราคาฐาน (Base Rate)
  × Occupancy Factor (ยิ่ง occupancy สูง ราคายิ่งแพง)
  × Season Factor (high season / low season)
  × Lead Time Factor (จองล่วงหน้านาน ราคาถูกกว่า)
  × Channel Factor (direct booking ราคาดีกว่า OTA)
  = Final Rate
```

### Rate Types ที่ต้องรู้
- **BAR** (Best Available Rate) — ราคาดีที่สุดที่ขายได้ตอนนี้
- **Corporate Rate** — ราคา contract บริษัท (ถูกกว่า BAR)
- **Package Rate** — รวม breakfast / spa / transfer
- **Wholesale Rate** — ราคาขายส่ง ให้ tour operator
- **Rack Rate** — ราคาเต็มตามป้าย (ไม่ discount)

---

## 3. Housekeeping

### Daily Workflow
```
เช้า: รับ Departure List + Stay-over List
  ↓
Assign tasks ให้ housekeeper แต่ละคน (10-14 ห้องต่อคนต่อวัน)
  ↓
ทำห้อง: Check-out rooms ก่อน (VD → VC) เพื่อ sell ได้เร็ว
  ↓
Stay-over rooms: ทำความสะอาดประจำวัน
  ↓
Inspection: หัวหน้า inspect ก่อน mark VC
  ↓
เย็น: Turndown service สำหรับ occupied rooms
```

### Housekeeping Task Priorities
1. **Checkout rooms** (priority สูงสุด — ต้องขายให้ได้เร็ว)
2. **VIP/Loyalty member rooms**
3. **Requested time rooms** (แขกแจ้งเวลา)
4. **Stay-over rooms**

### Lost & Found Management
- บันทึกทุกอย่างที่พบ: วันที่, ห้อง, รายละเอียด, ผู้พบ
- เก็บรักษา 90 วัน
- ติดต่อแขกหากทราบข้อมูล

---

## 4. OTA & Channel Management

### OTAs หลักที่ใช้ในไทย
- **Booking.com** — ใหญ่ที่สุด, commission 15-18%
- **Agoda** — เน้นเอเชีย, commission 15-20%
- **Expedia / Hotels.com** — ตลาดตะวันตก
- **Trip.com** — ตลาดจีน
- **AirBnB** — ตลาด boutique/unique stays

### Channel Manager Logic
```
PMS Inventory Pool
  ↓ (sync real-time)
Channel Manager
  ↓ (API connection)
OTA 1 | OTA 2 | OTA 3 | Direct Booking

กฎ: ขาย 1 ห้องที่ไหนก็ตาม → ลด inventory ทุก channel ทันที
```

### Rate Parity
โรงแรมส่วนใหญ่มีข้อตกลงกับ OTA ว่าราคาต้องไม่ต่ำกว่า OTA (rate parity) แต่โรงแรมสามารถให้ราคาพิเศษสำหรับ direct booking ผ่าน perks เช่น breakfast, room upgrade

---

## 5. F&B (Food & Beverage)

### Restaurant Operations
- **Cover count** — จำนวนที่นั่งที่ขายได้ต่อรอบ
- **Table turn** — ความถี่ที่โต๊ะหนึ่งถูกใช้ต่อมื้อ
- **Food cost %** — ต้นทุนวัตถุดิบ / ยอดขาย × 100 (เป้า 28-32%)

### Room Service Flow
```
แขกสั่ง → รับออเดอร์ (phone/app) → ครัวทำ
→ Delivery → Post to Room Folio → Signature
```

### Minibar
- Daily check โดย housekeeping
- บันทึกของที่ใช้ → post ลง folio อัตโนมัติ

---

## 6. Guest Experience & Loyalty

### Guest Profile Data ที่ควรเก็บ
```
ข้อมูลพื้นฐาน: ชื่อ, อีเมล, โทรศัพท์, วันเกิด, สัญชาติ
Preferences: ชั้นที่ชอบ, หมอน, อุณหภูมิ, อาหาร, เตียง (king/twin)
Special needs: wheelchair, allergy, ยาที่ต้องใช้
Stay history: จำนวนครั้ง, ยอดใช้จ่ายรวม, room types
Loyalty tier: Regular / Silver / Gold / Platinum
Complaints/incidents: บันทึกเพื่อป้องกันซ้ำ
```

### VIP Handling Checklist
- Pre-arrival: เตรียม amenities, welcome note, ดอกไม้
- Check-in: Fast track, upgrade (ถ้ามี), personal escort
- During stay: Check ทุกวัน, proactive problem solving
- Check-out: Express checkout, feedback collection

### Loyalty Program Tiers (ตัวอย่าง)
| Tier | คืนต่อปี | สิทธิ์ |
|------|----------|--------|
| Regular | 0-9 | ราคา member |
| Silver | 10-24 | Late checkout, welcome drink |
| Gold | 25-49 | Room upgrade, breakfast |
| Platinum | 50+ | Suite upgrade, butler, lounge |

---

## 7. Night Audit

Night Audit คือ process ปิดยอดประจำวัน — ทำตอนกลางดึก (00:00-02:00)

**ขั้นตอน:**
1. Post room charges ทุกห้อง (ค่าห้องคืนนี้)
2. ตรวจ in-house balance (folio ถูกต้อง)
3. Run occupancy / revenue reports
4. No-show processing (ยกเลิก/เก็บค่า cancellation)
5. Generate daily summary
6. "Roll date" — เปลี่ยนวันระบบเป็นวันถัดไป

---

## 8. Thai Hotel Industry Context

### Star Classification (มาตรฐานไทย)
- **1-2 ดาว**: Budget, basic amenities
- **3 ดาว**: Mid-scale, breakfast, pool
- **4 ดาว**: Superior, gym, multiple dining
- **5 ดาว**: Luxury, full service, concierge

### ข้อกฎหมายที่เกี่ยวข้อง
- **พ.ร.บ. โรงแรม 2547**: ต้องจดทะเบียน, มีใบอนุญาต
- **ทะเบียนผู้เข้าพัก**: ต้องส่งข้อมูลให้ตำรวจภายใน 24 ชม. (ต่างชาติ)
- **VAT 7%** + **Service Charge 10%** (บางโรงแรม)
- **ภาษีธุรกิจเฉพาะ** สำหรับโรงแรมขนาดใหญ่

### Seasons ในไทย
- **High Season**: พ.ย. — เม.ย. (นักท่องเที่ยวต่างชาติ)
- **Low Season**: พ.ค. — ต.ค. (ฝน, นักท่องเที่ยวไทยมากขึ้น)
- **Peak**: ปีใหม่, สงกรานต์, คริสต์มาส (ราคาสูงสุด)

---

## 9. PMS Integrations ที่โรงแรมต้องการ

| Integration | ประโยชน์ |
|-------------|----------|
| **Channel Manager** | sync inventory/rate กับ OTA |
| **Payment Gateway** | รับชำระเงิน online (Stripe, Omise, 2C2P) |
| **Door Lock System** | issue key card อัตโนมัติตอน check-in |
| **POS (F&B)** | post charges จาก restaurant ลง room folio |
| **Accounting** | export ไป QuickBooks / เอกสาร บัญชี |
| **LINE/Email** | ส่ง confirmation, pre-arrival, post-stay |
| **PromptPay** | QR payment ยอดนิยมในไทย |
| **ID Scanner** | อ่านบัตร/พาสปอร์ต auto-fill ข้อมูล |

---

## เมื่อออกแบบ Feature ใหม่

ให้ตั้งคำถามเหล่านี้ก่อน:

1. **Who** — ใครใช้? (receptionist, housekeeper, manager, guest)
2. **When** — ใช้ตอนไหน? (check-in, during stay, check-out, back-office)
3. **Data** — ต้องการข้อมูลอะไร? เก็บอะไร?
4. **Rules** — มี business rules อะไร? (เช่น ห้องต้อง VC ก่อน assign)
5. **Integration** — เชื่อมกับแผนกอื่น/ระบบอื่นไหม?
6. **Reporting** — manager ต้องการ report อะไรจาก feature นี้?
