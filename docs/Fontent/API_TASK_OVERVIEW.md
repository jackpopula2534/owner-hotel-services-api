# StaySync - API Task Overview (Frontend Support)

เอกสารสรุปงานฝั่ง API ที่พัฒนาเรียบร้อยแล้วเพื่อรองรับฟีเจอร์ใหม่ด้าน UX/UI ตามเอกสาร `PROJECT_TRACKER.md`

## 1. ระบบแจ้งเตือน (Notifications & Alerts) ✅
เพื่อให้รองรับ In-app Notification Panel ที่พัฒนาเสร็จแล้ว:
- [x] **GET `/v1/notifications`**: ดึงรายการการแจ้งเตือนของผู้ใช้ (รองรับ Pagination)
- [x] **PATCH `/v1/notifications/{id}/read`**: บันทึกสถานะการอ่าน
- [x] **PATCH `/v1/notifications/read-all`**: บันทึกการอ่านทั้งหมด
- [x] **DELETE `/v1/notifications/{id}`**: ลบการแจ้งเตือน
- [x] **WebSocket Support**: ระบบ Real-time (`WS /api/notifications/live`) สำหรับส่งแจ้งเตือน

## 2. ระบบนัดหมาย (Demo Booking & Contact) ✅
เพื่อให้รองรับหน้า Contact และ Demo Booking:
- [x] **POST `/v1/contact/demo`**: บันทึกการนัดหมาย Demo (ชื่อ, อีเมล, วันเวลาที่เลือก, รูปแบบการ Demo)
- [x] **POST `/v1/contact/message`**: บันทึกข้อความจาก Contact Form
- [x] **Integration**: ระบบ Service รองรับการส่งอีเมล/บันทึกนัดหมายแล้ว

## 3. ระบบติดตามความก้าวหน้า (Onboarding Progress) ✅
เพื่อให้รองรับ Onboarding Checklist ใน Dashboard:
- [x] **GET `/v1/onboarding/progress`**: ดึงสถานะปัจจุบันของ Checklist
- [x] **PATCH `/v1/onboarding/step/{id}`**: บันทึกเมื่อผู้ใช้ทำแต่ละ Step สำเร็จ
- [x] **Logic Auto-detect**: เพิ่มความสามารถในการตรวจจับสถานะอัตโนมัติจาก Database

## 4. ระบบวิเคราะห์และรายงาน (Analytics & A/B Testing) ✅
เพื่อให้รองรับ Analytics Dashboard (Phase 4):
- [x] **POST `/v1/analytics/event`**: บันทึก Event การใช้งาน (Click, Page View, Feature usage)
- [x] **GET `/v1/analytics/summary`**: สรุปข้อมูลการใช้งานสำหรับแสดงผลบน Dashboard
- [x] **Feature Flags API**: ดึงสถานะ Feature Flags (`GET /v1/feature-flags`) สำหรับจัดการ A/B Testing

## 5. ระบบความภักดีและต่ออายุ (Loyalty & Renewal) ✅
เพื่อให้รองรับ Phase 5:
- [x] **GET `/v1/subscription/renewal-status`**: ดึงข้อมูลวันหมดอายุและสถานะการต่ออายุ
- [x] **POST `/v1/referral/invite`**: ส่งคำชวนและบันทึกข้อมูลคะแนนสะสม
- [x] **GET `/v1/loyalty/points`**: ดึงคะแนนสะสมและสถานะ VIP Tier

## 6. ข้อมูลโปรโมชัน (Dynamic Promotions) ✅
เพื่อให้รองรับ Promo Banners:
- [x] **GET `/v1/promotions/active`**: ดึงโปรโมชันที่เหมาะกับ Segment ของผู้ใช้
- [x] **POST `/v1/promotions/apply-coupon`**: ตรวจสอบและใช้งานคูปองส่วนลด

## 7. ระบบจัดการผู้ใช้ (User Management) - เพิ่มเติม ✅
- [x] **User CRUD**: เพื่อรองรับการจัดการสิทธิ์พนักงาน (ไม่ใช่แค่ HR Staff)
- [x] **Password Reset**: ระบบลืมรหัสผ่าน (Forgot/Reset Password) พร้อมลิงก์รีเซ็ต

---
**หมายเหตุ:** ขณะนี้ระบบ Backend (NestJS) ได้ Implement Endpoints ครบทั้งหมดแล้ว ทีม Frontend สามารถเปลี่ยนจาก Mock Data มาเรียกใช้งาน API จริงผ่าน `/api/v1/...` ได้ทันที
