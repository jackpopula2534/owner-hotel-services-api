# Sales Page Integration Guide

## สรุปการอัพเดท

ระบบได้รับการอัพเดทเพื่อรองรับการแสดงผลหน้า Sales Page แบบครบถ้วน พร้อมข้อมูลที่จำเป็นทั้งหมด

---

## 📋 ฟิลด์ใหม่ที่เพิ่มเข้า Plan Entity

| ฟิลด์ | ประเภท | จำเป็น | ค่าเริ่มต้น | คำอธิบาย |
|------|--------|--------|-------------|----------|
| `description` | text | ไม่ | null | คำอธิบายแผน (เช่น "เริ่มต้นใช้งานได้ทันที พร้อมทดลองใช้ฟรี 14 วัน") |
| `displayOrder` | int | ไม่ | 0 | ลำดับการแสดงผล (เลขน้อย = แสดงก่อน) |
| `isPopular` | boolean | ไม่ | false | แสดงแบดจ์ "ยอดนิยม" |
| `badge` | text | ไม่ | null | ข้อความบนแบดจ์ (เช่น "ยอดนิยม", "แนะนำ") |
| `highlightColor` | varchar(50) | ไม่ | null | สี highlight (hex code เช่น "#8B5CF6") |
| `features` | text | ไม่ | null | รายการฟีเจอร์ (JSON array string) |
| `buttonText` | varchar(100) | ไม่ | "เริ่มใช้งาน" | ข้อความบนปุ่ม |

---

## 🔧 ไฟล์ที่ถูกอัพเดท

### 1. Plan Entity
**ไฟล์**: [src/plans/entities/plan.entity.ts](../../src/plans/entities/plan.entity.ts)
- เพิ่มฟิลด์ทั้ง 7 ฟิลด์สำหรับ Sales Page

### 2. Migration
**ไฟล์**: [src/database/migrations/1738301000000-AddSalesPageFieldsToPlans.ts](../../src/database/migrations/1738301000000-AddSalesPageFieldsToPlans.ts)
- Migration สำหรับเพิ่มคอลัมน์ใหม่
- มี rollback (down method) สำหรับลบคอลัมน์

### 3. Admin DTOs
**ไฟล์**: [src/admin/dto/admin-plans.dto.ts](../../src/admin/dto/admin-plans.dto.ts)
- `CreatePlanDto` - รองรับฟิลด์ Sales Page
- `UpdatePlanDto` - รองรับการอัพเดทฟิลด์ Sales Page
- `AdminPlanItemDto` - แสดงฟิลด์ Sales Page ในรายการ
- `PlanResponseDto` - แสดงฟิลด์ Sales Page ในรายละเอียด

### 4. Admin Service
**ไฟล์**: [src/admin/admin-plans.service.ts](../../src/admin/admin-plans.service.ts)
- จัดการฟิลด์ Sales Page ใน CRUD operations

### 5. Public API
**ไฟล์**:
- [src/plans/plans.controller.ts](../../src/plans/plans.controller.ts)
- [src/plans/plans.service.ts](../../src/plans/plans.service.ts)
- [src/plans/dto/public-plans.dto.ts](../../src/plans/dto/public-plans.dto.ts)

---

## 🌐 Public API Endpoints

### GET /api/v1/plans (Sales Page)
ดึงรายการแผนทั้งหมดสำหรับแสดงในหน้า Sales Page

**ไม่ต้องมี Authentication**

**Response**:
```json
{
  "data": [
    {
      "id": "uuid-starter",
      "code": "S",
      "name": "Starter",
      "description": "เริ่มต้นใช้งานได้ทันที พร้อมทดลองใช้ฟรี 14 วัน",
      "priceMonthly": 1990,
      "maxRooms": 20,
      "maxUsers": 3,
      "displayOrder": 1,
      "isPopular": false,
      "badge": null,
      "highlightColor": null,
      "features": [
        "รองรับ 20 ห้อง",
        "ผู้ใช้งาน 3 คน",
        "ระบบจองครบครัน"
      ],
      "buttonText": "เริ่มใช้งาน",
      "addOnFeatures": []
    },
    {
      "id": "uuid-professional",
      "code": "M",
      "name": "Professional",
      "description": "เหมาะสำหรับโรงแรมขนาดกลาง",
      "priceMonthly": 4990,
      "maxRooms": 50,
      "maxUsers": 10,
      "displayOrder": 2,
      "isPopular": true,
      "badge": "ยอดนิยม",
      "highlightColor": "#8B5CF6",
      "features": [
        "รองรับ 50 ห้อง",
        "ผู้ใช้งาน 10 คน",
        "ระบบจองครบครัน",
        "รายงานขั้นสูง",
        "การจัดการหลายสาขา"
      ],
      "buttonText": "เริ่มใช้งาน",
      "addOnFeatures": [
        {
          "code": "extra-analytics",
          "name": "Extra Analytics",
          "priceMonthly": 990
        }
      ]
    },
    {
      "id": "uuid-enterprise",
      "code": "L",
      "name": "Enterprise",
      "description": "สำหรับองค์กรขนาดใหญ่",
      "priceMonthly": 9990,
      "maxRooms": 200,
      "maxUsers": 50,
      "displayOrder": 3,
      "isPopular": false,
      "badge": null,
      "highlightColor": null,
      "features": [
        "รองรับ 200 ห้อง",
        "ผู้ใช้งาน 50 คน",
        "ระบบจองครบครัน",
        "รายงานขั้นสูง",
        "การจัดการหลายสาขา",
        "API Integration",
        "Dedicated Support"
      ],
      "buttonText": "ติดต่อฝ่ายขาย",
      "addOnFeatures": []
    }
  ],
  "total": 3
}
```

---

## 🛠️ วิธีใช้งาน Admin API

### สร้างแผนใหม่พร้อมข้อมูล Sales Page

**POST /api/v1/admin/plans**

```bash
curl -X POST http://localhost:3000/api/v1/admin/plans \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "M",
    "name": "Professional",
    "priceMonthly": 4990,
    "maxRooms": 50,
    "maxUsers": 10,
    "isActive": true,
    "description": "เหมาะสำหรับโรงแรมขนาดกลาง พร้อมฟีเจอร์ครบครัน",
    "displayOrder": 2,
    "isPopular": true,
    "badge": "ยอดนิยม",
    "highlightColor": "#8B5CF6",
    "features": "[\"รองรับ 50 ห้อง\", \"ผู้ใช้งาน 10 คน\", \"ระบบจองครบครัน\", \"รายงานขั้นสูง\"]",
    "buttonText": "เริ่มใช้งาน"
  }'
```

### อัพเดทข้อมูล Sales Page

**PATCH /api/v1/admin/plans/:id**

```bash
curl -X PATCH http://localhost:3000/api/v1/admin/plans/uuid-1234 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "isPopular": true,
    "badge": "ยอดนิยม",
    "highlightColor": "#8B5CF6",
    "features": "[\"รองรับ 50 ห้อง\", \"ผู้ใช้งาน 10 คน\", \"ระบบจองครบครัน\"]"
  }'
```

---

## 💻 ตัวอย่างการใช้งานใน Frontend

### React/Next.js Example

```typescript
// ดึงข้อมูลแผนสำหรับ Sales Page
async function getPlansForSalesPage() {
  const response = await fetch('http://localhost:3000/api/v1/plans');
  const data = await response.json();
  return data;
}

// แสดงผลในหน้า Sales Page
function SalesPage() {
  const [plans, setPlans] = useState([]);

  useEffect(() => {
    getPlansForSalesPage().then((data) => {
      setPlans(data.data);
    });
  }, []);

  return (
    <div className="plans-container">
      {plans.map((plan) => (
        <div
          key={plan.id}
          className="plan-card"
          style={{
            borderColor: plan.isPopular ? plan.highlightColor : '#e5e7eb',
          }}
        >
          {/* Badge */}
          {plan.isPopular && plan.badge && (
            <div
              className="badge"
              style={{ backgroundColor: plan.highlightColor }}
            >
              {plan.badge}
            </div>
          )}

          {/* Plan Name */}
          <h3>{plan.name}</h3>

          {/* Price */}
          <div className="price">
            ฿{plan.priceMonthly.toLocaleString()}/เดือน
          </div>

          {/* Description */}
          {plan.description && (
            <p className="description">{plan.description}</p>
          )}

          {/* Features */}
          <ul className="features">
            {plan.features?.map((feature, index) => (
              <li key={index}>✓ {feature}</li>
            ))}
          </ul>

          {/* Add-on Features */}
          {plan.addOnFeatures && plan.addOnFeatures.length > 0 && (
            <div className="addon-features">
              <h4>ฟีเจอร์เสริม:</h4>
              {plan.addOnFeatures.map((addon) => (
                <div key={addon.code}>
                  {addon.name} (+฿{addon.priceMonthly})
                </div>
              ))}
            </div>
          )}

          {/* CTA Button */}
          <button
            className="cta-button"
            style={{
              backgroundColor: plan.isPopular ? plan.highlightColor : '#6b7280',
            }}
          >
            {plan.buttonText}
          </button>
        </div>
      ))}
    </div>
  );
}
```

---

## 📝 ตัวอย่างข้อมูลสำหรับแผน 3 ระดับ

### Starter Plan
```json
{
  "code": "S",
  "name": "Starter",
  "priceMonthly": 1990,
  "maxRooms": 20,
  "maxUsers": 3,
  "description": "เริ่มต้นใช้งานได้ทันที พร้อมทดลองใช้ฟรี 14 วัน",
  "displayOrder": 1,
  "isPopular": false,
  "features": "[\"รองรับ 20 ห้อง\", \"ผู้ใช้งาน 3 คน\", \"ระบบจองครบครัน\"]",
  "buttonText": "เริ่มใช้งาน"
}
```

### Professional Plan (ยอดนิยม)
```json
{
  "code": "M",
  "name": "Professional",
  "priceMonthly": 4990,
  "maxRooms": 50,
  "maxUsers": 10,
  "description": "เหมาะสำหรับโรงแรมขนาดกลาง พร้อมฟีเจอร์ครบครัน",
  "displayOrder": 2,
  "isPopular": true,
  "badge": "ยอดนิยม",
  "highlightColor": "#8B5CF6",
  "features": "[\"รองรับ 50 ห้อง\", \"ผู้ใช้งาน 10 คน\", \"ระบบจองครบครัน\"]",
  "buttonText": "เริ่มใช้งาน"
}
```

### Enterprise Plan
```json
{
  "code": "L",
  "name": "Enterprise",
  "priceMonthly": 9990,
  "maxRooms": 200,
  "maxUsers": 50,
  "description": "สำหรับองค์กรขนาดใหญ่ พร้อม dedicated support",
  "displayOrder": 3,
  "isPopular": false,
  "features": "[\"รองรับ 200 ห้อง\", \"ผู้ใช้งาน 50 คน\", \"ระบบจองครบครัน\"]",
  "buttonText": "ติดต่อฝ่ายขาย"
}
```

---

## 🗄️ Database Migration

### Development Mode
ใน development mode (`NODE_ENV=development`), TypeORM จะ auto-sync schema โดยอัตโนมัติ

### Production Mode
สำหรับ production ควรรัน migration manually:

```bash
# รัน migration
npm run migration:run

# Rollback migration (ถ้าจำเป็น)
npm run migration:revert
```

---

## ✅ Checklist สำหรับ Frontend Integration

- [ ] ดึงข้อมูลจาก `GET /api/v1/plans`
- [ ] แสดง badge "ยอดนิยม" สำหรับแผนที่ `isPopular: true`
- [ ] ใช้ `highlightColor` สำหรับ highlight card
- [ ] แสดงฟีเจอร์จาก `features` array
- [ ] แสดงฟีเจอร์เสริมจาก `addOnFeatures` (ถ้ามี)
- [ ] เรียงแผนตาม `displayOrder`
- [ ] ใช้ `buttonText` สำหรับข้อความบนปุ่ม
- [ ] แสดง `description` ถ้ามี

---

## 🔒 Security Notes

- **Public API** (`/api/v1/plans`) ไม่ต้องมี authentication
- **Admin API** (`/api/v1/admin/plans`) ต้องมี JWT token และ `platform_admin` role
- Features ถูกเก็บเป็น JSON string ใน database
- Frontend ต้อง parse JSON string เป็น array ก่อนแสดงผล

---

## 📞 Support

หากมีปัญหาหรือคำถาม กรุณาติดต่อทีมพัฒนา
