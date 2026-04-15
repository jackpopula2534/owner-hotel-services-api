# Demand Forecast Module - Integration Guide

## Module Registration

To use the Demand Forecast Service, register the module in your parent Inventory module:

### 1. Update Inventory Module

**File:** `src/modules/inventory/inventory.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { DemandForecastModule } from './demand-forecast/demand-forecast.module';

@Module({
  imports: [DemandForecastModule],
  // ... other imports
})
export class InventoryModule {}
```

### 2. PrismaService Injection

The service expects PrismaService to be available globally. Verify it's registered in your app module:

**File:** `src/app.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

@Module({
  imports: [
    // ... other modules
  ],
  providers: [PrismaService],
})
export class AppModule {}
```

## Guard Configuration

The module uses two guards:
1. **JwtAuthGuard** - Ensures user is authenticated
2. **AddonGuard** - Verifies user has INVENTORY_MODULE addon

These are imported from:
- `@/common/guards/jwt-auth.guard`
- `@/common/guards/addon.guard`

Ensure these guards are properly configured in your security module.

## Prisma Schema Requirements

The service requires these Prisma models in your schema:

```prisma
model Booking {
  id                String
  tenantId          String
  propertyId        String
  scheduledCheckIn  DateTime
  status            String  // Must include 'CONFIRMED', 'CHECKED_IN'
  room              Room?
  property          Property?
  // ... other fields
}

model Room {
  id           String
  propertyId   String
  roomTypeId   String
  roomType     RoomType
  // ... other fields
}

model RoomType {
  id                         String
  propertyId                 String
  name                       String
  rooms                      Room[]
  roomTypeAmenityTemplates   RoomTypeAmenityTemplate[]
  property                   Property?
}

model RoomTypeAmenityTemplate {
  id         String
  roomTypeId String
  roomType   RoomType
  amenityId  String
  amenity    Amenity
  quantity   Int
  taskType   String  // Must support 'checkout' value
}

model Amenity {
  id       String
  name     String
  sku      String
  unit     String
  // ... other fields
}

model WarehouseStock {
  id          String
  warehouseId String
  warehouse   Warehouse
  itemId      String
  quantity    Int
}

model Warehouse {
  id         String
  propertyId String
  property   Property?
  stocks     WarehouseStock[]
}

model Property {
  id         String
  tenantId   String
  name       String
  roomTypes  RoomType[]
  bookings   Booking[]
  warehouses Warehouse[]
  // ... other fields
}
```

## API Usage in Frontend

### TypeScript Client Example

```typescript
import axios from 'axios';

interface DemandForecast {
  propertyId: string;
  startDate: string;
  endDate: string;
  totalBookings: number;
  items: Array<{
    itemId: string;
    itemName: string;
    sku: string;
    totalRequired: number;
    currentStock: number;
    deficit: number;
    unit: string;
  }>;
}

const apiClient = axios.create({
  baseURL: process.env.REACT_APP_API_URL,
  headers: {
    Authorization: `Bearer ${localStorage.getItem('authToken')}`,
  },
});

// Weekly forecast
async function getWeeklyForecast(propertyId: string): Promise<DemandForecast> {
  const response = await apiClient.get(
    '/inventory/demand-forecast/weekly',
    { params: { propertyId } }
  );
  return response.data;
}

// Custom range forecast
async function getCustomForecast(
  propertyId: string,
  startDate: string,
  endDate: string
): Promise<DemandForecast> {
  const response = await apiClient.get(
    '/inventory/demand-forecast/custom',
    { params: { propertyId, startDate, endDate } }
  );
  return response.data;
}

// Occupancy forecast
async function getOccupancyForecast(
  propertyId: string,
  startDate: string,
  endDate: string
) {
  const response = await apiClient.get(
    '/inventory/demand-forecast/occupancy',
    { params: { propertyId, startDate, endDate } }
  );
  return response.data;
}
```

### React Hook Example

```typescript
import { useCallback, useState } from 'react';
import { apiClient } from '@/lib/api';

export function useDemandForecast(propertyId: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getWeeklyForecast = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(
        '/inventory/demand-forecast/weekly',
        { params: { propertyId } }
      );
      return response.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  return { getWeeklyForecast, loading, error };
}
```

## Testing the Module

### Run All Tests
```bash
npm test -- demand-forecast
```

### Run Specific Test Suite
```bash
npm test -- demand-forecast.service.spec.ts
npm test -- demand-forecast.controller.spec.ts
npm test -- demand-forecast.integration.spec.ts
```

### Generate Coverage Report
```bash
npm run test:cov -- demand-forecast
```

## Database Migrations

If you added new models for demand forecasting, create and run migrations:

```bash
npm run prisma:migrate dev -- --name add_demand_forecast_models
```

## Common Errors and Solutions

### Error: "Cannot find module PrismaService"
**Solution:** Ensure PrismaService is registered globally in AppModule

### Error: "Property 'roomTypeAmenityTemplates' is not defined"
**Solution:** Verify your Prisma schema includes the RoomTypeAmenityTemplate relation

### Error: "INVENTORY_MODULE addon not found"
**Solution:** Ensure the user's subscription includes the INVENTORY_MODULE addon

### Error: "Invalid date range"
**Solution:** Ensure startDate is before endDate (both in ISO 8601 format)

## Performance Tuning

For large properties with many bookings:

1. **Add Database Indexes**
```sql
CREATE INDEX idx_booking_check_in ON booking(scheduledCheckIn);
CREATE INDEX idx_booking_property_tenant ON booking(propertyId, tenantId);
CREATE INDEX idx_warehouse_stock_item ON warehouseStock(itemId);
```

2. **Pagination** (Future Enhancement)
Consider adding pagination for properties with thousands of bookings

3. **Caching**
Implement Redis caching for forecasts:
```typescript
// Example: Cache 7-day forecast for 1 hour
const cacheKey = `forecast:${propertyId}:weekly`;
```

## Monitoring and Logging

The service uses NestJS Logger. View logs with:

```bash
# Development
npm run start:dev 2>&1 | grep DemandForecastService

# Production with structured logging
npm start | jq 'select(.context=="DemandForecastService")'
```

## Related Modules

- **Bookings Module** - Provides booking data used for forecasts
- **Rooms Module** - Provides room type and inventory structure
- **Inventory Module** - Parent module containing warehouse and stock data
- **Subscriptions Module** - Manages addon availability (INVENTORY_MODULE)

## Extending the Service

### Adding Predictive Analytics
```typescript
async forecastWithTrend(
  tenantId: string,
  propertyId: string,
  days: number,
  seasonalAdjustment: boolean
): Promise<DemandForecastResponseDto> {
  // Implement moving average, exponential smoothing, etc.
}
```

### Adding Supplier Integration
```typescript
async forecastWithLeadTime(
  tenantId: string,
  propertyId: string,
  startDate: string,
  endDate: string,
  supplierLeadDays: number
): Promise<DemandForecastResponseDto> {
  // Calculate reorder dates based on lead times
}
```

### Adding Export Functionality
```typescript
async exportForecastToCSV(
  tenantId: string,
  propertyId: string,
  startDate: string,
  endDate: string
): Promise<Buffer> {
  // Convert forecast to CSV
}
```

## Version History

- **v1.0.0** - Initial release
  - Weekly, monthly, custom range forecasting
  - Occupancy analysis
  - Multi-tenant support
  - Comprehensive test coverage (80%+)
