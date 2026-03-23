# StaySync API Integration Summary (Frontend Support)

This document provides a summary of the newly created and updated API endpoints to help the frontend team transition from mock data to real API integration.

## Base URL
`{{BACKEND_URL}}/api/v1`

---

## 1. Authentication & Security 🔐
### Forgot Password
- **Endpoint:** `POST /auth/forgot-password`
- **Body:** `{ "email": "string" }`
- **Response:** `200 OK`
- **Note:** Returns a `token` in **development environment only** for testing. In production, it only returns a success message.

### Reset Password
- **Endpoint:** `POST /auth/reset-password`
- **Body:** `{ "token": "string", "newPassword": "string" }`
- **Response:** `200 OK`
- **Validation:** Minimum password length: 6 characters.

### Rate Limiting
- Applied globally.
- Login: 10 requests per minute.
- Forgot Password: 3 requests per hour.

---

## 2. Onboarding & Tenant Management 🏨
### Initial Reset Token
- When a new hotel is created via `HotelManagementService`, a password reset token is automatically generated for the owner's email.
- The token is valid for 7 days.
- Look for logs: `Initial setup: generated reset token for {email}: {token}`.

### Onboarding Progress
- **Endpoints:**
  - `GET /onboarding/progress`: Current checklist status.
  - `PATCH /onboarding/step/:id`: Mark step as completed.

---

## 3. Notifications 🔔
- **Endpoints:**
  - `GET /notifications`: List all notifications.
  - `PATCH /notifications/:id/read`: Mark one as read.
  - `PATCH /notifications/read-all`: Mark all as read.
  - `DELETE /notifications/:id`: Delete notification.
- **WebSocket:** `WS /api/notifications/live` for real-time alerts.

---

## 4. Loyalty & Subscription 💳
- **Renewal Status:** `GET /subscription/renewal-status`
- **Loyalty Points:** `GET /loyalty/points`
- **Referral:** `POST /referral/invite`

---

## 5. Analytics 📊
- **Track Event:** `POST /analytics/event`
- **Summary:** `GET /analytics/summary`
- **Feature Flags:** `GET /feature-flags`

---

## 6. Contact & Demo ✉️
- **Demo Booking:** `POST /contact/demo`
- **Contact Message:** `POST /contact/message`

---

## Next Steps for Frontend Team
1. Update `lib/api/client.ts` with these new endpoints.
2. Replace local storage mocks with these API calls.
3. Use the `token` returned from `forgot-password` (in dev) to test the password reset flow.
