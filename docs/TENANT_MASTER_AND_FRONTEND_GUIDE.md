# สรุป Master ฝั่งผู้เช่า (Tenant) และแนวทางพัฒนาหน้าบ้าน

> เอกสารสรุป: ข้อมูล Master ที่ผู้เช่า (โรงแรม) ต้อง Setup และแนวทางการพัฒนา Frontend สำหรับ PMS

---

## ส่วนที่ 1: Master Data ที่ผู้เช่าต้อง Setup

ผู้เช่า (โรงแรม) ใช้ระบบ PMS ต้องตั้งค่าข้อมูล Master ดังนี้ เพื่อให้แดชบอร์ดและการจองทำงานได้ครบ

### 1. ข้อมูลโรงแรม / บัญชี (จาก Onboarding / Admin)

| รายการ | รายละเอียด | หมายเหตุ |
|--------|------------|----------|
| สร้างโรงแรม (Tenant) | ชื่อโรงแรม, จำนวนห้อง, แพ็กเกจ (S/M/L), ข้อมูลลูกค้า/ที่อยู่ | สร้างผ่าน Onboarding หรือ Admin Panel |
| บัญชีผู้ใช้ (Users) | อีเมล, รหัสผ่าน, ชื่อ-นามสกุล, บทบาท (tenant_admin, manager, staff) | แต่ละ User ผูกกับ `tenantId` — ใช้ล็อกอินแล้วระบบจะกรองข้อมูลตามโรงแรมอัตโนมัติ |

### 2. Master ที่ต้อง Setup ใน PMS (หลังล็อกอิน)

| Master | ฟิลด์หลัก | ใช้ใน UI |
|--------|-----------|----------|
| **ห้องพัก (Rooms)** | เลขห้อง, ประเภท (single/double/suite), ชั้น, ราคา, สถานะ (available/occupied/maintenance) | แดชบอร์ด (ห้องว่าง), จองห้อง, จัดการห้องพัก |
| **แขก (Guests)** | ชื่อ, นามสกุล, อีเมล, โทร, ที่อยู่ | ข้อมูลแขก, ลูกค้าเข้าพักวันนี้, ฟอร์มจอง |
| **พนักงาน (Employees)** | ชื่อ, อีเมล, รหัสพนักงาน, แผนก, ตำแหน่ง, วันเริ่มงาน | เมนูพนักงาน, การจัดการบุคลากร |
| **ช่องทางการจอง (Channels)** | ชื่อ, รหัส, ประเภท (ota/direct/corporate), API key/secret (ถ้าใช้ OTA) | การจองจาก OTA, รายงานช่องทาง |
| **ร้านอาหาร (Restaurant)** | ชื่อ, รหัส, ที่ตั้ง, ความจุ | เมนูร้านอาหาร (ถ้าใช้) |
| **การจอง (Bookings)** | แขก, ห้อง, วันที่เข้า-ออก, ช่องทาง, สถานะ | จองห้อง, การจองล่าสุด, สถิติ |
| **รีวิว (Reviews)** | ผูกกับ Booking, คะแนน, ความคิดเห็น | สถิติรีวิว, QR รีวิว |

### 3. ลำดับการ Setup แนะนำ (สำหรับผู้เช่า)

1. **ล็อกอิน** ด้วย User ที่มี `tenantId` (เช่น tenant_admin ของโรงแรม)
2. **ห้องพัก** — สร้าง Room ก่อน (ต้องมีก่อนจอง)
3. **แขก** — สร้างหรือเลือกแขกตอนจอง
4. **ช่องทาง** — ถ้าใช้ OTA ให้ตั้งค่า Channel
5. **พนักงาน / ร้านอาหาร** — ตามฟีเจอร์ที่ใช้

---

## ส่วนที่ 2: แนวทางการพัฒนาฝั่ง Frontend

### 2.1 Base URL และ Version

- **Base URL (dev):** `http://localhost:3000` (หรือตาม `BACKEND_URL` ของโปรเจกต์)
- **Prefix + Version:** `/api/v1`

```ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1';
```

### 2.2 Authentication

- **Login:** `POST /api/v1/auth/login`  
  Body: `{ "email", "password" }`
- **Response หลัง Login:** เก็บ `accessToken`, `refreshToken`, และ **`user`** (มี `id`, `email`, `role`, **`tenantId`**)

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "...",
  "user": {
    "id": "uuid",
    "email": "owner@hotel.com",
    "firstName": "สมชาย",
    "lastName": "ใจดี",
    "role": "tenant_admin",
    "tenantId": "uuid-of-hotel"
  }
}
```

- **ทุก Request ไป PMS:** ส่ง Header  
  `Authorization: Bearer <accessToken>`
- **การใช้งาน `tenantId`:**  
  Backend อ่าน `tenantId` จาก JWT อัตโนมัติ — ฝั่ง Frontend **ไม่ต้องส่ง tenantId ใน body/query** สำหรับ API ปกติ แค่เก็บ `user.tenantId` ไว้ใช้แสดง (เช่น ชื่อโรงแรม) หรือซ่อนเมนูที่เฉพาะ platform admin ได้

### 2.3 บทบาท (Roles) และการแสดง UI

| Role | ความหมาย | ใช้ใน Frontend |
|------|----------|-----------------|
| `platform_admin` | แอดมินระบบ (ไม่ผูกโรงแรม) | แสดงเมนู Admin Panel, จัดการทุกโรงแรม |
| `tenant_admin` | เจ้าของ/แอดมินโรงแรม | แสดงเมนู PMS เต็ม, จัดการ Subscription |
| `manager` | ผู้จัดการโรงแรม | PMS ได้เกือบทุกอย่าง (ยกเว้นบางจุดที่จำกัดให้ admin) |
| `staff` | พนักงาน | จำกัดเมนูตามสิทธิ์ |

- ถ้า `user.tenantId` มีค่า → แสดงเมนู PMS (จอง, ห้อง, แขก, พนักงาน, ร้านอาหาร, รีวิว, Subscription)
- ถ้า `user.role === 'platform_admin'` → แสดงเมนู Admin Panel (Hotels, Invoices, Subscriptions, Plans, ฯลฯ)

### 2.4 API สำหรับผู้เช่า (PMS) — ทุกอันอยู่ภายใต้ `/api/v1`

| Master | Base Path | Methods | Query / หมายเหตุ |
|--------|-----------|---------|-------------------|
| แขก | `GET/POST/PUT/DELETE /guests` | List, Get by id, Create, Update, Delete | `?page=&limit=&search=` |
| ห้องพัก | `GET/POST/PATCH/DELETE /rooms` | เหมือนเดิม | `?page=&limit=&status=&type=&floor=&search=` |
| ห้องว่าง | `GET /rooms/available?checkIn=&checkOut=` | ห้องว่างตามช่วงวันที่ | ใช้ก่อนสร้างการจอง |
| สถานะห้อง | `PATCH /rooms/:id/status` | Body: `{ "status" }` | |
| การจอง | `GET/POST/PUT/DELETE /bookings` | List, Get, Create, Update, Cancel | `?page=&limit=&status=&guestId=&roomId=` |
| พนักงาน | `GET/POST/PATCH/DELETE /hr` | CRUD พนักงาน | `?page=&limit=&department=&position=&search=` |
| ช่องทาง | `GET/POST/PATCH/DELETE /channels` | CRUD ช่องทาง | |
| ช่องทาง | `POST /channels/:id/sync`, `PATCH /channels/:id/toggle-active` | Sync, เปิด/ปิด | |
| ร้านอาหาร | `GET/POST/PATCH/DELETE /restaurant` | CRUD ร้านอาหาร | |
| รีวิว | `GET/POST/PATCH/DELETE /reviews` | CRUD รีวิว | |
| รีวิว | `GET /reviews/stats` | สถิติรีวิว | |
| รีวิว | `GET /reviews/booking/:bookingId` | รีวิวตาม booking | |
| รีวิว | `POST /reviews/qr/generate` | สร้าง QR รีวิว | Body: `{ "bookingId" }` |

**หมายเหตุ:** ข้อมูลที่ List/Get/Create/Update จะถูกกรองหรือผูกกับโรงแรมของ User (จาก `tenantId` ใน JWT) อัตโนมัติ

### 2.5 Primary Key และการอ้างอิง

- ใช้ **`id` (UUID)** เป็น Primary Key สำหรับทุก entity ตอนเรียก PATCH / DELETE / Get by id
- แสดงผลด้วยรหัสหรือชื่อ (เช่น เลขห้อง, ชื่อแขก, invoice number) ได้ตามที่ Frontend ออกแบบ

### 2.6 Error Handling และ Token หมดอายุ

- **401 Unauthorized:** Token หมดอายุหรือไม่ถูกต้อง  
  → เรียก `POST /api/v1/auth/refresh` ด้วย `refreshToken` แล้ว retry  
  → ถ้า refresh ล้มเหลว → ล้าง token แล้ว redirect ไปหน้า Login
- **403 Forbidden:** ไม่มีสิทธิ์ (role ไม่ตรง)  
  → แสดงข้อความหรือซ่อนปุ่ม/เมนูที่ไม่มีสิทธิ์
- **404 Not Found:** ไม่พบ resource หรือไม่ใช่ของโรงแรมนี้ (หลัง multi-tenant)
- **400 Bad Request:** ข้อมูลไม่ถูกต้อง (เช่น วันออกก่อนวันเข้า, ห้องไม่ว่าง)

### 2.7 แนวทางพัฒนา Frontend แนะนำ

1. **State / Context:** เก็บ `user` (รวม `tenantId`, `role`) หลัง login ไว้ใน Context หรือ state management
2. **Axios/Fetch Interceptor:** ใส่ `Authorization: Bearer <accessToken>` ทุก request และจัดการ 401 (refresh token แล้ว retry)
3. **เมนูตาม Role:** แสดงเมนู PMS เมื่อ `user.tenantId` มีค่า; แสดงเมนู Admin เมื่อ `user.role === 'platform_admin'`
4. **ฟอร์มจอง:** เรียก `GET /rooms/available?checkIn=&checkOut=` เพื่อเลือกห้อง แล้ว `POST /bookings` โดยส่ง `guestId`, `roomId`, `checkIn`, `checkOut` (และ `channelId` ถ้ามี)
5. **List + Pagination:** ใช้ `page`, `limit` กับทุก List API และแสดงผลจาก `data` + `total` ตามที่ backend ส่งกลับ

---

## สรุปสั้น ๆ

| หัวข้อ | สรุป |
|--------|------|
| **Master ที่ผู้เช่าต้อง Setup** | ห้องพัก → แขก → (ช่องทาง / พนักงาน / ร้านอาหาร ตามที่ใช้) → การจอง / รีวิว |
| **Auth ฝั่ง Frontend** | Login แล้วเก็บ `accessToken`, `refreshToken`, `user` (มี `tenantId`, `role`) ส่ง Bearer ทุก request |
| **Multi-tenant** | Backend กรองข้อมูลตาม `tenantId` ใน JWT — Frontend ไม่ต้องส่ง tenantId ใน body/query |
| **API Base** | `{BASE_URL}/api/v1` สำหรับทั้ง Auth และ PMS |
