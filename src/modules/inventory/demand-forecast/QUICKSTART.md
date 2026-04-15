# Demand Forecast Service - Quick Start Guide

## 1. Installation

The module is already created at:
```
src/modules/inventory/demand-forecast/
```

### Register the Module

Add to your Inventory Module (`src/modules/inventory/inventory.module.ts`):

```typescript
import { DemandForecastModule } from './demand-forecast/demand-forecast.module';

@Module({
  imports: [DemandForecastModule],
})
export class InventoryModule {}
```

## 2. Running Tests

```bash
# Run all demand forecast tests
npm test -- demand-forecast

# Run with coverage
npm run test:cov -- demand-forecast

# Run specific test file
npm test -- demand-forecast.service.spec.ts
```

## 3. API Usage

### Weekly Forecast (Next 7 Days)
```bash
curl -X GET \
  'http://localhost:3000/api/v1/inventory/demand-forecast/weekly?propertyId=550e8400-e29b-41d4-a716-446655440000' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response:**
```json
{
  "propertyId": "550e8400-e29b-41d4-a716-446655440000",
  "startDate": "2026-04-15",
  "endDate": "2026-04-22",
  "totalBookings": 15,
  "items": [
    {
      "itemId": "item-1",
      "itemName": "Pillow",
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

### Monthly Forecast (Next 30 Days)
```bash
curl -X GET \
  'http://localhost:3000/api/v1/inventory/demand-forecast/monthly?propertyId=550e8400-e29b-41d4-a716-446655440000' \
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

**Response:**
```json
{
  "propertyId": "550e8400-e29b-41d4-a716-446655440000",
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

## 4. Service Usage

### Inject Service into Other Module

```typescript
import { DemandForecastService } from '@/modules/inventory/demand-forecast';

@Injectable()
export class SomeOtherService {
  constructor(
    private readonly demandForecast: DemandForecastService,
  ) {}

  async doSomething() {
    const forecast = await this.demandForecast.forecastWeekly(
      tenantId,
      propertyId,
    );
    // Use forecast data
  }
}
```

## 5. Frontend Integration

### React Hook Example

```typescript
import { useCallback, useState } from 'react';
import axios from 'axios';

interface DemandForecast {
  propertyId: string;
  totalBookings: number;
  items: Array<{
    itemId: string;
    itemName: string;
    deficit: number;
  }>;
}

export function useDemandForecast() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forecast, setForecast] = useState<DemandForecast | null>(null);

  const getWeeklyForecast = useCallback(
    async (propertyId: string) => {
      setLoading(true);
      setError(null);
      try {
        const response = await axios.get(
          `/api/v1/inventory/demand-forecast/weekly`,
          {
            params: { propertyId },
            headers: {
              Authorization: `Bearer ${localStorage.getItem('token')}`,
            },
          }
        );
        setForecast(response.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { forecast, loading, error, getWeeklyForecast };
}
```

### Usage in Component

```typescript
import { useDemandForecast } from '@/lib/hooks/useDemandForecast';

export function InventoryDashboard({ propertyId }: { propertyId: string }) {
  const { forecast, loading, error, getWeeklyForecast } = useDemandForecast();

  useEffect(() => {
    getWeeklyForecast(propertyId);
  }, [propertyId]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!forecast) return null;

  return (
    <div>
      <h2>Weekly Demand Forecast</h2>
      <p>Total Bookings: {forecast.totalBookings}</p>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Deficit</th>
          </tr>
        </thead>
        <tbody>
          {forecast.items.map((item) => (
            <tr key={item.itemId}>
              <td>{item.itemName}</td>
              <td className={item.deficit > 0 ? 'text-red-600' : 'text-green-600'}>
                {item.deficit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

## 6. Troubleshooting

### Module Not Found
**Problem:** `Cannot find module 'DemandForecastModule'`
**Solution:** Ensure the module is imported in your Inventory module

### Invalid Property ID
**Problem:** `400 Bad Request - invalid UUID`
**Solution:** Use a valid UUID v4 format for propertyId

### No Items in Forecast
**Possible causes:**
1. No bookings in the date range
2. No amenity templates configured for room types
3. Wrong booking status (must be CONFIRMED or CHECKED_IN)

### Permission Denied
**Problem:** `403 Forbidden - User lacks INVENTORY_MODULE addon`
**Solution:** Ensure user's subscription includes INVENTORY_MODULE addon

## 7. File Structure

```
src/modules/inventory/demand-forecast/
├── __tests__/
│   ├── demand-forecast.service.spec.ts     # Unit tests
│   ├── demand-forecast.controller.spec.ts  # Controller tests
│   └── demand-forecast.integration.spec.ts # Integration tests
├── dto/
│   ├── forecast-request.dto.ts             # Input DTOs
│   ├── forecast-response.dto.ts            # Output DTOs
│   └── index.ts
├── demand-forecast.controller.ts           # REST endpoints
├── demand-forecast.service.ts              # Business logic
├── demand-forecast.module.ts               # Module definition
├── index.ts                                # Exports
├── README.md                               # Full documentation
├── INTEGRATION.md                          # Integration guide
└── QUICKSTART.md                           # This file
```

## 8. Next Steps

1. Verify all tests pass: `npm test -- demand-forecast`
2. Start the development server: `npm run start:dev`
3. Test the endpoints with your property ID
4. Integrate with your frontend
5. Monitor logs for any issues

## 9. Documentation Links

- [Full README](./README.md) - Comprehensive service documentation
- [Integration Guide](./INTEGRATION.md) - Setup and integration examples
- [Service Methods](./README.md#service-methods) - Detailed API reference

## 10. Common Patterns

### Checking for Inventory Deficits
```typescript
const forecast = await demandForecast.forecastWeekly(tenantId, propertyId);
const itemsWithDeficit = forecast.items.filter(item => item.deficit > 0);

if (itemsWithDeficit.length > 0) {
  // Alert manager to reorder items
  notificationService.sendAlert({
    type: 'INVENTORY_DEFICIT',
    items: itemsWithDeficit,
  });
}
```

### Weekly Scheduled Forecast
```typescript
// Run every Monday at 9 AM
@Cron('0 9 * * 1')
async generateWeeklyForecastReport() {
  const properties = await this.propertyService.getAllByTenant(this.tenantId);
  
  for (const property of properties) {
    const forecast = await this.demandForecast.forecastWeekly(
      this.tenantId,
      property.id,
    );
    await this.reportService.save(forecast);
  }
}
```

## Support

For issues or questions:
1. Check the [README.md](./README.md) for detailed documentation
2. Review test files for usage examples
3. Check [INTEGRATION.md](./INTEGRATION.md) for setup help
