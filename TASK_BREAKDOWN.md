# Task Breakdown & Project Board

## 📋 Hotel Management System - Feature Development Tasks

Last Updated: 2026-03-21

---

## 🎯 Priority Levels
- **P0**: Critical - Must have for production
- **P1**: High - Important features
- **P2**: Medium - Nice to have
- **P3**: Low - Future enhancements

## ⏱️ Effort Estimation
- **XS**: < 1 day
- **S**: 1-2 days
- **M**: 3-5 days
- **L**: 1-2 weeks
- **XL**: 2+ weeks

## 📊 Status
- ⚪ **TODO**: Not started
- 🟡 **IN_PROGRESS**: Currently working
- 🟢 **DONE**: Completed
- 🔴 **BLOCKED**: Waiting for dependencies
- ⏸️ **ON_HOLD**: Paused

---

# 1. Email Notification System

## 🔵 Backend Tasks (API)

### 1.1 Email Service Setup
- **ID**: BE-EMAIL-001
- **Priority**: P0
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: ตั้งค่า Email Service Provider และ template engine
- **Acceptance Criteria**:
  - [ ] ติดตั้ง nodemailer หรือ SendGrid
  - [ ] สร้าง Email Service class
  - [ ] สร้าง Email Queue (Bull/BullMQ)
  - [ ] Environment variables สำหรับ SMTP config
  - [ ] Error handling และ retry mechanism
- **Dependencies**: None

### 1.2 Email Templates
- **ID**: BE-EMAIL-002
- **Priority**: P0
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: สร้าง Email Templates สำหรับแต่ละ event
- **Acceptance Criteria**:
  - [ ] Template: Booking Confirmation
  - [ ] Template: Check-in Reminder (1 day before)
  - [ ] Template: Check-out Reminder
  - [ ] Template: Payment Receipt
  - [ ] Template: Password Reset
  - [ ] Template: Welcome Email (New Guest)
  - [ ] Template: Invoice
  - [ ] Support multi-language (TH/EN)
- **Dependencies**: BE-EMAIL-001

### 1.3 Email API Endpoints
- **ID**: BE-EMAIL-003
- **Priority**: P0
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: สร้าง API endpoints สำหรับ email operations
- **Acceptance Criteria**:
  - [ ] POST `/api/v1/notifications/email/send`
  - [ ] POST `/api/v1/notifications/email/send-bulk`
  - [ ] GET `/api/v1/notifications/email/history`
  - [ ] GET `/api/v1/notifications/email/templates`
  - [ ] Response tracking (sent, delivered, opened, bounced)
- **Dependencies**: BE-EMAIL-001, BE-EMAIL-002

### 1.4 Email Event Triggers
- **ID**: BE-EMAIL-004
- **Priority**: P0
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: Implement automatic email triggers
- **Acceptance Criteria**:
  - [ ] Trigger: หลังการจองสำเร็จ → Booking Confirmation
  - [ ] Trigger: 1 วันก่อน check-in → Check-in Reminder
  - [ ] Trigger: หลังชำระเงิน → Payment Receipt
  - [ ] Trigger: Reset password request → Password Reset
  - [ ] Trigger: การจองถูกยกเลิก → Cancellation Email
  - [ ] Cron job สำหรับ scheduled emails
- **Dependencies**: BE-EMAIL-002, BE-EMAIL-003

### 1.5 Email Preferences
- **ID**: BE-EMAIL-005
- **Priority**: P1
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: ระบบจัดการการตั้งค่าการรับอีเมลของแขก
- **Acceptance Criteria**:
  - [ ] Database schema: email_preferences
  - [ ] API: GET/PUT `/api/v1/guests/{id}/email-preferences`
  - [ ] Unsubscribe mechanism
  - [ ] ตรวจสอบ preferences ก่อนส่งอีเมล
- **Dependencies**: BE-EMAIL-003

## 🟢 Frontend Tasks (UI)

### 1.6 Email Settings UI
- **ID**: FE-EMAIL-001
- **Priority**: P1
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Frontend Team
- **Description**: หน้าจัดการการตั้งค่าอีเมลในแดชบอร์ด
- **Acceptance Criteria**:
  - [ ] Settings page: `/dashboard/settings/notifications`
  - [ ] Toggle switches สำหรับแต่ละประเภทอีเมล
  - [ ] Test email button
  - [ ] Email preference form
  - [ ] Integration with API
- **Dependencies**: BE-EMAIL-005

### 1.7 Email History UI
- **ID**: FE-EMAIL-002
- **Priority**: P2
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Frontend Team
- **Description**: หน้าแสดงประวัติการส่งอีเมล
- **Acceptance Criteria**:
  - [ ] Page: `/dashboard/notifications/email-history`
  - [ ] Table แสดงประวัติการส่ง (recipient, template, status, date)
  - [ ] Filter by status (sent, delivered, bounced, failed)
  - [ ] Search by recipient email
  - [ ] Resend email button
- **Dependencies**: BE-EMAIL-003

---

# 2. PromptPay Payment Integration

## 🔵 Backend Tasks (API)

### 2.1 PromptPay Service Setup
- **ID**: BE-PAY-001
- **Priority**: P0
- **Effort**: L (1-2 weeks)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: ติดตั้งและตั้งค่า PromptPay payment gateway
- **Acceptance Criteria**:
  - [ ] Research PromptPay API options (SCB, KBank, etc.)
  - [ ] เลือก Payment Gateway Provider
  - [ ] ติดตั้ง SDK/Library
  - [ ] ตั้งค่า Merchant credentials
  - [ ] สร้าง Payment Service class
  - [ ] Sandbox testing environment
- **Dependencies**: None

### 2.2 PromptPay QR Code Generation
- **ID**: BE-PAY-002
- **Priority**: P0
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: สร้าง QR Code สำหรับชำระเงินผ่าน PromptPay
- **Acceptance Criteria**:
  - [ ] API: POST `/api/v1/payments/promptpay/generate-qr`
  - [ ] รองรับ Static QR (PromptPay ID)
  - [ ] รองรับ Dynamic QR (จำนวนเงินกำหนด)
  - [ ] Return QR Code as base64 image
  - [ ] บันทึก payment reference
- **Dependencies**: BE-PAY-001

### 2.3 Payment Verification
- **ID**: BE-PAY-003
- **Priority**: P0
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: ตรวจสอบสถานะการชำระเงิน
- **Acceptance Criteria**:
  - [ ] Webhook endpoint: POST `/api/v1/payments/promptpay/webhook`
  - [ ] Payment status polling API
  - [ ] อัพเดท booking status หลังชำระเงินสำเร็จ
  - [ ] สร้าง payment receipt
  - [ ] Trigger email notification
  - [ ] Handle payment timeout
- **Dependencies**: BE-PAY-002, BE-EMAIL-004

### 2.4 Payment History & Reconciliation
- **ID**: BE-PAY-004
- **Priority**: P1
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: ระบบบันทึกและตรวจสอบประวัติการชำระเงิน
- **Acceptance Criteria**:
  - [ ] API: GET `/api/v1/payments/promptpay/transactions`
  - [ ] Filter by date range, status
  - [ ] Daily reconciliation report
  - [ ] Export transactions (CSV)
- **Dependencies**: BE-PAY-003

### 2.5 Refund System
- **ID**: BE-PAY-005
- **Priority**: P1
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: ระบบคืนเงินผ่าน PromptPay
- **Acceptance Criteria**:
  - [ ] API: POST `/api/v1/payments/promptpay/refund`
  - [ ] Full refund support
  - [ ] Partial refund support
  - [ ] Refund approval workflow
  - [ ] อัพเดท booking status
  - [ ] Trigger refund confirmation email
- **Dependencies**: BE-PAY-003, BE-EMAIL-004

## 🟢 Frontend Tasks (UI)

### 2.6 PromptPay Payment UI
- **ID**: FE-PAY-001
- **Priority**: P0
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Frontend Team
- **Description**: หน้าชำระเงินผ่าน PromptPay
- **Acceptance Criteria**:
  - [ ] Payment page: `/bookings/[id]/payment`
  - [ ] แสดง QR Code สำหรับ PromptPay
  - [ ] Timer countdown (payment timeout)
  - [ ] Real-time payment status update
  - [ ] Success/Failure message
  - [ ] Download receipt button
  - [ ] Mobile responsive
- **Dependencies**: BE-PAY-002, BE-PAY-003

### 2.7 Payment Method Selection
- **ID**: FE-PAY-002
- **Priority**: P0
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Frontend Team
- **Description**: เพิ่ม PromptPay ในตัวเลือก payment method
- **Acceptance Criteria**:
  - [ ] อัพเดท payment method selector
  - [ ] ไอคอน PromptPay
  - [ ] แสดงคำแนะนำการใช้งาน
  - [ ] Integration กับ existing payment flow
- **Dependencies**: FE-PAY-001

### 2.8 Payment Dashboard
- **ID**: FE-PAY-003
- **Priority**: P1
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Frontend Team
- **Description**: หน้า dashboard สำหรับติดตามการชำระเงิน
- **Acceptance Criteria**:
  - [ ] Page: `/dashboard/payments/promptpay`
  - [ ] แสดงรายการ transactions
  - [ ] Filter by status, date
  - [ ] Summary statistics (total, success rate)
  - [ ] Export to CSV
  - [ ] Refund action button
- **Dependencies**: BE-PAY-004

---

# 3. Advanced Reporting & Analytics

## 🔵 Backend Tasks (API)

### 3.1 Report Engine Setup
- **ID**: BE-REPORT-001
- **Priority**: P1
- **Effort**: L (1-2 weeks)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: สร้าง Report Generation Engine
- **Acceptance Criteria**:
  - [ ] สร้าง Report Service
  - [ ] Query builder สำหรับ dynamic reports
  - [ ] รองรับ date range filters
  - [ ] Aggregation และ grouping
  - [ ] Caching mechanism
  - [ ] Background job processing (long reports)
- **Dependencies**: None

### 3.2 Revenue Reports API
- **ID**: BE-REPORT-002
- **Priority**: P1
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: API สำหรับรายงานรายได้
- **Acceptance Criteria**:
  - [ ] GET `/api/v1/reports/revenue/daily`
  - [ ] GET `/api/v1/reports/revenue/monthly`
  - [ ] GET `/api/v1/reports/revenue/yearly`
  - [ ] GET `/api/v1/reports/revenue/by-room-type`
  - [ ] GET `/api/v1/reports/revenue/by-channel`
  - [ ] รองรับ compare periods
- **Dependencies**: BE-REPORT-001

### 3.3 Occupancy Reports API
- **ID**: BE-REPORT-003
- **Priority**: P1
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: API สำหรับรายงาน occupancy rate
- **Acceptance Criteria**:
  - [ ] GET `/api/v1/reports/occupancy/rate`
  - [ ] GET `/api/v1/reports/occupancy/forecast`
  - [ ] GET `/api/v1/reports/occupancy/by-room-type`
  - [ ] ADR (Average Daily Rate) calculation
  - [ ] RevPAR calculation
- **Dependencies**: BE-REPORT-001

### 3.4 Export Service
- **ID**: BE-REPORT-004
- **Priority**: P0
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: ระบบ export รายงานเป็น Excel/CSV/PDF
- **Acceptance Criteria**:
  - [ ] Excel export (xlsx) - ใช้ exceljs
  - [ ] CSV export
  - [ ] PDF export (รูปแบบ landscape/portrait)
  - [ ] POST `/api/v1/reports/export`
  - [ ] รองรับ custom templates
  - [ ] ส่งผ่าน email (optional)
- **Dependencies**: BE-REPORT-001

### 3.5 Custom Report Builder API
- **ID**: BE-REPORT-005
- **Priority**: P2
- **Effort**: XL (2+ weeks)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: API สำหรับสร้างรายงานแบบกำหนดเอง
- **Acceptance Criteria**:
  - [ ] POST `/api/v1/reports/custom/create` - บันทึกการตั้งค่ารายงาน
  - [ ] GET `/api/v1/reports/custom/list` - รายการรายงานที่บันทึกไว้
  - [ ] POST `/api/v1/reports/custom/{id}/run` - รันรายงาน
  - [ ] รองรับ SQL-like query builder
  - [ ] Data source selection (bookings, revenue, guests, etc.)
  - [ ] Column selection และ aggregations
- **Dependencies**: BE-REPORT-001

## 🟢 Frontend Tasks (UI)

### 3.6 Revenue Dashboard
- **ID**: FE-REPORT-001
- **Priority**: P1
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Frontend Team
- **Description**: หน้า dashboard รายได้แบบละเอียด
- **Acceptance Criteria**:
  - [ ] Page: `/dashboard/reports/revenue`
  - [ ] Line chart: รายได้รายวัน/เดือน
  - [ ] Bar chart: รายได้แยกตามประเภทห้อง
  - [ ] Pie chart: สัดส่วนรายได้จากช่องทาง
  - [ ] Date range picker
  - [ ] Compare with previous period
  - [ ] Export button (Excel, PDF)
- **Dependencies**: BE-REPORT-002, BE-REPORT-004

### 3.7 Occupancy Dashboard
- **ID**: FE-REPORT-002
- **Priority**: P1
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Frontend Team
- **Description**: หน้า dashboard Occupancy Rate
- **Acceptance Criteria**:
  - [ ] Page: `/dashboard/reports/occupancy`
  - [ ] Gauge chart: Occupancy rate
  - [ ] Trend chart: 30/60/90 days
  - [ ] Heatmap: Occupancy by day of week
  - [ ] ADR และ RevPAR metrics
  - [ ] Export functionality
- **Dependencies**: BE-REPORT-003, BE-REPORT-004

### 3.8 Custom Report Builder UI
- **ID**: FE-REPORT-003
- **Priority**: P2
- **Effort**: XL (2+ weeks)
- **Status**: ⚪ TODO
- **Owner**: Frontend Team
- **Description**: หน้าสร้างรายงานแบบกำหนดเอง (Drag & Drop)
- **Acceptance Criteria**:
  - [ ] Page: `/dashboard/reports/custom-builder`
  - [ ] Drag & drop interface
  - [ ] Data source selector
  - [ ] Column/field picker
  - [ ] Filter builder (date, status, etc.)
  - [ ] Aggregation options (sum, avg, count)
  - [ ] Chart type selection
  - [ ] Preview report
  - [ ] Save/Load report templates
  - [ ] Schedule reports (future)
- **Dependencies**: BE-REPORT-005

### 3.9 Export UI Components
- **ID**: FE-REPORT-004
- **Priority**: P0
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Frontend Team
- **Description**: สร้าง reusable export components
- **Acceptance Criteria**:
  - [ ] ExportButton component
  - [ ] Export modal (format selection: Excel/CSV/PDF)
  - [ ] Export progress indicator
  - [ ] Download handling
  - [ ] Error messages
  - [ ] ใช้ได้ทั้ง reports, bookings, guests, etc.
- **Dependencies**: BE-REPORT-004

---

# 4. Two-Factor Authentication (2FA)

## 🔵 Backend Tasks (API)

### 4.1 2FA Service Setup
- **ID**: BE-2FA-001
- **Priority**: P1
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: ติดตั้งระบบ 2FA
- **Acceptance Criteria**:
  - [ ] ติดตั้ง speakeasy (TOTP library)
  - [ ] สร้าง 2FA Service
  - [ ] Database schema: user_2fa_settings
  - [ ] QR Code generation (Google Authenticator)
  - [ ] Backup codes generation
- **Dependencies**: None

### 4.2 2FA API Endpoints
- **ID**: BE-2FA-002
- **Priority**: P1
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: API endpoints สำหรับ 2FA
- **Acceptance Criteria**:
  - [ ] POST `/api/v1/auth/2fa/enable` - เปิดใช้งาน 2FA
  - [ ] POST `/api/v1/auth/2fa/verify` - ตรวจสอบ OTP code
  - [ ] POST `/api/v1/auth/2fa/disable` - ปิดใช้งาน 2FA
  - [ ] GET `/api/v1/auth/2fa/backup-codes` - สร้าง backup codes
  - [ ] POST `/api/v1/auth/2fa/verify-backup` - ใช้ backup code
- **Dependencies**: BE-2FA-001

### 4.3 Login Flow Update
- **ID**: BE-2FA-003
- **Priority**: P1
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: อัพเดท login flow รองรับ 2FA
- **Acceptance Criteria**:
  - [ ] แก้ไข POST `/api/v1/auth/login`
  - [ ] ถ้าเปิด 2FA → return requires_2fa: true
  - [ ] สร้าง temporary session token
  - [ ] Verify 2FA code before issuing full access token
  - [ ] Handle 2FA failed attempts (lock after 3 tries)
- **Dependencies**: BE-2FA-002

## 🟢 Frontend Tasks (UI)

### 4.4 2FA Setup UI
- **ID**: FE-2FA-001
- **Priority**: P1
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Frontend Team
- **Description**: หน้าตั้งค่า 2FA
- **Acceptance Criteria**:
  - [ ] Page: `/dashboard/settings/security/2fa`
  - [ ] แสดง QR Code สำหรับสแกน
  - [ ] คำแนะนำการตั้งค่า (step-by-step)
  - [ ] Input field สำหรับ verify OTP
  - [ ] แสดง backup codes (download/print)
  - [ ] Toggle เปิด/ปิด 2FA
- **Dependencies**: BE-2FA-002

### 4.5 2FA Login UI
- **ID**: FE-2FA-002
- **Priority**: P1
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Frontend Team
- **Description**: อัพเดทหน้า login รองรับ 2FA
- **Acceptance Criteria**:
  - [ ] อัพเดท `/login` page
  - [ ] หลัง login สำเร็จ → ถ้ามี 2FA ให้แสดงหน้า verify OTP
  - [ ] 6-digit OTP input
  - [ ] "Use backup code" option
  - [ ] Countdown timer (30 วินาที auto-refresh)
  - [ ] Error handling (invalid code, expired)
- **Dependencies**: BE-2FA-003, FE-2FA-001

---

# 5. Audit Logging System

## 🔵 Backend Tasks (API)

### 5.1 Audit Log Service
- **ID**: BE-AUDIT-001
- **Priority**: P1
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: สร้างระบบบันทึก audit logs
- **Acceptance Criteria**:
  - [ ] Database schema: audit_logs table
  - [ ] สร้าง AuditLog Service
  - [ ] Middleware สำหรับจับ API calls
  - [ ] บันทึก: user, action, resource, changes, IP, timestamp
  - [ ] รองรับ before/after values (JSON diff)
  - [ ] Log retention policy (6 months)
- **Dependencies**: None

### 5.2 Audit Log Events
- **ID**: BE-AUDIT-002
- **Priority**: P1
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: กำหนด events ที่ต้องบันทึก
- **Acceptance Criteria**:
  - [ ] User login/logout
  - [ ] Booking create/update/cancel
  - [ ] Payment transactions
  - [ ] Room status changes
  - [ ] Guest data access/modification
  - [ ] Settings changes
  - [ ] Employee data changes (HR)
  - [ ] Permission/role changes
- **Dependencies**: BE-AUDIT-001

### 5.3 Audit Log API
- **ID**: BE-AUDIT-003
- **Priority**: P1
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: API สำหรับดึงข้อมูล audit logs
- **Acceptance Criteria**:
  - [ ] GET `/api/v1/audit-logs`
  - [ ] Filter by: user, action, resource, date range
  - [ ] Search functionality
  - [ ] Pagination
  - [ ] Export to CSV
  - [ ] Role-based access (Admin only)
- **Dependencies**: BE-AUDIT-002

## 🟢 Frontend Tasks (UI)

### 5.4 Audit Log Viewer UI
- **ID**: FE-AUDIT-001
- **Priority**: P1
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Frontend Team
- **Description**: หน้าแสดง audit logs
- **Acceptance Criteria**:
  - [ ] Page: `/dashboard/admin/audit-logs`
  - [ ] Table view: timestamp, user, action, resource
  - [ ] Filter panel (user, action type, date range)
  - [ ] Search bar
  - [ ] View details modal (before/after values)
  - [ ] Export to CSV button
  - [ ] Auto-refresh option
- **Dependencies**: BE-AUDIT-003

---

# 6. Line Notify Integration

## 🔵 Backend Tasks (API)

### 6.1 Line Notify Service
- **ID**: BE-LINE-001
- **Priority**: P2
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: ติดตั้ง Line Notify integration
- **Acceptance Criteria**:
  - [ ] ติดตั้ง line-notify SDK
  - [ ] สร้าง Line Notify Service
  - [ ] OAuth flow สำหรับ connect Line account
  - [ ] Database schema: line_notify_tokens
  - [ ] Send message function
- **Dependencies**: None

### 6.2 Line Notify Events
- **ID**: BE-LINE-002
- **Priority**: P2
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: กำหนด events สำหรับ Line notification
- **Acceptance Criteria**:
  - [ ] การจองใหม่
  - [ ] การชำระเงิน
  - [ ] Check-in/Check-out
  - [ ] คำขอ maintenance ด่วน
  - [ ] รีวิวใหม่ (rating < 3 stars)
  - [ ] ยอดขายรายวัน (summary)
- **Dependencies**: BE-LINE-001

### 6.3 Line Notify API
- **ID**: BE-LINE-003
- **Priority**: P2
- **Effort**: XS (< 1 day)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: API endpoints สำหรับ Line Notify
- **Acceptance Criteria**:
  - [ ] GET `/api/v1/notifications/line/connect` - OAuth URL
  - [ ] POST `/api/v1/notifications/line/callback` - OAuth callback
  - [ ] DELETE `/api/v1/notifications/line/disconnect`
  - [ ] POST `/api/v1/notifications/line/test` - ส่งข้อความทดสอบ
- **Dependencies**: BE-LINE-001

## 🟢 Frontend Tasks (UI)

### 6.4 Line Notify Settings UI
- **ID**: FE-LINE-001
- **Priority**: P2
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Frontend Team
- **Description**: หน้าตั้งค่า Line Notify
- **Acceptance Criteria**:
  - [ ] Settings section: `/dashboard/settings/notifications/line`
  - [ ] "Connect to Line" button
  - [ ] แสดงสถานะการเชื่อมต่อ
  - [ ] Toggle switches สำหรับแต่ละ event
  - [ ] "Send test message" button
  - [ ] Disconnect button
- **Dependencies**: BE-LINE-003

---

# 7. Multi-language Support (i18n)

## 🔵 Backend Tasks (API)

### 7.1 i18n API Endpoints
- **ID**: BE-I18N-001
- **Priority**: P2
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: API สำหรับ translations
- **Acceptance Criteria**:
  - [ ] GET `/api/v1/i18n/languages` - รายการภาษาที่รองรับ
  - [ ] GET `/api/v1/i18n/translations/{lang}` - ดึง translation file
  - [ ] Email templates รองรับหลายภาษา
  - [ ] Error messages รองรับหลายภาษา
- **Dependencies**: None

## 🟢 Frontend Tasks (UI)

### 7.2 i18n Translation Files
- **ID**: FE-I18N-001
- **Priority**: P2
- **Effort**: L (1-2 weeks)
- **Status**: ⚪ TODO
- **Owner**: Frontend Team
- **Description**: สร้าง translation files
- **Acceptance Criteria**:
  - [ ] `/lib/i18n/locales/th.json` - ภาษาไทย (complete)
  - [ ] `/lib/i18n/locales/en.json` - ภาษาอังกฤษ (complete)
  - [ ] แปลทุก UI strings
  - [ ] แปล error messages
  - [ ] แปล validation messages
  - [ ] แปล email templates
- **Dependencies**: None

### 7.3 Language Switcher UI
- **ID**: FE-I18N-002
- **Priority**: P2
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Frontend Team
- **Description**: UI สำหรับสลับภาษา
- **Acceptance Criteria**:
  - [ ] Language switcher component (header)
  - [ ] บันทึกการเลือกภาษาใน localStorage
  - [ ] อัพเดท page เมื่อสลับภาษา
  - [ ] Flag icons
  - [ ] รองรับ RTL (future: Arabic)
- **Dependencies**: FE-I18N-001

### 7.4 Date/Number/Currency Formatting
- **ID**: FE-I18N-003
- **Priority**: P2
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Frontend Team
- **Description**: Format ตามภาษาที่เลือก
- **Acceptance Criteria**:
  - [ ] Date formatting (TH: วว/ดด/ปปปป, EN: MM/DD/YYYY)
  - [ ] Number formatting (TH: 1,234.56, EN: 1,234.56)
  - [ ] Currency (THB: ฿1,234.56, USD: $1,234.56)
  - [ ] Relative time (TH: 5 นาทีที่แล้ว, EN: 5 minutes ago)
- **Dependencies**: FE-I18N-001

---

# 8. Performance Optimization

## 🔵 Backend Tasks (API)

### 8.1 Redis Caching Setup
- **ID**: BE-PERF-001
- **Priority**: P1
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: ติดตั้ง Redis สำหรับ caching
- **Acceptance Criteria**:
  - [ ] ติดตั้ง Redis
  - [ ] สร้าง Cache Service (wrapper)
  - [ ] Environment variables
  - [ ] Cache key naming convention
  - [ ] TTL strategy
  - [ ] Cache invalidation logic
- **Dependencies**: None

### 8.2 API Response Caching
- **ID**: BE-PERF-002
- **Priority**: P1
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: Cache API responses
- **Acceptance Criteria**:
  - [ ] Cache: `/api/v1/rooms/available` (5 minutes)
  - [ ] Cache: `/api/v1/restaurant/menu` (1 hour)
  - [ ] Cache: `/api/v1/reports/*` (15 minutes)
  - [ ] Cache: `/api/v1/guests/*` (10 minutes)
  - [ ] Cache invalidation on updates
  - [ ] Cache warming strategy
- **Dependencies**: BE-PERF-001

### 8.3 Database Query Optimization
- **ID**: BE-PERF-003
- **Priority**: P1
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: Optimize slow queries
- **Acceptance Criteria**:
  - [ ] Analyze slow queries (pg_stat_statements)
  - [ ] สร้าง database indexes ที่จำเป็น
  - [ ] Optimize N+1 queries (eager loading)
  - [ ] Database connection pooling
  - [ ] Query result pagination
- **Dependencies**: None

### 8.4 API Rate Limiting
- **ID**: BE-PERF-004
- **Priority**: P1
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: ป้องกัน API abuse
- **Acceptance Criteria**:
  - [ ] ติดตั้ง rate limiter middleware
  - [ ] กำหนด rate limits แยกตาม endpoint
  - [ ] Response headers: X-RateLimit-*
  - [ ] Return 429 Too Many Requests
  - [ ] Whitelist IPs (optional)
- **Dependencies**: BE-PERF-001

## 🟢 Frontend Tasks (UI)

### 8.5 Image Optimization
- **ID**: FE-PERF-001
- **Priority**: P1
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Frontend Team
- **Description**: Optimize รูปภาพ
- **Acceptance Criteria**:
  - [ ] ใช้ Next.js Image component
  - [ ] Lazy loading images
  - [ ] WebP format
  - [ ] Responsive images (srcset)
  - [ ] CDN integration (Cloudflare/Cloudinary)
- **Dependencies**: None

### 8.6 Code Splitting & Lazy Loading
- **ID**: FE-PERF-002
- **Priority**: P1
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Frontend Team
- **Description**: ลด bundle size
- **Acceptance Criteria**:
  - [ ] Route-based code splitting (Next.js automatic)
  - [ ] Component lazy loading (React.lazy)
  - [ ] Lazy load charts library
  - [ ] Lazy load PDF viewer
  - [ ] Tree shaking unused code
  - [ ] Analyze bundle size (bundle-analyzer)
- **Dependencies**: None

### 8.7 Client-side Caching
- **ID**: FE-PERF-003
- **Priority**: P2
- **Effort**: S (1-2 days)
- **Status**: ⚪ TODO
- **Owner**: Frontend Team
- **Description**: Cache data on client
- **Acceptance Criteria**:
  - [ ] ใช้ SWR หรือ React Query
  - [ ] Cache API responses
  - [ ] Stale-while-revalidate strategy
  - [ ] Optimistic updates
  - [ ] Cache invalidation
- **Dependencies**: None

---

# 9. Mobile App (Future)

## 🔵 Backend Tasks (API)

### 9.1 Mobile API Endpoints
- **ID**: BE-MOBILE-001
- **Priority**: P3
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: API เฉพาะสำหรับ mobile app
- **Acceptance Criteria**:
  - [ ] API version: `/api/v2/mobile/*`
  - [ ] Optimized responses (smaller payload)
  - [ ] Push notification support (FCM)
  - [ ] Mobile-specific authentication
  - [ ] Offline sync support
- **Dependencies**: None

### 9.2 Push Notification Service
- **ID**: BE-MOBILE-002
- **Priority**: P3
- **Effort**: M (3-5 days)
- **Status**: ⚪ TODO
- **Owner**: Backend Team
- **Description**: ระบบ push notifications
- **Acceptance Criteria**:
  - [ ] Firebase Cloud Messaging (FCM) setup
  - [ ] Device token registration
  - [ ] POST `/api/v1/notifications/push/send`
  - [ ] Notification templates
  - [ ] Scheduled notifications
- **Dependencies**: None

## 🟢 Frontend Tasks (Mobile)

### 9.3 Mobile App Development
- **ID**: FE-MOBILE-001
- **Priority**: P3
- **Effort**: XL (2+ weeks)
- **Status**: ⚪ TODO
- **Owner**: Mobile Team
- **Description**: สร้าง mobile app (React Native / Flutter)
- **Acceptance Criteria**:
  - [ ] เลือก framework (React Native / Flutter)
  - [ ] Setup project structure
  - [ ] Authentication screens
  - [ ] Dashboard
  - [ ] Booking management
  - [ ] QR Code scanner
  - [ ] Push notifications
  - [ ] Offline mode
  - [ ] iOS & Android builds
- **Dependencies**: BE-MOBILE-001, BE-MOBILE-002

---

# Summary Table

## Priority Breakdown

| Priority | Backend Tasks | Frontend Tasks | Total |
|----------|--------------|----------------|-------|
| **P0 (Critical)** | 9 | 6 | 15 |
| **P1 (High)** | 18 | 11 | 29 |
| **P2 (Medium)** | 7 | 5 | 12 |
| **P3 (Low)** | 2 | 1 | 3 |
| **TOTAL** | **36** | **23** | **59** |

## Effort Breakdown

| Effort | Backend Tasks | Frontend Tasks | Total |
|--------|--------------|----------------|-------|
| **XS (< 1 day)** | 1 | 0 | 1 |
| **S (1-2 days)** | 12 | 11 | 23 |
| **M (3-5 days)** | 17 | 7 | 24 |
| **L (1-2 weeks)** | 4 | 2 | 6 |
| **XL (2+ weeks)** | 2 | 3 | 5 |

## Team Allocation Suggestion

### Backend Team (3 developers)
- **Total Story Points**: ~140 days
- **Timeline**: ~3-4 months (with 3 developers)
- **Focus Areas**:
  - Developer 1: Email & Notifications (BE-EMAIL-*, BE-LINE-*)
  - Developer 2: Payments & 2FA (BE-PAY-*, BE-2FA-*)
  - Developer 3: Reports & Performance (BE-REPORT-*, BE-PERF-*)

### Frontend Team (2 developers)
- **Total Story Points**: ~75 days
- **Timeline**: ~2-3 months (with 2 developers)
- **Focus Areas**:
  - Developer 1: Payments & Reports UI (FE-PAY-*, FE-REPORT-*)
  - Developer 2: Settings & Security UI (FE-EMAIL-*, FE-2FA-*, FE-AUDIT-*)

---

## Recommended Development Phases

### Phase 1: Critical Features (P0) - 6-8 weeks
1. Email Notification System
2. PromptPay Payment Integration
3. Export Reports (Excel/PDF)

### Phase 2: Important Features (P1) - 8-10 weeks
4. Two-Factor Authentication
5. Audit Logging
6. Advanced Reporting & Analytics
7. Performance Optimization

### Phase 3: Nice to Have (P2) - 4-6 weeks
8. Line Notify Integration
9. Multi-language Support
10. Advanced Performance Tuning

### Phase 4: Future Enhancements (P3) - TBD
11. Mobile App Development

---

## Daily Standup Template

```markdown
### Team Member: [Name]
**Date**: YYYY-MM-DD

**Yesterday**:
- [Task ID] - [Status] - [Brief description]

**Today**:
- [Task ID] - [Status] - [Brief description]

**Blockers**:
- [If any]

**Notes**:
- [Optional]
```

---

## Weekly Sprint Planning Template

```markdown
### Sprint #[Number] - Week of [Date]

**Sprint Goal**: [Main objective]

**Committed Tasks**:
- [ ] [Task ID] - [Task Name] - [Assignee] - [Effort]
- [ ] [Task ID] - [Task Name] - [Assignee] - [Effort]

**Stretch Goals**:
- [ ] [Task ID] - [Task Name] - [Assignee] - [Effort]

**Dependencies**:
- [List any blockers or dependencies]

**Notes**:
- [Sprint-specific notes]
```

---

## Testing Checklist per Feature

- [ ] Unit tests written (minimum 80% coverage)
- [ ] Integration tests for API endpoints
- [ ] E2E tests for critical user flows
- [ ] Manual testing completed
- [ ] Performance testing (if applicable)
- [ ] Security review (for auth/payment features)
- [ ] Documentation updated
- [ ] Code review completed
- [ ] Deployed to staging
- [ ] QA approval
- [ ] Ready for production

---

_Last updated: 2026-03-21_
_Document owner: Project Manager_
_Review cycle: Weekly_
