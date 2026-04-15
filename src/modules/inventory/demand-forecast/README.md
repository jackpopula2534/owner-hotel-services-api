# Demand Forecast Service

## Overview

The Demand Forecast Service analyzes upcoming hotel bookings and predicts inventory needs based on room types and amenity requirements. It provides actionable insights into inventory demand across different time horizons (weekly, monthly, custom ranges) and occupancy forecasting.

## Key Features

- **Booking-Based Demand Forecasting**: Analyzes confirmed and checked-in bookings to predict inventory needs
- **Amenity Template Integration**: Leverages room type amenity templates (checkout tasks) to calculate required quantities
- **Stock Comparison**: Compares predicted demand against current warehouse inventory levels
- **Deficit Calculation**: Identifies inventory gaps that need replenishment
- **Occupancy Analysis**: Provides detailed occupancy forecasts by room type
- **Multi-Tenant Support**: Fully isolated tenant data with UUID-based property identification
- **Date Range Flexibility**: Supports weekly, monthly, and custom date range forecasts

## Service Methods

### `forecastByDateRange(tenantId, propertyId, startDate, endDate)`

Generates demand forecast for a custom date range.

**Parameters:**
- `tenantId` (string): Tenant identifier
- `propertyId` (string): Property UUID
- `startDate` (string): ISO 8601 format (e.g., '2026-04-15')
- `endDate` (string): ISO 8601 format (e.g., '2026-04-22')

**Returns:** `DemandForecastResponseDto`

**Logic:**
1. Fetches all CONFIRMED and CHECKED_IN bookings with check-in between startDate and endDate
2. For each booking, retrieves room type and associated amenity templates (checkout taskType)
3. Aggregates quantities by item across all bookings
4. Queries warehouse stocks for current inventory levels
5. Calculates deficit (totalRequired - currentStock)
6. Sorts items by deficit (highest first)

**Example Response:**
```json
{
  "propertyId": "property-456",
  "startDate": "2026-04-15",
  "endDate": "2026-04-22",
  "totalBookings": 15,
  "items": [
    {
      "itemId": "item-1",
      "itemName": "Pillow (Standard)",
      "sku": "SKU-PILLOW-001",
      "totalRequired": 120,
      "currentStock": 100,
      "deficit": 20,
      "unit": "pieces",
      "roomType": "Deluxe Room",
      "bookingCount": 10
    }
  ],
  "itemsWithDeficit": 5,
  "generatedAt": "2026-04-15T10:30:00Z"
}
```

### `forecastWeekly(tenantId, propertyId)`

Generates 7-day demand forecast starting from today.

**Parameters:**
- `tenantId` (string): Tenant identifier
- `propertyId` (string): Property UUID

**Returns:** `DemandForecastResponseDto`

### `forecastMonthly(tenantId, propertyId)`

Generates 30-day demand forecast starting from today.

**Parameters:**
- `tenantId` (string): Tenant identifier
- `propertyId` (string): Property UUID

**Returns:** `DemandForecastResponseDto`

### `getOccupancyForecast(tenantId, propertyId, startDate, endDate)`

Generates occupancy forecast with breakdown by room type.

**Parameters:**
- `tenantId` (string): Tenant identifier
- `propertyId` (string): Property UUID
- `startDate` (string): ISO 8601 format
- `endDate` (string): ISO 8601 format

**Returns:** `OccupancyForecastResponseDto`

**Logic:**
1. Fetches all room types in the property with their room counts
2. Fetches all CONFIRMED and CHECKED_IN bookings in the date range
3. Tracks unique booked rooms (each room counted once even with multiple bookings)
4. Calculates occupancy percentage per room type
5. Provides overall and per-room-type breakdown

**Example Response:**
```json
{
  "propertyId": "property-456",
  "startDate": "2026-04-15",
  "endDate": "2026-04-22",
  "totalRooms": 100,
  "bookedRooms": 85,
  "occupancyPercentage": 85,
  "totalBookings": 90,
  "byRoomType": [
    {
      "roomType": "Deluxe Room",
      "totalRooms": 20,
      "bookedRooms": 18,
      "occupancyPercentage": 90
    }
  ],
  "generatedAt": "2026-04-15T10:30:00Z"
}
```

## API Endpoints

All endpoints require JWT authentication and INVENTORY_MODULE addon.

### GET `/api/v1/inventory/demand-forecast/weekly`

7-day demand forecast.

**Query Parameters:**
- `propertyId` (string, required): Property UUID

**Status Codes:**
- 200: Success
- 400: Invalid property ID
- 401: Missing/invalid token
- 403: Insufficient addon permissions

### GET `/api/v1/inventory/demand-forecast/monthly`

30-day demand forecast.

**Query Parameters:**
- `propertyId` (string, required): Property UUID

### GET `/api/v1/inventory/demand-forecast/custom`

Custom date range forecast.

**Query Parameters:**
- `propertyId` (string, required): Property UUID
- `startDate` (string, optional): ISO 8601 date. Defaults to today.
- `endDate` (string, optional): ISO 8601 date. Defaults to today.

**Validation:**
- startDate must be before endDate
- Dates must be valid ISO 8601 format

### GET `/api/v1/inventory/demand-forecast/occupancy`

Occupancy forecast for date range.

**Query Parameters:**
- `propertyId` (string, required): Property UUID
- `startDate` (string, required): ISO 8601 date
- `endDate` (string, required): ISO 8601 date

## Data Flow

```
Booking (with check-in date)
  ↓
Room (associated with room)
  ↓
RoomType (defines amenity requirements)
  ↓
RoomTypeAmenityTemplates (quantity per task type)
  ↓
Amenity (item details: name, SKU, unit)
  ↓
WarehouseStock (aggregate by warehouse)
  ↓
Deficit = TotalRequired - CurrentStock
```

## Key Business Rules

1. **Booking Status Filter**: Only CONFIRMED and CHECKED_IN bookings are included
2. **Amenity Task Type**: Only checkout tasks are considered (not checkin or housekeeping)
3. **Stock Aggregation**: Stock is summed across all warehouses for a property
4. **Deficit Calculation**: Never negative (maximum of 0 if stock exceeds demand)
5. **Occupancy Counting**: Unique rooms, not booking count (one room may have multiple bookings)
6. **Occupancy Percentage**: Rounded to nearest integer

## Error Handling

### BadRequestException
- Thrown when startDate is after endDate
- HTTP 400 response

### Validation Errors
- Invalid UUID format
- Invalid ISO 8601 date format
- Missing required parameters
- HTTP 400 response with validation details

## Performance Considerations

- **Booking Query**: Filtered by tenantId, propertyId, and date range
- **Stock Aggregation**: Uses Prisma aggregate with indexed warehouseId
- **Room Type Join**: Includes related data in single query (include strategy)
- **No N+1 Queries**: All required data fetched upfront

## Testing

### Unit Tests (`demand-forecast.service.spec.ts`)
- Forecast calculation logic
- Deficit computation
- Date validation
- Empty booking handling
- Multi-booking aggregation

### Controller Tests (`demand-forecast.controller.spec.ts`)
- Endpoint routing
- Query parameter handling
- Guard integration
- Response formatting

### Integration Tests (`demand-forecast.integration.spec.ts`)
- Full HTTP request/response cycle
- Parameter validation
- Error response handling
- Real Prisma mock scenarios

**Run tests:**
```bash
npm test -- demand-forecast
npm run test:cov -- demand-forecast
```

## Security Considerations

1. **Multi-Tenancy**: All queries filtered by tenantId
2. **Authentication**: Requires valid JWT token via JwtAuthGuard
3. **Authorization**: Requires INVENTORY_MODULE addon via AddonGuard
4. **Data Isolation**: Property-level filtering prevents cross-property access
5. **No Sensitive Data**: Returns only inventory aggregates, not raw personal data

## Usage Examples

### Weekly Forecast
```bash
curl -X GET \
  'http://localhost:3000/api/v1/inventory/demand-forecast/weekly?propertyId=550e8400-e29b-41d4-a716-446655440000' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

### Custom Date Range
```bash
curl -X GET \
  'http://localhost:3000/api/v1/inventory/demand-forecast/custom?propertyId=550e8400-e29b-41d4-a716-446655440000&startDate=2026-04-15&endDate=2026-05-15' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

### Occupancy Forecast
```bash
curl -X GET \
  'http://localhost:3000/api/v1/inventory/demand-forecast/occupancy?propertyId=550e8400-e29b-41d4-a716-446655440000&startDate=2026-04-15&endDate=2026-04-22' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

## Future Enhancements

- Historical demand analysis for trend prediction
- Predictive algorithms (moving average, exponential smoothing)
- Seasonal forecasting
- Supplier lead time integration
- Automated reorder recommendations
- Forecast accuracy metrics and adjustments
- Export to CSV/PDF reports
