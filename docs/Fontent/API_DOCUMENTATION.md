# StaySync - API Documentation (Detailed)

This document provides a detailed overview of the API endpoints available for the StaySync platform, based on the `API_TASK_OVERVIEW.md`.

## Base URL
`https://api.staysync.com/api` (Production)
`http://localhost:3000/api` (Development)

## Authentication
Most endpoints require a JWT token in the `Authorization` header.
Format: `Authorization: Bearer <your_jwt_token>`

---

## 1. Notifications & Alerts
Manage user notifications and real-time alerts.

### GET `/notifications`
Retrieve a list of notifications for the current user.
- **Headers:** `Authorization: Bearer <token>`
- **Query Parameters:**
  - `page` (optional): Page number (string)
  - `limit` (optional): Items per page (string)
  - `isRead` (optional): Filter by read status ('true'/'false')
- **Response:** Array of notification objects.

### PATCH `/notifications/:id/read`
Mark a specific notification as read.
- **Headers:** `Authorization: Bearer <token>`
- **Path Parameters:**
  - `id`: Notification ID
- **Response:** Updated notification object.

### PATCH `/notifications/read-all`
Mark all notifications for the current user as read.
- **Headers:** `Authorization: Bearer <token>`
- **Response:** Success message.

### DELETE `/notifications/:id`
Delete a specific notification.
- **Headers:** `Authorization: Bearer <token>`
- **Path Parameters:**
  - `id`: Notification ID
- **Response:** Success message.

### WebSocket / Push Support
Real-time notifications are supported via WebSockets.
- **Namespace:** `/notifications`
- **Events:**
  - `notification`: Received when a new notification is sent to the user.
- **Connection:** Requires authenticated connection with JWT.


---

## 2. Contact & Demo Booking
Handle landing page inquiries and demo scheduling.

### POST `/contact/demo`
Schedule a product demo.
- **Body:**
  ```json
  {
    "name": "John Doe",
    "email": "john@example.com",
    "phoneNumber": "0812345678",
    "demoDate": "2024-03-20T10:00:00Z",
    "demoType": "online",
    "notes": "Interested in multi-property management"
  }
  ```
- **Response:** Booking confirmation details.

### POST `/contact/message`
Submit a general inquiry from the contact form.
- **Body:**
  ```json
  {
    "name": "Jane Smith",
    "email": "jane@example.com",
    "subject": "Pricing Inquiry",
    "message": "I'd like to know more about the Enterprise plan."
  }
  ```
- **Response:** Success message.

---

## 3. Onboarding Progress
Track and update user onboarding steps.

### GET `/onboarding/progress`
Get the current onboarding progress for the user's tenant.
- **Headers:** `Authorization: Bearer <token>`
- **Response:** Object containing steps and completion status.

### PATCH `/onboarding/step/:id`
Mark an onboarding step as completed or incomplete.
- **Headers:** `Authorization: Bearer <token>`
- **Path Parameters:**
  - `id`: Step identifier (e.g., 'create_hotel', 'add_room')
- **Body:**
  ```json
  {
    "isCompleted": true
  }
  ```
- **Response:** Updated progress object.

---

## 4. Analytics & A/B Testing
Track user events and fetch summary analytics.

### POST `/analytics/event`
Track a custom user event.
- **Headers:** `Authorization: Bearer <token>`
- **Body:**
  ```json
  {
    "eventName": "dashboard_view",
    "metadata": {
      "source": "login_redirect",
      "duration": 5.2
    }
  }
  ```
- **Response:** Success message.

### GET `/analytics/summary`
Retrieve analytics summary (e.g., time saved, occupancy rate).
- **Headers:** `Authorization: Bearer <token>`
- **Response:** Summary object.

### GET `/analytics/feature-flag/:name`
Check if a specific feature is enabled for the current tenant.
- **Headers:** `Authorization: Bearer <token>`
- **Path Parameters:**
  - `name`: Feature flag name
- **Response:** `{ "enabled": boolean }`

---

## 5. Subscription & Loyalty
Manage renewals and referral programs.

### GET `/subscription/renewal-status`
Get subscription expiry and automatic renewal status.
- **Headers:** `Authorization: Bearer <token>`
- **Response:**
  ```json
  {
    "status": "active",
    "endDate": "2024-12-31T23:59:59Z",
    "autoRenew": true,
    "paymentHistory": []
  }
  ```

### GET `/loyalty/points`
Retrieve user's loyalty points and VIP status.
- **Headers:** `Authorization: Bearer <token>`
- **Response:** `{ "points": number, "tier": string }`

### POST `/referral/invite`
Send an invitation email for the referral program.
- **Headers:** `Authorization: Bearer <token>`
- **Body:**
  ```json
  {
    "email": "friend@example.com"
  }
  ```
- **Response:** Success message.

---

## 6. Promotions
Retrieve active offers and apply coupons.

### GET `/promotions/active`
Fetch promotions tailored for the user's segment.
- **Headers:** `Authorization: Bearer <token>`
- **Query Parameters:**
  - `segment` (optional): specific user segment (defaults to user's assigned segment)
- **Response:** Array of promotion objects.

### POST `/promotions/apply-coupon`
Validate and apply a discount code.
- **Headers:** `Authorization: Bearer <token>`
- **Body:**
  ```json
  {
    "code": "WELCOME30"
  }
  ```
- **Response:** Validation result and discount details.
