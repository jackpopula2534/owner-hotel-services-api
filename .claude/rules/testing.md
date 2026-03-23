# Testing Requirements — Owner Hotel Services API

## Minimum Test Coverage: 80%

Test Types (ALL required):
1. **Unit Tests** — Services, utilities, guards, interceptors
2. **Integration Tests** — Controllers with database, API endpoints
3. **E2E Tests** — Full request/response cycles via Supertest

## Test Structure

```
__tests__/
├── unit/           # Service and utility tests
├── integration/    # Controller + DB tests
└── e2e/            # Full API flow tests
```

## Test-Driven Development

Workflow:
1. Write test first (RED)
2. Run test — it should FAIL
3. Write minimal implementation (GREEN)
4. Run test — it should PASS
5. Refactor (IMPROVE)
6. Verify coverage (80%+)

## NestJS Testing Patterns

- ใช้ `Test.createTestingModule()` สำหรับ unit tests
- Mock Prisma service ด้วย `jest.mock()` หรือ manual mock
- ใช้ Supertest สำหรับ E2E tests
- Test DTOs validation separately
- Test Guards and Interceptors independently

## Testing Tools

- Jest 29 + Supertest
- `npm test` — run all tests
- `npm run test:unit` — unit tests only
- `npm run test:e2e` — E2E tests
- `npm run test:cov` — coverage report
