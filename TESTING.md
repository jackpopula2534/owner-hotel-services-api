# 🧪 Backend Testing Guide

## ✅ Test Status

**Current Status:** ✅ All tests passing

```
Test Suites: 3 passed, 3 total
Tests:       24 passed, 24 total
```

## 📁 Test Files

### Authentication Module
- ✅ `src/modules/auth/auth.service.spec.ts` - Auth service tests (12 tests)
- ✅ `src/modules/auth/auth.controller.spec.ts` - Auth controller tests (4 tests)

### Guests Module
- ✅ `src/modules/guests/guests.service.spec.ts` - Guests service tests (8 tests)

## 🚀 Running Tests

```bash
# Run all tests
npm test

# Run in watch mode
npm run test:watch

# Run with coverage
npm run test:cov

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration
```

## 📊 Test Coverage

```bash
npm run test:cov
```

Coverage report will be generated in `coverage/` directory.

## ✍️ Writing New Tests

### Service Test Example

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { YourService } from './your.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('YourService', () => {
  let service: YourService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    yourModel: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YourService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<YourService>(YourService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

### Controller Test Example

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { YourController } from './your.controller';
import { YourService } from './your.service';

describe('YourController', () => {
  let controller: YourController;
  let service: YourService;

  const mockService = {
    findAll: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [YourController],
      providers: [
        {
          provide: YourService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<YourController>(YourController);
    service = module.get<YourService>(YourService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
```

## 🔧 Test Configuration

Jest configuration is in `jest.config.js`:
- Test files: `*.spec.ts`
- Root directory: `src/`
- Coverage directory: `coverage/`

## 📝 Best Practices

1. **Mock external dependencies** (Prisma, JWT, etc.)
2. **Test both success and error cases**
3. **Use descriptive test names**
4. **Keep tests isolated** (use `beforeEach` to reset mocks)
5. **Test edge cases** (null, empty, invalid inputs)

---

**Last Updated:** 2024-12-14






