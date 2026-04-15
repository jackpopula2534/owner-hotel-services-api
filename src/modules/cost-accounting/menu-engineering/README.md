# Menu Engineering Module

A NestJS module implementing the Boston Consulting Group (BCG) matrix adapted for restaurant menu analysis. This module classifies menu items based on popularity and profitability to guide menu optimization strategies.

## Overview

The Menu Engineering module analyzes menu items using a two-dimensional matrix:

- **Axis 1 (X):** Popularity - Quantity Sold
- **Axis 2 (Y):** Profitability - Contribution Margin %

This creates four quadrants:

### Classifications

1. **STAR** (High Popularity + High Margin)
   - Strategy: Maintain quality, consider modest price increase
   - Characteristics: Best performers, high volume and profit
   - Action: Keep on menu, feature prominently

2. **PLOWHORSE** (High Popularity + Low Margin)
   - Strategy: Reduce costs without compromising quality
   - Characteristics: High demand but low profitability
   - Action: Optimize recipes, reduce portions, find cheaper ingredients

3. **PUZZLE** (Low Popularity + High Margin)
   - Strategy: Increase promotion and visibility
   - Characteristics: Profitable but low demand
   - Action: Bundle with popular items, place prominently, promote

4. **DOG** (Low Popularity + Low Margin)
   - Strategy: Remove or redesign completely
   - Characteristics: Poor performers on both dimensions
   - Action: Consider removal or complete recipe redesign

## API Endpoints

All endpoints require JWT authentication and the `COST_ACCOUNTING_MODULE` addon.

### POST /api/v1/cost-accounting/menu-engineering/generate

Generate a new Menu Engineering snapshot for a period.

**Request Body:**
```json
{
  "propertyId": "uuid-of-property",
  "period": "2026-04",
  "restaurantId": "uuid-of-restaurant (optional)"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "snapshot-uuid",
    "period": "2026-04",
    "propertyId": "property-uuid",
    "avgPopularity": 45.5,
    "avgMargin": 35.2,
    "totalItems": 28,
    "starsCount": 7,
    "plowhorsesCount": 8,
    "puzzlesCount": 5,
    "dogsCount": 8,
    "items": [
      {
        "id": "item-uuid",
        "menuItemName": "Caesar Salad",
        "categoryName": "Salads",
        "quantitySold": 120,
        "sellingPrice": 10.00,
        "ingredientCost": 4.50,
        "contributionMargin": 5.50,
        "marginPercent": 55.00,
        "totalRevenue": 1200.00,
        "totalCost": 540.00,
        "totalProfit": 660.00,
        "popularityIndex": 263.74,
        "classification": "STAR",
        "recommendation": "Maintain quality and consistency. Consider a modest price increase..."
      }
    ],
    "createdAt": "2026-04-15T10:00:00Z"
  }
}
```

### GET /api/v1/cost-accounting/menu-engineering

List all snapshots for a property (paginated).

**Query Parameters:**
- `propertyId` (required): Property ID
- `page` (optional): Page number (0-indexed), default 0
- `limit` (optional): Items per page, default 20, max 100

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "snapshot-uuid",
      "period": "2026-04",
      "totalItems": 28,
      "starsCount": 7,
      "plowhorsesCount": 8,
      "puzzlesCount": 5,
      "dogsCount": 8,
      "createdAt": "2026-04-15T10:00:00Z"
    }
  ],
  "meta": {
    "total": 12,
    "page": 0,
    "limit": 20
  }
}
```

### GET /api/v1/cost-accounting/menu-engineering/latest

Get the latest snapshot for a property.

**Query Parameters:**
- `propertyId` (required): Property ID

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "snapshot-uuid",
    "period": "2026-04",
    "avgPopularity": 45.5,
    "avgMargin": 35.2,
    "items": [...]
  }
}
```

### GET /api/v1/cost-accounting/menu-engineering/:id

Get a specific snapshot with all items.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "snapshot-uuid",
    "period": "2026-04",
    "items": [...]
  }
}
```

### GET /api/v1/cost-accounting/menu-engineering/:id/summary

Get classification summary (items grouped by classification).

**Response:**
```json
{
  "success": true,
  "data": {
    "stars": [
      {
        "name": "Caesar Salad",
        "marginPercent": 55.0,
        "quantitySold": 120,
        "totalProfit": 660.00
      }
    ],
    "plowhorses": [...],
    "puzzles": [...],
    "dogs": [...],
    "summary": {
      "totalItems": 28,
      "avgMargin": 35.2,
      "avgPopularity": 45.5
    }
  }
}
```

### POST /api/v1/cost-accounting/menu-engineering/compare

Compare two snapshots to identify changes.

**Query Parameters:**
- `snapshot1` (required): First snapshot ID
- `snapshot2` (required): Second snapshot ID

**Response:**
```json
{
  "success": true,
  "data": {
    "improved": [
      {
        "name": "Caesar Salad",
        "fromClassification": "PLOWHORSE",
        "toClassification": "STAR",
        "marginChange": 5.2
      }
    ],
    "declined": [
      {
        "name": "Pasta",
        "fromClassification": "STAR",
        "toClassification": "PLOWHORSE",
        "marginChange": -3.1
      }
    ],
    "unchanged": 20
  }
}
```

## Service Methods

### generateSnapshot(dto, userId, tenantId)

Core method that:
1. Validates period format (YYYY-MM)
2. Fetches FoodCostAnalysis records for the period
3. Aggregates metrics by menu item
4. Calculates averages (popularity and margin)
5. Classifies each item into BCG quadrants
6. Generates context-specific recommendations
7. Saves snapshot and items in a transaction

**Parameters:**
- `dto`: GenerateSnapshotDto with propertyId, period, optional restaurantId
- `userId`: ID of user creating the snapshot
- `tenantId`: Tenant ID for multi-tenancy

**Returns:** MenuEngineeringSnapshotEntity

### getSnapshot(id, tenantId)

Fetch a snapshot by ID with all classified items.

**Returns:** MenuEngineeringSnapshotEntity | throws NotFoundException

### getLatestSnapshot(tenantId, propertyId)

Get the most recent snapshot for a property.

**Returns:** MenuEngineeringSnapshotEntity | null

### getSnapshots(tenantId, propertyId, skip, take)

List all snapshots for a property (paginated).

**Returns:** { data: MenuEngineeringSnapshotEntity[], total: number }

### getClassificationSummary(tenantId, propertyId, period)

Get items grouped by classification with summary stats.

**Returns:** ClassificationSummary

### compareSnapshots(tenantId, snapshotId1, snapshotId2)

Compare two snapshots to identify classification changes and margin improvements/declines.

**Returns:** ComparisonResult

## Database Models

### MenuEngineeringSnapshot

Stores snapshot metadata and summary statistics.

Fields:
- `id`: UUID primary key
- `tenantId`: Multi-tenant support
- `propertyId`: Associated property
- `restaurantId`: Optional restaurant filter
- `period`: YYYY-MM format
- `snapshotDate`: When snapshot was created
- `avgPopularity`: Average quantity sold across items
- `avgMargin`: Average contribution margin %
- `totalItems`: Count of menu items analyzed
- `starsCount`, `plowhorsesCount`, `puzzlesCount`, `dogsCount`: Classification counts
- `createdBy`: User ID who generated snapshot
- `createdAt`: Timestamp

### MenuEngineeringItem

Stores individual item analysis within a snapshot.

Fields:
- `id`: UUID primary key
- `snapshotId`: Reference to snapshot (FK)
- `menuItemId`: Reference to menu item
- `menuItemName`: Denormalized name
- `categoryName`: Menu category
- `quantitySold`: Total quantity sold in period
- `sellingPrice`: Average price per unit
- `ingredientCost`: Average ingredient cost per unit
- `contributionMargin`: Selling price minus ingredient cost
- `marginPercent`: Contribution margin as percentage
- `totalRevenue`: Quantity × selling price
- `totalCost`: Quantity × ingredient cost
- `totalProfit`: Total revenue minus total cost
- `popularityIndex`: (quantitySold / avgPopularity) × 100
- `classification`: STAR | PLOWHORSE | PUZZLE | DOG
- `recommendation`: Actionable strategy text

## Data Flow

1. **Period Close**: FoodCostAnalysis records are populated when a period is closed
2. **Snapshot Generation**: User triggers snapshot generation for a period
3. **Analysis**: Service calculates metrics, classifies items, generates recommendations
4. **Storage**: Snapshot and items saved atomically in transaction
5. **Comparison**: Can compare two periods to track improvements
6. **Recommendations**: Each item gets context-specific action items

## Classification Algorithm

For each menu item:

```
Popularity = quantitySold / avgPopularity * 100
Margin% = (sellingPrice - ingredientCost) / sellingPrice * 100

if Popularity >= avgPopularity:
  if Margin% >= avgMargin:
    STAR
  else:
    PLOWHORSE
else:
  if Margin% >= avgMargin:
    PUZZLE
  else:
    DOG
```

## Error Handling

- **BadRequestException**: Invalid period format, no data for period
- **NotFoundException**: Snapshot not found, unauthorized tenant access
- **ConflictException**: Potential duplicate snapshot

## Multi-Tenancy

All methods include tenant isolation:
- Snapshots scoped to `tenantId`
- Query filters ensure cross-tenant data leakage is impossible
- Unauthorized access returns NotFoundException

## Testing

Unit tests cover:
- Period format validation
- Classification algorithm correctness
- Tenant isolation
- Snapshot CRUD operations
- Comparison logic

Integration tests cover:
- Full API request/response cycles
- Authorization and authentication
- Pagination and filtering
- Error handling

Run tests:
```bash
npm test
npm run test:unit
npm run test:cov
```

## Usage Example

```typescript
// Generate snapshot for April 2026
const snapshot = await menuEngineeringService.generateSnapshot(
  {
    propertyId: 'prop-123',
    period: '2026-04',
  },
  'user-id',
  'tenant-id',
);

// Get classification summary
const summary = await menuEngineeringService.getClassificationSummary(
  'tenant-id',
  'prop-123',
  '2026-04',
);

// Compare April with March
const comparison = await menuEngineeringService.compareSnapshots(
  'tenant-id',
  'march-snapshot-id',
  'april-snapshot-id',
);

// Identify improvements
console.log('Items that improved:', comparison.improved);
```

## Security

- JWT authentication required on all endpoints
- Addon gate: `COST_ACCOUNTING_MODULE` required
- Tenant isolation enforced at service level
- No sensitive data in error messages
- Audit logging for snapshot creation/updates

## Performance Considerations

- Snapshots are pre-computed and cached
- No real-time calculations on API calls
- Pagination enforced on list endpoints
- Indexes on tenantId, propertyId, period for fast queries
- Transaction used for snapshot generation to ensure consistency
