# API Endpoints Documentation for Frontend

> **Base URL**: `https://api.hotelservices.com/api/v1`
> **Last Updated**: 2024-01-20
> **API Version**: v1

## Table of Contents

1. [Authentication](#1-authentication)
2. [Two-Factor Authentication](#2-two-factor-authentication)
3. [Email Notifications](#3-email-notifications)
4. [PromptPay Payments](#4-promptpay-payments)
5. [Reports Export](#5-reports-export)
6. [Audit Logs](#6-audit-logs)
7. [Line Notify](#7-line-notify)
8. [i18n Translation](#8-i18n-translation)
9. [Database Performance (Admin)](#9-database-performance-admin)
10. [Mobile API](#10-mobile-api)
11. [Push Notifications](#11-push-notifications)

---

## Authentication Headers

All authenticated endpoints require:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

---

## Response Format

All API responses follow this structure:

```typescript
interface ApiResponse<T> {
  success: boolean;
  statusCode: number;
  timestamp: string;
  data: T;
  metadata?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}
```

---

## 1. Authentication

### Base Path: `/api/v1/auth`

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/register` | Register new user | ❌ |
| POST | `/login` | Login hotel user | ❌ |
| POST | `/admin/login` | Login platform admin | ❌ |
| POST | `/refresh` | Refresh access token | ❌ |
| POST | `/logout` | Logout user | ✅ |
| POST | `/forgot-password` | Request password reset | ❌ |
| POST | `/reset-password` | Reset password with token | ❌ |

### Example: Login

```typescript
// Request
POST /api/v1/auth/login
{
  "email": "user@hotel.com",
  "password": "password123"
}

// Response
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "user-123",
      "email": "user@hotel.com",
      "firstName": "สมชาย",
      "lastName": "ใจดี",
      "role": "tenant_admin",
      "tenantId": "tenant-123"
    }
  }
}
```

---

## 2. Two-Factor Authentication

### Base Path: `/api/v1/auth/2fa`

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/enable` | Generate 2FA secret & QR | ✅ |
| POST | `/verify` | Verify TOTP & enable 2FA | ✅ |
| POST | `/disable` | Disable 2FA | ✅ |
| GET | `/status` | Get 2FA status | ✅ |
| GET | `/backup-codes` | Regenerate backup codes | ✅ |
| POST | `/verify-backup` | Verify backup code for login | ❌ |
| POST | `/validate` | Validate 2FA during login | ❌ |

### TypeScript Types

```typescript
interface TwoFactorEnableResponse {
  secret: string;
  qrCode: string; // base64 encoded image
  otpauthUrl: string;
}

interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: string | null;
  backupCodesRemaining: number;
}

interface Verify2FADto {
  code: string; // 6-digit TOTP code
}

interface Disable2FADto {
  password: string;
  code: string;
}

interface Login2FADto {
  code: string;
  tempToken: string;
}
```

---

## 3. Email Notifications

### Base Path: `/api/v1/notifications/email`

| Method | Endpoint | Description | Auth Required | Roles |
|--------|----------|-------------|---------------|-------|
| POST | `/send` | Send single email | ✅ | platform_admin, tenant_admin, manager |
| POST | `/send-bulk` | Send bulk emails | ✅ | platform_admin, tenant_admin, manager |
| GET | `/history` | Get email history | ✅ | platform_admin, tenant_admin, manager |
| GET | `/templates` | Get available templates | ✅ | platform_admin, tenant_admin, manager |
| POST | `/resend` | Resend failed email | ✅ | platform_admin, tenant_admin, manager |
| POST | `/test` | Send test email | ✅ | platform_admin, tenant_admin |

### TypeScript Types

```typescript
type EmailTemplate =
  | 'welcome'
  | 'booking_confirmation'
  | 'booking_cancellation'
  | 'payment_received'
  | 'password_reset'
  | 'promotion';

interface SendEmailDto {
  to: string;
  subject: string;
  template: EmailTemplate;
  context: Record<string, any>;
  tenantId?: string;
}

interface SendBulkEmailDto {
  recipients: Array<{
    to: string;
    context: Record<string, any>;
  }>;
  subject: string;
  template: EmailTemplate;
  tenantId?: string;
}

interface EmailHistoryQueryDto {
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
  status?: 'sent' | 'failed' | 'pending';
}
```

---

## 4. PromptPay Payments

### Base Path: `/api/v1/payments/promptpay`

| Method | Endpoint | Description | Auth Required | Roles |
|--------|----------|-------------|---------------|-------|
| POST | `/generate-qr` | Generate PromptPay QR | ✅ | platform_admin, tenant_admin, manager, receptionist |
| GET | `/status/:transactionRef` | Check payment status | ✅ | Any authenticated |
| POST | `/webhook` | Webhook for payment notifications | ❌ | - |
| POST | `/verify` | Manually verify payment | ✅ | platform_admin, tenant_admin, manager |
| GET | `/transactions` | Get transaction history | ✅ | platform_admin, tenant_admin, manager, accountant |
| GET | `/reconciliation/:date` | Get daily reconciliation | ✅ | platform_admin, tenant_admin, accountant |
| POST | `/refund` | Process refund | ✅ | platform_admin, tenant_admin |

### TypeScript Types

```typescript
interface GenerateQRCodeDto {
  amount: number;
  reference: string;
  description?: string;
  bookingId?: string;
  tenantId?: string;
}

interface GenerateQRCodeResponse {
  success: boolean;
  transactionRef: string;
  qrCodeData: string; // base64 image
  qrCodeString: string;
  amount: number;
  expiresAt: string;
}

interface PaymentStatus {
  transactionRef: string;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  amount: number;
  createdAt: string;
  paidAt?: string;
  payerInfo?: {
    bankCode: string;
    accountLastDigits: string;
  };
}

interface RefundRequestDto {
  transactionRef: string;
  amount: number;
  reason: string;
}
```

---

## 5. Reports Export

### Base Path: `/api/v1/reports`

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/export` | Export data to file | ✅ |
| POST | `/export/download` | Export and download directly | ✅ |

### TypeScript Types

```typescript
type ExportFormat = 'excel' | 'csv' | 'pdf';
type ReportType = 'bookings' | 'rooms' | 'guests' | 'revenue' | 'occupancy';

interface ExportRequestDto {
  type: ReportType;
  format: ExportFormat;
  dateRange?: {
    start: string;
    end: string;
  };
  columns?: string[];
  filters?: Record<string, any>;
  title?: string;
}

interface ExportResponseDto {
  success: boolean;
  filename: string;
  data: string; // base64 encoded
  mimeType: string;
}
```

---

## 6. Audit Logs

### Base Path: `/api/v1/audit-logs`

| Method | Endpoint | Description | Auth Required | Roles |
|--------|----------|-------------|---------------|-------|
| GET | `/` | Get audit logs with pagination | ✅ | platform_admin, tenant_admin |
| GET | `/export` | Export audit logs to CSV | ✅ | platform_admin, tenant_admin |
| GET | `/:id` | Get audit log by ID | ✅ | platform_admin, tenant_admin |

### TypeScript Types

```typescript
interface AuditLogQueryDto {
  page?: number;
  limit?: number;
  action?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
}

interface AuditLog {
  id: string;
  action: string;
  userId: string;
  userEmail: string;
  tenantId: string;
  timestamp: string;
  ipAddress: string;
  userAgent: string;
  details: Record<string, any>;
}

type AuditAction =
  | 'USER_LOGIN'
  | 'USER_LOGOUT'
  | 'BOOKING_CREATED'
  | 'BOOKING_UPDATED'
  | 'BOOKING_CANCELLED'
  | 'PAYMENT_RECEIVED'
  | 'ROOM_STATUS_CHANGED'
  | 'SETTINGS_UPDATED';
```

---

## 7. Line Notify

### Base Path: `/api/v1/line-notify`

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/connect` | Get authorization URL | ✅ |
| GET | `/callback` | OAuth callback | ❌ |
| GET | `/status` | Get connection status | ✅ |
| POST | `/preferences` | Update preferences | ✅ |
| GET | `/event-types` | Get available event types | ✅ |
| DELETE | `/disconnect` | Disconnect Line Notify | ✅ |
| POST | `/test` | Send test notification | ✅ |
| POST | `/send` | Send custom notification | ✅ |
| GET | `/users` | Get connected users | ✅ |

### TypeScript Types

```typescript
interface LineNotifyStatus {
  connected: boolean;
  targetName: string | null;
  targetType: 'USER' | 'GROUP' | null;
  connectedAt: string | null;
  preferences: LineNotifyPreferences | null;
}

interface LineNotifyPreferences {
  booking_created: boolean;
  booking_cancelled: boolean;
  booking_checkin: boolean;
  booking_checkout: boolean;
  payment_received: boolean;
  payment_failed: boolean;
  daily_summary: boolean;
  new_review: boolean;
  system_alert: boolean;
}

interface SendLineNotifyDto {
  message: string;
  imageUrl?: string;
  stickerPackageId?: number;
  stickerId?: number;
}

interface LineNotifyEventType {
  key: string;
  label: string;
  labelTh: string;
}
```

---

## 8. i18n Translation

### Base Path: `/api/v1/i18n`

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/languages` | Get available languages | ❌ |
| GET | `/namespaces` | Get translation namespaces | ❌ |
| GET | `/translations/:language` | Get all translations | ❌ |
| GET | `/translations/:language/:namespace` | Get namespace translations | ❌ |
| POST | `/translate` | Translate single key | ❌ |
| POST | `/translate/bulk` | Translate multiple keys | ❌ |
| GET | `/t/:key` | Get translation by key | ❌ |
| GET | `/search` | Search translations | ❌ |
| GET | `/exists/:key` | Check if key exists | ❌ |
| POST | `/reload` | Reload translations (admin) | ✅ |

### TypeScript Types

```typescript
type SupportedLanguage = 'th' | 'en' | 'zh' | 'ja' | 'ko';

interface LanguageInfo {
  code: SupportedLanguage;
  name: string;
  nativeName: string;
  default: boolean;
}

interface TranslateDto {
  key: string;
  language: SupportedLanguage;
  variables?: Record<string, string>;
}

interface TranslateBulkDto {
  keys: string[];
  language: SupportedLanguage;
}

interface TranslationResponse {
  key: string;
  value: string;
  language: SupportedLanguage;
}
```

---

## 9. Database Performance (Admin)

### Base Path: `/api/v1/admin/database`

| Method | Endpoint | Description | Auth Required | Roles |
|--------|----------|-------------|---------------|-------|
| GET | `/slow-queries` | Get slow query report | ✅ | platform_admin |
| GET | `/query-patterns` | Analyze query patterns | ✅ | platform_admin |
| GET | `/n1-detection` | Detect N+1 queries | ✅ | platform_admin |
| GET | `/health` | Get database health | ✅ | platform_admin |
| POST | `/clear-metrics` | Clear query metrics | ✅ | platform_admin |

### TypeScript Types

```typescript
interface SlowQueryReport {
  totalSlowQueries: number;
  averageExecutionTime: number;
  slowestQueries: Array<{
    query: string;
    executionTime: number;
    timestamp: string;
    table: string;
  }>;
  byTable: Record<string, number>;
}

interface DatabaseHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  connectionPool: {
    total: number;
    active: number;
    idle: number;
    waiting: number;
  };
  performance: {
    averageQueryTime: number;
    queriesPerSecond: number;
    slowQueryPercentage: number;
  };
  issues?: string[];
  warnings?: string[];
}
```

---

## 10. Mobile API

### Base Path: `/api/v1/mobile`

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/config` | Get app configuration | ❌ |
| GET | `/dashboard` | Get dashboard data | ✅ |
| GET | `/bookings` | Get bookings list | ✅ |
| GET | `/rooms` | Get rooms list | ✅ |
| GET | `/guests` | Get guests list | ✅ |
| GET | `/search` | Quick search | ✅ |
| PATCH | `/rooms/:id/status` | Update room status | ✅ |
| PATCH | `/bookings/:id/status` | Update booking status | ✅ |
| POST | `/bookings/:id/checkin` | Quick check-in | ✅ |
| POST | `/bookings/:id/checkout` | Quick check-out | ✅ |

### TypeScript Types

```typescript
interface MobileAppConfig {
  appVersion: string;
  minVersion: string;
  forceUpdate: boolean;
  maintenanceMode: boolean;
  features: {
    qrCheckIn: boolean;
    offlineMode: boolean;
    pushNotifications: boolean;
  };
  apiEndpoints: {
    baseUrl: string;
    wsUrl: string;
  };
}

interface MobileDashboard {
  todayStats: {
    checkIns: number;
    checkOuts: number;
    newBookings: number;
    revenue: number;
  };
  occupancy: {
    total: number;
    occupied: number;
    available: number;
    maintenance: number;
    percentage: number;
  };
  upcomingCheckIns: Array<{
    id: string;
    guestName: string;
    roomNumber: string;
    time: string;
  }>;
  alerts: Array<{
    type: 'info' | 'warning' | 'error';
    message: string;
  }>;
}

interface MobileBookingSummary {
  id: string;
  guestName: string;
  roomNumber: string;
  checkIn: string;
  checkOut: string;
  status: BookingStatus;
}

interface MobileRoomSummary {
  id: string;
  number: string;
  type: string;
  status: RoomStatus;
  floor: number;
}

type BookingStatus = 'pending' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled';
type RoomStatus = 'available' | 'occupied' | 'maintenance' | 'cleaning';
```

---

## 11. Push Notifications

### Base Path: `/api/v1/push-notifications`

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/status` | Check service status | ❌ |
| POST | `/devices/register` | Register device | ✅ |
| DELETE | `/devices/:token` | Unregister device | ✅ |
| GET | `/devices` | Get registered devices | ✅ |
| GET | `/preferences` | Get notification preferences | ✅ |
| POST | `/preferences` | Update preferences | ✅ |
| POST | `/send` | Send to user | ✅ |
| POST | `/send/bulk` | Send to multiple users | ✅ |
| POST | `/send/topic` | Send to topic | ✅ |
| POST | `/test` | Send test notification | ✅ |

### TypeScript Types

```typescript
interface RegisterDeviceDto {
  token: string;
  platform: 'ios' | 'android' | 'web';
  deviceName?: string;
}

interface DeviceInfo {
  id: string;
  userId: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
  deviceName: string;
  createdAt: string;
}

interface PushPreferences {
  bookingCreated: boolean;
  bookingCancelled: boolean;
  checkInReminder: boolean;
  paymentReceived: boolean;
  dailySummary: boolean;
  promotions: boolean;
}

interface SendPushNotificationDto {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}

interface SendBulkPushNotificationDto {
  userIds: string[];
  title: string;
  body: string;
  data?: Record<string, any>;
}

interface SendTopicNotificationDto {
  topic: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}
```

---

## API Client Example (TypeScript)

```typescript
// api/client.ts
import axios, { AxiosInstance } from 'axios';

const API_BASE_URL = 'https://api.hotelservices.com/api/v1';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.request.use((config) => {
      const token = localStorage.getItem('accessToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });
  }

  // Auth
  auth = {
    login: (email: string, password: string) =>
      this.client.post('/auth/login', { email, password }),
    logout: (refreshToken: string) =>
      this.client.post('/auth/logout', { refreshToken }),
    refresh: (refreshToken: string) =>
      this.client.post('/auth/refresh', { refreshToken }),
  };

  // 2FA
  twoFactor = {
    enable: () => this.client.post('/auth/2fa/enable'),
    verify: (code: string) => this.client.post('/auth/2fa/verify', { code }),
    disable: (password: string, code: string) =>
      this.client.post('/auth/2fa/disable', { password, code }),
    status: () => this.client.get('/auth/2fa/status'),
    validate: (code: string, tempToken: string) =>
      this.client.post('/auth/2fa/validate', { code, tempToken }),
  };

  // Email
  email = {
    send: (dto: SendEmailDto) =>
      this.client.post('/notifications/email/send', dto),
    sendBulk: (dto: SendBulkEmailDto) =>
      this.client.post('/notifications/email/send-bulk', dto),
    getHistory: (params: EmailHistoryQueryDto) =>
      this.client.get('/notifications/email/history', { params }),
    getTemplates: () =>
      this.client.get('/notifications/email/templates'),
  };

  // PromptPay
  promptPay = {
    generateQR: (dto: GenerateQRCodeDto) =>
      this.client.post('/payments/promptpay/generate-qr', dto),
    checkStatus: (transactionRef: string) =>
      this.client.get(`/payments/promptpay/status/${transactionRef}`),
    getTransactions: (params: TransactionQueryDto) =>
      this.client.get('/payments/promptpay/transactions', { params }),
    refund: (dto: RefundRequestDto) =>
      this.client.post('/payments/promptpay/refund', dto),
  };

  // Reports
  reports = {
    export: (dto: ExportRequestDto) =>
      this.client.post('/reports/export', dto),
    exportAndDownload: (dto: ExportRequestDto) =>
      this.client.post('/reports/export/download', dto, { responseType: 'blob' }),
  };

  // Audit Logs
  auditLogs = {
    list: (params: AuditLogQueryDto) =>
      this.client.get('/audit-logs', { params }),
    get: (id: string) =>
      this.client.get(`/audit-logs/${id}`),
    export: (params: AuditLogQueryDto) =>
      this.client.get('/audit-logs/export', { params, responseType: 'blob' }),
  };

  // Line Notify
  lineNotify = {
    getAuthUrl: () => this.client.get('/line-notify/connect'),
    getStatus: () => this.client.get('/line-notify/status'),
    updatePreferences: (preferences: LineNotifyPreferences) =>
      this.client.post('/line-notify/preferences', preferences),
    getEventTypes: () => this.client.get('/line-notify/event-types'),
    disconnect: () => this.client.delete('/line-notify/disconnect'),
    sendTest: () => this.client.post('/line-notify/test'),
    send: (dto: SendLineNotifyDto) =>
      this.client.post('/line-notify/send', dto),
    getUsers: () => this.client.get('/line-notify/users'),
  };

  // i18n
  i18n = {
    getLanguages: () => this.client.get('/i18n/languages'),
    getNamespaces: (language?: string) =>
      this.client.get('/i18n/namespaces', { params: { language } }),
    getTranslations: (language: string) =>
      this.client.get(`/i18n/translations/${language}`),
    getNamespaceTranslations: (language: string, namespace: string) =>
      this.client.get(`/i18n/translations/${language}/${namespace}`),
    translate: (dto: TranslateDto) =>
      this.client.post('/i18n/translate', dto),
    translateBulk: (dto: TranslateBulkDto) =>
      this.client.post('/i18n/translate/bulk', dto),
  };

  // Database (Admin)
  adminDatabase = {
    getSlowQueries: () => this.client.get('/admin/database/slow-queries'),
    getQueryPatterns: () => this.client.get('/admin/database/query-patterns'),
    detectN1: () => this.client.get('/admin/database/n1-detection'),
    getHealth: () => this.client.get('/admin/database/health'),
    clearMetrics: () => this.client.post('/admin/database/clear-metrics'),
  };

  // Mobile
  mobile = {
    getConfig: () => this.client.get('/mobile/config'),
    getDashboard: () => this.client.get('/mobile/dashboard'),
    getBookings: (params: { page?: number; limit?: number; status?: string }) =>
      this.client.get('/mobile/bookings', { params }),
    getRooms: (params: { page?: number; limit?: number; status?: string }) =>
      this.client.get('/mobile/rooms', { params }),
    getGuests: (params: { page?: number; limit?: number; search?: string }) =>
      this.client.get('/mobile/guests', { params }),
    search: (q: string) =>
      this.client.get('/mobile/search', { params: { q } }),
    updateRoomStatus: (id: string, status: string) =>
      this.client.patch(`/mobile/rooms/${id}/status`, { status }),
    updateBookingStatus: (id: string, status: string) =>
      this.client.patch(`/mobile/bookings/${id}/status`, { status }),
    checkIn: (id: string) =>
      this.client.post(`/mobile/bookings/${id}/checkin`),
    checkOut: (id: string) =>
      this.client.post(`/mobile/bookings/${id}/checkout`),
  };

  // Push Notifications
  pushNotifications = {
    getStatus: () => this.client.get('/push-notifications/status'),
    registerDevice: (dto: RegisterDeviceDto) =>
      this.client.post('/push-notifications/devices/register', dto),
    unregisterDevice: (token: string) =>
      this.client.delete(`/push-notifications/devices/${token}`),
    getDevices: () => this.client.get('/push-notifications/devices'),
    getPreferences: () => this.client.get('/push-notifications/preferences'),
    updatePreferences: (dto: PushPreferences) =>
      this.client.post('/push-notifications/preferences', dto),
    send: (dto: SendPushNotificationDto) =>
      this.client.post('/push-notifications/send', dto),
    sendBulk: (dto: SendBulkPushNotificationDto) =>
      this.client.post('/push-notifications/send/bulk', dto),
    sendTopic: (dto: SendTopicNotificationDto) =>
      this.client.post('/push-notifications/send/topic', dto),
    sendTest: () => this.client.post('/push-notifications/test'),
  };
}

export const api = new ApiClient();
```

---

## Error Handling

All errors follow this format:

```typescript
interface ApiError {
  success: false;
  statusCode: number;
  timestamp: string;
  message: string;
  error?: string;
  details?: Record<string, any>;
}
```

### Common Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Missing or invalid token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found |
| 422 | Validation Error |
| 429 | Too Many Requests (Rate Limited) |
| 500 | Internal Server Error |

---

## Rate Limiting

| Endpoint | Limit |
|----------|-------|
| Global | 100 requests/minute per IP |
| `/auth/register` | 5 requests/minute |
| `/auth/login` | 10 requests/minute |
| `/auth/refresh` | 30 requests/minute |
| `/auth/forgot-password` | 3 requests/hour |

---

## Notes for Frontend Developers

1. **All datetime values are in ISO 8601 format** (e.g., `2024-01-15T10:30:00.000Z`)
2. **Currency amounts are in THB** (Thai Baht) as numbers
3. **Pagination** uses `page` (1-indexed) and `limit` parameters
4. **Tenant isolation** is automatic based on user's JWT token
5. **File downloads** should use `responseType: 'blob'` in axios
6. **WebSocket** endpoint available at `wss://ws.hotelservices.com` for real-time updates
