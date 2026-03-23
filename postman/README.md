# StaySync Admin Panel - Postman Collection

เอกสารสำหรับทดสอบ API ด้วย Postman

## 📦 ไฟล์ที่มี

1. **StaySync_Admin_Panel_API.postman_collection.json** - Postman Collection ที่มี API endpoints ทั้งหมด
2. **StaySync_Admin_Panel.postman_environment.json** - Environment variables สำหรับ local development

## 🚀 วิธีการใช้งาน

### 1. Import Collection และ Environment

1. เปิด Postman
2. คลิก **Import** (มุมซ้ายบน)
3. เลือกไฟล์:
   - `StaySync_Admin_Panel_API.postman_collection.json`
   - `StaySync_Admin_Panel.postman_environment.json`
4. คลิก **Import**

### 2. เลือก Environment

1. คลิกที่ dropdown "No Environment" (มุมขวาบน)
2. เลือก **"StaySync Admin Panel - Local"**

### 3. Login ก่อนใช้งาน

**IMPORTANT:** ก่อนเรียก API อื่นๆ ต้อง Login ก่อน!

1. เปิด Collection **"StaySync Admin Panel API"**
2. ไปที่ **"1. Authentication"** → **"Login as Platform Admin"**
3. คลิก **Send**

✅ หลังจาก Login สำเร็จ `accessToken` จะถูก save อัตโนมัติใน environment

### 4. เริ่มใช้งาน API

ตอนนี้สามารถเรียก API endpoints อื่นๆ ได้แล้ว!

## 📚 รายการ API Endpoints

### 1. Authentication
- ✅ Login as Platform Admin

### 2. Hotels Management
- ✅ Get All Hotels (with filters)
- ✅ Get Hotels Summary
- ✅ Get Hotel Detail
- ✅ Update Hotel Status

### 3. Invoices Management
- ✅ Get All Invoices (with filters)
- ✅ Get Invoices Summary
- ✅ Approve/Reject Invoice

### 4. Subscriptions Management
- ✅ Get All Subscriptions (with filters)
- ✅ Get Subscriptions Summary
- ✅ Get Subscription Detail
- ✅ Update Subscription Status

### 5. Subscription Features (Add-ons)
- ✅ Get Subscription Add-ons
- ✅ Add New Add-on
- ✅ Update Add-on
- ✅ Remove Add-on
- ✅ Get Add-on Change Logs

### 6. Invoice Adjustments
- ✅ Get Invoice with Line Items
- ✅ Adjust Invoice (Discount/Credit/Surcharge)
- ✅ Void Invoice
- ✅ Update Invoice Line Item
- ✅ Get Invoice Adjustment History

### 7. Billing Cycle Management
- ✅ Get Billing Info
- ✅ Get Billing History
- ✅ Update Billing Cycle
- ✅ Renew Subscription
- ✅ Cancel Renewal

### 8. Refund & Credit System
- ✅ Get Refunds Summary
- ✅ Get All Refunds
- ✅ Create Refund
- ✅ Approve/Reject Refund
- ✅ Get Tenant Credits
- ✅ Add Credit to Tenant
- ✅ Apply Credit to Invoice

## 🔑 Environment Variables

| Variable | Description | Default Value |
|----------|-------------|---------------|
| `baseUrl` | API Base URL | `http://localhost:3000/api/v1` |
| `accessToken` | JWT Token (auto-saved after login) | - |
| `userId` | User ID (auto-saved after login) | - |
| `adminEmail` | Platform Admin Email | `admin@hotelservices.com` |
| `adminPassword` | Platform Admin Password | `Admin@123` |

## 💡 Tips การใช้งาน

### 1. แก้ไข Path Variables

ใน request ที่มี `:variableName` ให้แก้ไขค่า variables:

```
GET /admin/hotels/:hotelId
                  ↑
          แก้ไขตรงนี้
```

**วิธีแก้:**
1. คลิกที่ tab **"Params"**
2. หาตัวแปร `hotelId`
3. ใส่ค่า UUID ที่ต้องการ

### 2. Filter และ Search

ใน requests ที่มี query parameters:

```
GET /admin/hotels?page=1&limit=10&status=active&search=
```

แก้ไขได้ที่ tab **"Params"**:
- `page` - หน้าที่ต้องการ
- `limit` - จำนวนต่อหน้า
- `status` - filter ตาม status
- `search` - ค้นหาตามคำ

### 3. แก้ไข Request Body

ใน POST/PATCH requests:
1. คลิก tab **"Body"**
2. แก้ไข JSON ตามต้องการ
3. คลิก **Send**

### 4. ดู Response

- **Status:** ดูที่มุมขวาบน (200 OK, 400 Bad Request, etc.)
- **Body:** ดู response data ที่ tab "Body"
- **Headers:** ดู response headers ที่ tab "Headers"

## 🐛 Troubleshooting

### 401 Unauthorized
**สาเหตุ:** Token หมดอายุ หรือยังไม่ได้ Login

**แก้ไข:**
1. ไปที่ **"1. Authentication"** → **"Login as Platform Admin"**
2. คลิก **Send** เพื่อ login ใหม่

### 404 Not Found
**สาเหตุ:** UUID ไม่ถูกต้อง หรือ resource ไม่มีในระบบ

**แก้ไข:**
1. ตรวจสอบ UUID ที่ใช้
2. เรียก GET list endpoint ก่อน เพื่อดู UUID ที่มี

### 400 Bad Request
**สาเหตุ:** Request body ไม่ถูกต้อง

**แก้ไข:**
1. ตรวจสอบ JSON format
2. ตรวจสอบ required fields
3. ดู error message ใน response

## 📝 ตัวอย่างการใช้งาน

### Scenario 1: ดูรายการ Subscriptions ทั้งหมด

1. Login (Authentication → Login as Platform Admin)
2. Get All Subscriptions (Subscriptions Management → Get All Subscriptions)
3. ดู response → copy `id` ของ subscription ที่สนใจ
4. Get Subscription Detail (แก้ไข `:subscriptionId` ให้เป็น UUID ที่ copy มา)

### Scenario 2: เพิ่ม Add-on ให้ Subscription

1. Login
2. Get Subscription Add-ons (แก้ไข `:subscriptionId`)
3. ดู response → copy `subscriptionUuid`
4. Add New Add-on:
   - แก้ไข `subscriptionId` ใน body
   - แก้ไข `featureId` (ต้องมี feature ในระบบก่อน)
   - แก้ไข `price` และ `quantity`
   - Send

### Scenario 3: อนุมัติ Invoice

1. Login
2. Get All Invoices (filter by `status=pending`)
3. ดู response → copy `id` ของ invoice ที่ต้องการอนุมัติ
4. Approve/Reject Invoice:
   - แก้ไข `:invoiceId` path variable
   - แก้ไข body → `"status": "approved"`
   - Send

## 🔗 เอกสารเพิ่มเติม

- [API Documentation](../docs/Subscriptions/ADMIN_PANEL_FRONTEND_GUIDE.md)
- [Backend Repository](https://github.com/anthropics/staysync-backend)

---

**Last Updated:** 2024-01-31
**Version:** 1.0.0
