---
name: api-design
description: REST API design patterns for hotel management SaaS
---

# API Design Patterns — Owner Hotel Services API

## When to Activate

- Design new API endpoints
- Review API contracts
- Add pagination, filtering, or sorting
- Implement error handling
- Plan versioning strategy

## Resource Design

### URL Structure
```
# Resources: nouns, plural, lowercase, kebab-case
GET    /api/v1/rooms
GET    /api/v1/rooms/:id
POST   /api/v1/rooms
PUT    /api/v1/rooms/:id
PATCH  /api/v1/rooms/:id
DELETE /api/v1/rooms/:id

# Sub-resources
GET    /api/v1/properties/:id/rooms
POST   /api/v1/guests/:id/bookings
GET    /api/v1/bookings/:id/payments

# Actions (verbs — use sparingly)
POST   /api/v1/bookings/:id/check-in
POST   /api/v1/bookings/:id/check-out
POST   /api/v1/bookings/:id/cancel
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
```

## Response Format

### Success (Single)
```json
{ "success": true, "data": { "id": "...", "name": "..." } }
```

### Success (List with Pagination)
```json
{
  "success": true,
  "data": [...],
  "meta": { "page": 1, "limit": 20, "total": 150, "totalPages": 8 }
}
```

### Error
```json
{
  "success": false,
  "error": { "code": "ROOM_NOT_AVAILABLE", "message": "Room is not available for selected dates" }
}
```

## Status Codes

| Code | Meaning | Use For |
|------|---------|---------|
| 200 | OK | GET, PUT, PATCH success |
| 201 | Created | POST success |
| 204 | No Content | DELETE success |
| 400 | Bad Request | Validation errors |
| 401 | Unauthorized | Missing/invalid JWT |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Duplicate booking, etc. |
| 429 | Too Many Requests | Rate limited |
| 500 | Internal Server Error | Unexpected errors |

## Pagination & Filtering

```
GET /api/v1/bookings?page=1&limit=20&sort=createdAt&order=desc
GET /api/v1/rooms?status=available&type=deluxe&floor=3
GET /api/v1/guests?search=john&sort=name&order=asc
```

## Swagger Documentation

ทุก endpoint ต้องมี:
- `@ApiTags('ModuleName')` — group by module
- `@ApiOperation({ summary: '...' })` — describe action
- `@ApiResponse({ status: 200, description: '...' })` — document responses
- DTOs ต้องมี `@ApiProperty()` ทุก field
