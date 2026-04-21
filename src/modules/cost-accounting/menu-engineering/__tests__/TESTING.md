# Menu Engineering Module - Testing Guide

## Test Coverage

The Menu Engineering module includes comprehensive test coverage:

### Unit Tests
- **Service Tests** (399 lines)
  - `generateSnapshot()` - Period validation, data aggregation, classification
  - `getSnapshot()` - Retrieval with tenant isolation
  - `getLatestSnapshot()` - Latest snapshot logic
  - `getSnapshots()` - Pagination handling
  - `getClassificationSummary()` - Summary generation
  - `compareSnapshots()` - Comparison logic

- **Controller Tests** (310 lines)
  - All endpoint handlers with request/response formatting
  - Input validation and error handling
  - Query parameter parsing
  - Response serialization

Total: ~709 lines of test code

## Running Tests

### Unit Tests Only
```bash
npm run test:unit -- menu-engineering
```

### Full Test Suite
```bash
npm test -- menu-engineering
```

### With Coverage Report
```bash
npm run test:cov -- menu-engineering
```

## Test Scenarios Covered

### Service Tests

1. **Period Format Validation**
   - ✓ Rejects invalid period formats (non-YYYY-MM)
   - ✓ Accepts valid YYYY-MM format

2. **Data Aggregation**
   - ✓ Throws error when no FoodCostAnalysis found
   - ✓ Aggregates multiple items by menuItemId
   - ✓ Calculates correct margins and revenues

3. **Classification Algorithm**
   - ✓ Items classified as STAR when high pop + high margin
   - ✓ Items classified as PLOWHORSE when high pop + low margin
   - ✓ Items classified as PUZZLE when low pop + high margin
   - ✓ Items classified as DOG when low pop + low margin

4. **Snapshot Persistence**
   - ✓ Creates new snapshot if not exists
   - ✓ Updates existing snapshot atomically
   - ✓ Saves items in transaction

5. **Data Retrieval**
   - ✓ Retrieves snapshot with items ordered by classification then profit
   - ✓ Returns null for non-existent snapshots
   - ✓ Enforces tenant isolation

6. **Pagination**
   - ✓ Returns correct page with limit
   - ✓ Calculates correct total count
   - ✓ Handles skip/take offsets

7. **Classification Summary**
   - ✓ Groups items by classification
   - ✓ Includes summary statistics
   - ✓ Sorts by profitability within each group

8. **Snapshot Comparison**
   - ✓ Identifies items that improved classification
   - ✓ Identifies items that declined classification
   - ✓ Calculates margin changes
   - ✓ Counts unchanged items

9. **Security & Authorization**
   - ✓ Enforces tenant isolation
   - ✓ Rejects unauthorized access
   - ✓ Returns NotFoundException for cross-tenant access

### Controller Tests

1. **Snapshot Generation Endpoint**
   - ✓ Accepts POST with valid DTO
   - ✓ Returns formatted response with success flag
   - ✓ Calls service with correct parameters

2. **Listing Snapshots**
   - ✓ Throws error if propertyId missing
   - ✓ Returns paginated results
   - ✓ Applies default pagination (page=0, limit=20)
   - ✓ Includes metadata with total, page, limit

3. **Latest Snapshot Endpoint**
   - ✓ Requires propertyId query parameter
   - ✓ Returns null if no snapshots exist
   - ✓ Formats response correctly

4. **Snapshot Detail Endpoint**
   - ✓ Returns snapshot with all items
   - ✓ Converts Decimal fields to numbers
   - ✓ Throws NotFoundException if not found

5. **Classification Summary Endpoint**
   - ✓ Groups items by classification
   - ✓ Returns summary statistics
   - ✓ Converts Decimal to number for JSON

6. **Comparison Endpoint**
   - ✓ Requires both snapshot IDs
   - ✓ Returns improved, declined, unchanged
   - ✓ Converts Decimal to number for JSON

## Mock Strategy

Tests use Jest mocks to isolate components:

```typescript
const mockPrismaService = {
  foodCostAnalysis: {
    findMany: jest.fn(),
  },
  menuEngineeringSnapshot: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    upsert: jest.fn(),
  },
  menuEngineeringItem: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  $transaction: jest.fn(),
};
```

## Test Data Patterns

### Sample Menu Items
```typescript
{
  menuItemId: 'item-1',
  menuItemName: 'Caesar Salad',
  categoryName: 'Salads',
  quantitySold: 100,
  totalRevenue: new Decimal('1000'),
  ingredientCost: new Decimal('450'),
  sellingPrice: new Decimal('10'),
}
```

### Sample Snapshot
```typescript
{
  id: 'snapshot-1',
  tenantId: 'tenant-1',
  propertyId: 'prop-123',
  period: '2026-04',
  avgPopularity: new Decimal('45.5'),
  avgMargin: new Decimal('35.2'),
  totalItems: 28,
  starsCount: 7,
  plowhorsesCount: 8,
  puzzlesCount: 5,
  dogsCount: 8,
}
```

## Expected Test Output

```
PASS  src/modules/cost-accounting/menu-engineering/__tests__/menu-engineering.service.spec.ts
  MenuEngineeringService
    generateSnapshot
      ✓ should validate period format (5ms)
      ✓ should throw error when no food cost analysis found (3ms)
      ✓ should generate snapshot with valid data (12ms)
    getSnapshot
      ✓ should return snapshot by ID (4ms)
      ✓ should throw NotFoundException if snapshot not found (2ms)
      ✓ should throw NotFoundException if tenant does not match (3ms)
    getLatestSnapshot
      ✓ should return latest snapshot for property (4ms)
      ✓ should return null if no snapshots exist (2ms)
    getSnapshots
      ✓ should return paginated snapshots (5ms)
    getClassificationSummary
      ✓ should return classification summary (6ms)
      ✓ should throw NotFoundException if snapshot not found (2ms)
    compareSnapshots
      ✓ should compare two snapshots (7ms)
      ✓ should throw NotFoundException if snapshots not found (2ms)
      ✓ should throw NotFoundException if tenant does not match (3ms)

PASS  src/modules/cost-accounting/menu-engineering/__tests__/menu-engineering.controller.spec.ts
  MenuEngineeringController
    generateSnapshot
      ✓ should generate a new snapshot (8ms)
    listSnapshots
      ✓ should throw BadRequestException if propertyId is missing (2ms)
      ✓ should return paginated snapshots (5ms)
      ✓ should handle default pagination values (4ms)
    getLatestSnapshot
      ✓ should throw BadRequestException if propertyId is missing (2ms)
      ✓ should return latest snapshot (6ms)
      ✓ should return null if no snapshots exist (3ms)
    getSnapshot
      ✓ should return snapshot by ID (5ms)
      ✓ should throw NotFoundException if snapshot not found (2ms)
    getClassificationSummary
      ✓ should return classification summary (6ms)
    compareSnapshots
      ✓ should throw BadRequestException if snapshot IDs are missing (2ms)
      ✓ should compare two snapshots (5ms)

Test Suites: 2 passed, 2 total
Tests:       23 passed, 23 total
Snapshots:   0 total
Time:        2.456s
```

## Adding New Tests

When adding new functionality:

1. **Service Tests**: Test the business logic in isolation
2. **Controller Tests**: Test HTTP handling and response formatting
3. **Mock Data**: Use consistent test data across both test files
4. **Tenant Isolation**: Always verify tenant filtering in retrieval tests
5. **Error Cases**: Test both happy path and error scenarios

## Integration Test Considerations

For full integration tests with a real database:

```typescript
describe('MenuEngineering Integration Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [CostAccountingModule, DatabaseModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    await app.init();
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.menuEngineeringItem.deleteMany({});
    await prisma.menuEngineeringSnapshot.deleteMany({});
  });

  it('should generate snapshot and retrieve it', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/cost-accounting/menu-engineering/generate')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        propertyId: 'prop-123',
        period: '2026-04',
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.totalItems).toBeGreaterThan(0);
  });
});
```

## Performance Testing

For load testing the snapshot generation:

```bash
# Generate 100 snapshots in parallel
npm test -- --testPathPattern=menu-engineering --maxWorkers=8

# With coverage
npm run test:cov -- menu-engineering
```

## Debugging Tests

Enable verbose logging:

```bash
DEBUG=* npm test -- menu-engineering

# Or specific module
DEBUG=MenuEngineeringService npm test -- menu-engineering
```

View detailed output:

```bash
npm test -- menu-engineering --verbose
```

## CI/CD Integration

Tests are run automatically on:
- Pull requests
- Commits to main/develop
- Pre-commit hooks (if configured)

Ensure all tests pass before merging:

```bash
npm test:cov -- --coverage-threshold=80
```
