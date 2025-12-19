## 🌐 Frontend API Integration Guide (Backend v1)

เอกสารนี้สรุปการเชื่อมต่อระหว่าง Frontend (`owner-hotel-services`) กับ Backend (`owner-hotel-services-api`) หลังจากเพิ่ม RBAC, Rate Limiting, Logging, และ API Versioning แล้ว

---

## 1. Base URL & Versioning

- **Backend (dev)**: `http://localhost:3001`
- **Global Prefix**: `/api`
- **API Version**: `/v1`

**Frontend ควรกำหนด base URL เป็น:**

```ts
// ตัวอย่างใน frontend
const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
```

ตัวอย่างจริงของ endpoint:

- `POST /api/v1/auth/login`
- `GET  /api/v1/channels`
- `GET  /api/v1/reviews/stats`

---

## 2. Authentication & Tokens

### Endpoints

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout` (ต้องใส่ `Authorization: Bearer <accessToken>`)

### การใช้งานจาก frontend

- หลัง `login` / `register` → เก็บ
  - `accessToken`
  - `refreshToken`
  - ข้อมูล `user` (รวม `role`)
- ทุก request อื่น ๆ:
  - เพิ่ม header: `Authorization: Bearer <accessToken>`
- ถ้า API ตอบ `401` (หมดอายุ / invalid):
  - เรียก `POST /auth/refresh` ด้วย `refreshToken`
  - ถ้า success → อัปเดต tokens แล้ว retry call เดิม
  - ถ้า fail → logout ฝั่ง frontend และ redirect ไปหน้า login

---

## 3. Modules & Endpoints (v1)

### 3.1 Guests

- **Base path:** `/api/v1/guests`
- **Endpoints:**
  - `GET    /guests` — list (รองรับ query: `page`, `limit`, `search`, ฯลฯ)
  - `GET    /guests/:id`
  - `POST   /guests`
  - `PUT    /guests/:id`
  - `DELETE /guests/:id`
- **Roles:**
  - อ่าน / แก้ไข / สร้าง → `admin`, `manager`
  - ลบ → `admin`

### 3.2 Bookings

- **Base path:** `/api/v1/bookings`
- **Endpoints:**
  - `GET    /bookings`
  - `GET    /bookings/:id`
  - `POST   /bookings`
  - `PUT    /bookings/:id`
  - `DELETE /bookings/:id`
- **Roles:** `admin`, `manager`

### 3.3 Rooms

- **Base path:** `/api/v1/rooms`
- **Endpoints:**
  - `GET    /rooms`
  - `GET    /rooms/available?checkIn=...&checkOut=...`
  - `GET    /rooms/:id`
  - `POST   /rooms`
  - `PATCH  /rooms/:id`
  - `PATCH  /rooms/:id/status`
  - `DELETE /rooms/:id`
- **Roles:**
  - อ่าน / available / รายละเอียด → `admin`, `manager`
  - สร้าง / แก้ไข / ลบ → ส่วนใหญ่ `admin`

### 3.4 Restaurant

- **Base path:** `/api/v1/restaurant`
- **Endpoints:**
  - `GET    /restaurant`
  - `GET    /restaurant/:id`
  - `POST   /restaurant`
  - `PATCH  /restaurant/:id`
  - `DELETE /restaurant/:id`
- **Roles:**
  - อ่าน → `admin`, `manager`
  - สร้าง / แก้ไข / ลบ → `admin`

### 3.5 HR (Employees)

- **Base path:** `/api/v1/hr`
- **Endpoints:**
  - `GET    /hr`
  - `GET    /hr/:id`
  - `POST   /hr`
  - `PATCH  /hr/:id`
  - `DELETE /hr/:id`
- **Roles:**
  - อ่าน → `admin`, `manager`
  - สร้าง / แก้ไข / ลบ → `admin`

### 3.6 Channels

- **Base path:** `/api/v1/channels`
- **Endpoints:**
  - `GET    /channels`
  - `GET    /channels/:id`
  - `POST   /channels`
  - `PATCH  /channels/:id`
  - `POST   /channels/:id/sync`
  - `PATCH  /channels/:id/toggle-active`
  - `DELETE /channels/:id`
- **Roles:**
  - อ่าน → `admin`, `manager`
  - สร้าง / แก้ไข / ลบ / toggle-active → `admin`
  - `sync` → `admin`, `manager`

### 3.7 Reviews

- **Base path:** `/api/v1/reviews`
- **Endpoints:**
  - `GET    /reviews`
  - `GET    /reviews/:id`
  - `GET    /reviews/stats`
  - `GET    /reviews/qr/:code`
  - `GET    /reviews/booking/:bookingId`
  - `POST   /reviews`
  - `POST   /reviews/qr/generate` (body: `{ bookingId: string }`)
  - `PATCH  /reviews/:id`
  - `DELETE /reviews/:id`
- **Roles:**
  - อ่าน / stats / qr / create / update → `admin`, `manager`
  - ลบ → `admin`

---

## 4. Rate Limiting (Throttling)

ใช้ `@nestjs/throttler` แบบ global guard + per-endpoint:

- Global (ทุก request):
  - 100 requests ต่อ IP ต่อ 60 วินาที (ตั้งค่าใน `ThrottlerModule.forRoot`)
- Auth endpoints:
  - `POST /auth/register` → `@Throttle({ default: { limit: 5, ttl: 60 } })`
  - `POST /auth/login` → `@Throttle({ default: { limit: 10, ttl: 60 } })`
  - `POST /auth/refresh` → `@Throttle({ default: { limit: 30, ttl: 60 } })`

**ผลกระทบฝั่ง frontend:**

- ถ้าโดนเกิน limit → backend จะตอบ `429 Too Many Requests`
- ควรแสดงข้อความเช่น “ลองใหม่อีกครั้งภายหลัง” แทนการ retry รัว ๆ

---

## 5. RBAC (Role-Based Access Control)

### Role หลัก (จาก `User.role`)

- `platform_admin` — SaaS platform admin (ดูแลทั้งระบบ)
- `tenant_admin` — เจ้าของโรงแรม / ผู้ซื้อ subscription
- `manager` — ผู้จัดการโรงแรม
- `staff` — พนักงาน (แม่บ้าน, เสิร์ฟ, ช่างซ่อม ฯลฯ)
- `user` — ผู้ใช้ทั่วไป
- `admin` — legacy alias (ยังรองรับค่าเดิม)

**ภายใน JWT payload** มี `role` ให้ frontend ใช้:

- ใช้สำหรับ:
  - แสดง/ซ่อนเมนู
  - ปิดบางหน้าจอ (เช่น HR, Channels) ถ้า role ไม่พอ

### แนวทางบน UI

- ถ้า backend ตอบ `403 Forbidden`:
  - แสดงข้อความ “คุณไม่มีสิทธิ์เข้าถึงส่วนนี้”
  - พิจารณาซ่อน action นั้นจาก UI ตาม `user.role`

---

## 6. Logging & Debugging

### LoggingInterceptor

- ทุก request จะถูก log เป็น JSON (stdout) ประกอบด้วย:
  - `method`, `url`, `statusCode`, `durationMs`, `ip`, `userId`, `timestamp`
- ใช้สำหรับดูว่า:
  - frontend เรียก endpoint ไหน
  - latency เท่าไร
  - error เกิดที่ endpoint ใด

### Swagger (API Docs)

- URL: `http://localhost:3001/api/docs`
- ใช้ทดสอบ endpoint แบบ manual ก่อนเชื่อมจาก frontend
  - ใส่ JWT ผ่านปุ่ม “Authorize”
  - เลือก role ที่เหมาะสม (จาก token) เพื่อดูผล RBAC

---

## 7. ขั้นตอนแนะนำสำหรับ Frontend

1. **ตั้งค่า base URL ให้ถูกต้อง**
   - ใช้ `NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1`
2. **ตรวจ api client ให้ตรงกับ backend**
   - ทุก path ต้องขึ้นต้นด้วย `/auth`, `/guests`, `/bookings`, `/rooms`, `/restaurant`, `/hr`, `/channels`, `/reviews`
   - และต่ออยู่หลัง `/api/v1`
3. **ทดสอบ flow หลัก**
   - Login & Refresh → เช็กว่า token ทำงาน
   - Guests / Bookings / Rooms / Channels / Reviews → CRUD ครบ
   - ตรวจ 401/403/429 ว่า UI แสดงผลถูกต้อง
4. **ใช้ Swagger เป็น reference**
   - ทดสอบ payload และ response shape ก่อน mapping type ฝั่ง frontend

---

## 8. สรุปสั้น ๆ สำหรับทีม Frontend

- ใช้ base URL: **`http://localhost:3001/api/v1`**
- ใส่ `Authorization: Bearer <accessToken>` ทุก request (ยกเว้น `/auth/*` ที่เป็น public) 
- รองรับ status code พิเศษ:
  - `401` → พยายาม refresh token แล้ว retry
  - `403` → แสดงหน้า “ไม่มีสิทธิ์”
  - `429` → แสดงข้อความ “กรุณาลองใหม่อีกครั้งภายหลัง”
- อ้างอิงรายละเอียด endpoint และ roles จากหัวข้อ 3 และ 5 ด้านบน เวลาทำหน้าใหม่หรือปรับ store ใน frontend




