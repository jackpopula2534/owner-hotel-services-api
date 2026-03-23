# API Design Guidelines — Owner Hotel Services API

## URL Structure

```
# Resources: nouns, plural, lowercase, kebab-case
GET    /api/v1/rooms
GET    /api/v1/rooms/:id
POST   /api/v1/rooms
PUT    /api/v1/rooms/:id
PATCH  /api/v1/rooms/:id
DELETE /api/v1/rooms/:id

# Sub-resources for relationships
GET    /api/v1/properties/:id/rooms
POST   /api/v1/guests/:id/bookings

# Actions (use verbs sparingly)
POST   /api/v1/bookings/:id/check-in
POST   /api/v1/bookings/:id/check-out
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
```

## Response Format

### Success
```json
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "limit": 20, "total": 100 }
}
```

### Error
```json
{
  "success": false,
  "error": {
    "code": "BOOKING_NOT_FOUND",
    "message": "Booking with ID 123 not found"
  }
}
```

## HTTP Status Codes

- 200 OK — Success (GET, PUT, PATCH)
- 201 Created — Resource created (POST)
- 204 No Content — Deleted (DELETE)
- 400 Bad Request — Validation error
- 401 Unauthorized — Missing/invalid auth
- 403 Forbidden — Insufficient permissions
- 404 Not Found — Resource not found
- 409 Conflict — Duplicate or conflict
- 429 Too Many Requests — Rate limited
- 500 Internal Server Error — Server error

## Pagination

```
GET /api/v1/bookings?page=1&limit=20&sort=createdAt&order=desc
```

## Filtering

```
GET /api/v1/rooms?status=available&type=deluxe&minPrice=1000&maxPrice=5000
```

## Swagger Documentation

- ทุก endpoint ต้องมี @ApiTags, @ApiOperation, @ApiResponse decorators
- DTOs ต้องมี @ApiProperty decorators
- Group endpoints by module/feature
