# Yearly Pricing & Discount Guide

## การกำหนดราคารายปีและส่วนลด

---

## 📊 โครงสร้างราคาที่แนะนำ

### แนวทางการกำหนดส่วนลดรายปี

| Plan | ราคารายเดือน | ส่วนลดรายปี | ราคารายปี | ประหยัดต่อปี |
|------|-------------|-------------|-----------|--------------|
| **Starter** | ฿1,990/เดือน | **10%** | ฿21,492/ปี | ฿2,388 |
| **Professional** | ฿4,990/เดือน | **15%** | ฿50,898/ปี | ฿8,982 |
| **Enterprise** | ฿9,990/เดือน | **20%** | ฿95,904/ปี | ฿23,976 |

**หลักการ:**
- แพ็กเกจที่แพงกว่า = ส่วนลดมากกว่า (เพื่อดึงดูดองค์กรขนาดใหญ่)
- ส่วนลด 10-20% เป็นมาตรฐาน SaaS
- ทำให้ลูกค้าเห็นมูลค่าในการจ่ายรายปี

---

## 🔧 ฟิลด์ที่เพิ่มเข้า Plan Entity

### 1. `priceYearly` (Decimal, Nullable)
```typescript
@Column({ name: 'price_yearly', type: 'decimal', precision: 10, scale: 2, nullable: true })
priceYearly: number;
```

**วิธีใช้:**
- **กรณีที่ 1**: ระบุราคารายปีโดยตรง (Fixed Price)
  ```json
  {
    "priceMonthly": 4990,
    "priceYearly": 50000 // ราคาพิเศษ
  }
  ```

- **กรณีที่ 2**: ปล่อยให้คำนวณอัตโนมัติจาก discount
  ```json
  {
    "priceMonthly": 4990,
    "yearlyDiscountPercent": 15
    // priceYearly จะถูกคำนวณเป็น: 4990 * 12 * 0.85 = 50,898
  }
  ```

### 2. `yearlyDiscountPercent` (Integer, 0-100)
```typescript
@Column({ name: 'yearly_discount_percent', type: 'int', default: 0 })
yearlyDiscountPercent: number;
```

**วิธีใช้:**
```json
{
  "yearlyDiscountPercent": 15 // ส่วนลด 15%
}
```

---

## 🎯 วิธีการคำนวณ

### Auto-Calculation Logic

```typescript
// ถ้าไม่มี priceYearly แต่มี yearlyDiscountPercent
if (!priceYearly && yearlyDiscountPercent > 0) {
  const monthlyTotal = priceMonthly * 12;
  priceYearly = monthlyTotal * (1 - yearlyDiscountPercent / 100);
}

// คำนวณส่วนลดที่ประหยัดได้
if (priceYearly) {
  yearlySavings = (priceMonthly * 12) - priceYearly;
}
```

### ตัวอย่างการคำนวณ

**Professional Plan:**
```
Monthly Price: ฿4,990
Yearly Discount: 15%

Calculation:
- Monthly Total: 4,990 × 12 = ฿59,880
- Discount Amount: 59,880 × 0.15 = ฿8,982
- Yearly Price: 59,880 - 8,982 = ฿50,898
- Savings: ฿8,982/year
```

---

## 💻 วิธีใช้งาน Admin API

### 1. สร้างแผนพร้อมส่วนลดรายปี (Auto-Calculate)

**แนะนำ**: ให้ระบบคำนวณราคารายปีอัตโนมัติ

```bash
curl -X POST http://localhost:3000/api/v1/admin/plans \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "M",
    "name": "Professional",
    "priceMonthly": 4990,
    "yearlyDiscountPercent": 15,
    "maxRooms": 50,
    "maxUsers": 10,
    "description": "เหมาะสำหรับโรงแรมขนาดกลาง",
    "isPopular": true,
    "badge": "ยอดนิยม"
  }'
```

**Response:**
```json
{
  "id": "uuid-1234",
  "code": "M",
  "name": "Professional",
  "priceMonthly": 4990,
  "priceYearly": 50898,
  "yearlyDiscountPercent": 15,
  "maxRooms": 50,
  "maxUsers": 10
}
```

---

### 2. สร้างแผนพร้อมราคารายปีกำหนดเอง (Fixed Price)

**Use Case**: ต้องการกำหนดราคาพิเศษ

```bash
curl -X POST http://localhost:3000/api/v1/admin/plans \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "M",
    "name": "Professional",
    "priceMonthly": 4990,
    "priceYearly": 50000,
    "yearlyDiscountPercent": 16,
    "maxRooms": 50,
    "maxUsers": 10
  }'
```

**Response:**
```json
{
  "priceMonthly": 4990,
  "priceYearly": 50000,
  "yearlyDiscountPercent": 16
}
```

---

### 3. อัพเดทส่วนลด

```bash
curl -X PATCH http://localhost:3000/api/v1/admin/plans/uuid-1234 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "yearlyDiscountPercent": 20
  }'
```

**Note**: ระบบจะคำนวณ `priceYearly` ใหม่อัตโนมัติ

---

## 🌐 Public API Response

### GET /api/v1/plans

```json
{
  "data": [
    {
      "id": "uuid-starter",
      "code": "S",
      "name": "Starter",
      "priceMonthly": 1990,
      "priceYearly": 21492,
      "yearlyDiscountPercent": 10,
      "yearlySavings": 2388,
      "maxRooms": 20,
      "maxUsers": 3,
      "features": [...]
    },
    {
      "id": "uuid-professional",
      "code": "M",
      "name": "Professional",
      "priceMonthly": 4990,
      "priceYearly": 50898,
      "yearlyDiscountPercent": 15,
      "yearlySavings": 8982,
      "maxRooms": 50,
      "maxUsers": 10,
      "isPopular": true,
      "badge": "ยอดนิยม",
      "features": [...]
    },
    {
      "id": "uuid-enterprise",
      "code": "L",
      "name": "Enterprise",
      "priceMonthly": 9990,
      "priceYearly": 95904,
      "yearlyDiscountPercent": 20,
      "yearlySavings": 23976,
      "maxRooms": 200,
      "maxUsers": 50,
      "features": [...]
    }
  ],
  "total": 3
}
```

---

## 🎨 Frontend Integration Examples

### React/Next.js - Pricing Toggle

```typescript
'use client';

import { useState } from 'react';

export default function PricingPage() {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [plans, setPlans] = useState([]);

  // Fetch plans...

  return (
    <div>
      {/* Billing Cycle Toggle */}
      <div className="billing-toggle">
        <button
          className={billingCycle === 'monthly' ? 'active' : ''}
          onClick={() => setBillingCycle('monthly')}
        >
          รายเดือน
        </button>
        <button
          className={billingCycle === 'yearly' ? 'active' : ''}
          onClick={() => setBillingCycle('yearly')}
        >
          รายปี
          <span className="discount-badge">ประหยัดสูงสุด 20%</span>
        </button>
      </div>

      {/* Plans Grid */}
      <div className="plans-grid">
        {plans.map(plan => (
          <div key={plan.id} className="plan-card">
            <h3>{plan.name}</h3>

            {/* Price Display */}
            <div className="price">
              {billingCycle === 'monthly' ? (
                <>
                  <span className="amount">
                    ฿{plan.priceMonthly.toLocaleString()}
                  </span>
                  <span className="period">/เดือน</span>
                </>
              ) : (
                <>
                  <span className="amount">
                    ฿{plan.priceYearly?.toLocaleString()}
                  </span>
                  <span className="period">/ปี</span>
                  {plan.yearlySavings && (
                    <div className="savings">
                      ประหยัด ฿{plan.yearlySavings.toLocaleString()}/ปี
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Discount Badge */}
            {billingCycle === 'yearly' && plan.yearlyDiscountPercent > 0 && (
              <div className="discount-badge">
                ส่วนลด {plan.yearlyDiscountPercent}%
              </div>
            )}

            {/* Features */}
            <ul className="features">
              {plan.features?.map((feature, i) => (
                <li key={i}>✓ {feature}</li>
              ))}
            </ul>

            <button className="cta-button">
              {plan.buttonText}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

### CSS สำหรับ Discount Badge

```css
.discount-badge {
  display: inline-block;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  margin-left: 8px;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
}

.savings {
  color: #10b981;
  font-size: 14px;
  font-weight: 600;
  margin-top: 8px;
}

.billing-toggle {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-bottom: 40px;
}

.billing-toggle button {
  padding: 12px 24px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  background: white;
  cursor: pointer;
  transition: all 0.3s;
}

.billing-toggle button.active {
  background: #8B5CF6;
  color: white;
  border-color: #8B5CF6;
}
```

---

## 📈 แนะนำกลยุทธ์ส่วนลด

### 1. **Starter Plan - 10%**
```
Monthly: ฿1,990
Yearly: ฿21,492 (ประหยัด ฿2,388)

เหตุผล: ส่วนลดเล็กน้อยเพื่อดึงดูดผู้ใช้ใหม่
```

### 2. **Professional Plan - 15%** ⭐ (แนะนำ)
```
Monthly: ฿4,990
Yearly: ฿50,898 (ประหยัด ฿8,982)

เหตุผล:
- แผนยอดนิยม ให้ส่วนลดปานกลาง
- ดึงดูด SME ให้จ่ายรายปี
- Sweet spot สำหรับ conversion
```

### 3. **Enterprise Plan - 20%** (สูงสุด)
```
Monthly: ฿9,990
Yearly: ฿95,904 (ประหยัด ฿23,976)

เหตุผล:
- แผนราคาสูง ให้ส่วนลดมากที่สุด
- ดึงดูดองค์กรขนาดใหญ่ให้ commit ระยะยาว
- ลดการยกเลิก subscription
```

---

## 🎯 Best Practices

### 1. **แสดงการประหยัดให้ชัดเจน**
```
❌ ไม่ดี: "฿50,898/ปี"
✅ ดี: "฿50,898/ปี (ประหยัด ฿8,982)"
```

### 2. **เน้น Value Proposition**
```html
<div class="yearly-highlight">
  🎉 จ่ายรายปี ประหยัดสูงสุด 20%
</div>
```

### 3. **Default เป็นรายปีสำหรับแผนที่แพง**
```typescript
// Auto-select yearly for Enterprise
const defaultBilling = plan.code === 'L' ? 'yearly' : 'monthly';
```

### 4. **แสดง ROI Calculator**
```typescript
function calculateROI(plan, billingCycle) {
  if (billingCycle === 'yearly') {
    const monthlyEquivalent = plan.priceYearly / 12;
    const savings = plan.priceMonthly - monthlyEquivalent;
    return {
      monthlyRate: monthlyEquivalent,
      savingsPerMonth: savings,
      savingsPerYear: plan.yearlySavings
    };
  }
}
```

---

## 🔄 การอัพเดทข้อมูลใน Database

### วิธีที่ 1: ใช้ Seeder (แนะนำ)

```bash
npm run db:refresh
```

### วิธีที่ 2: อัพเดทผ่าน SQL

```sql
-- อัพเดทส่วนลดรายปีทั้งหมด
UPDATE plans
SET
  yearly_discount_percent = CASE code
    WHEN 'S' THEN 10
    WHEN 'M' THEN 15
    WHEN 'L' THEN 20
  END,
  price_yearly = CASE code
    WHEN 'S' THEN 1990 * 12 * 0.9  -- 21,492
    WHEN 'M' THEN 4990 * 12 * 0.85 -- 50,898
    WHEN 'L' THEN 9990 * 12 * 0.8  -- 95,904
  END;
```

### วิธีที่ 3: ใช้ Admin API

```bash
# Update Starter Plan
curl -X PATCH http://localhost:3000/api/v1/admin/plans/starter-uuid \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"yearlyDiscountPercent": 10}'

# Update Professional Plan
curl -X PATCH http://localhost:3000/api/v1/admin/plans/professional-uuid \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"yearlyDiscountPercent": 15}'

# Update Enterprise Plan
curl -X PATCH http://localhost:3000/api/v1/admin/plans/enterprise-uuid \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"yearlyDiscountPercent": 20}'
```

---

## 📊 Analytics & Tracking

### Metrics ที่ควรติดตาม

```typescript
// 1. Conversion Rate: Monthly vs Yearly
const yearlyConversionRate =
  (yearlySubscriptions / totalSubscriptions) * 100;

// 2. Average Revenue Per User (ARPU)
const arpuMonthly = totalMonthlyRevenue / monthlySubscribers;
const arpuYearly = (totalYearlyRevenue / 12) / yearlySubscribers;

// 3. Customer Lifetime Value (LTV)
const ltvMonthly = arpuMonthly * avgMonthsSubscribed;
const ltvYearly = arpuYearly * 12; // 1 year committed

// 4. Discount Impact
const discountGiven = (monthlyPrice * 12) - yearlyPrice;
const discountROI = ltvYearly / discountGiven;
```

---

## ⚠️ คำเตือนและข้อควรระวัง

### 1. **การเปลี่ยนส่วนลด**
- ⚠️ การเพิ่มส่วนลดจะกระทบ MRR
- ✅ ควรแจ้งลูกค้าเก่าล่วงหน้าถ้าจะลดส่วนลด
- ✅ Grandfather existing customers (ให้ส่วนลดเดิม)

### 2. **Pro-rata Refund**
- ถ้าลูกค้าจ่ายรายปีแล้วยกเลิกก่อนครบปี ควรคืนเงิน pro-rata หรือไม่?
- แนะนำ: No refund แต่ให้ใช้ต่อจนครบปี

### 3. **Price Changes**
```typescript
// บันทึกราคาที่ลูกค้าซื้อจริง
subscription {
  planId: "...",
  purchasedPrice: 50898, // ราคาที่จ่ายจริง
  purchasedPeriod: "yearly",
  purchasedDate: "2024-01-15"
}
```

---

## 📚 เอกสารเพิ่มเติม

- [Sales Page Integration](./SALES_PAGE_INTEGRATION.md)
- [Database Seeder Guide](./DATABASE_SEEDER_GUIDE.md)
- [Admin Plans API](./ADMIN_PLANS_API.md)
