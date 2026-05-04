/**
 * Proxy-based PrismaService mock for unit tests.
 *
 * Why a Proxy?
 *   We don't want every spec to declare every model it touches. The Proxy
 *   auto-creates a per-model record (`findMany`, `findFirst`, `findUnique`,
 *   `create`, `update`, `upsert`, `delete`, `count`, `aggregate`, ...) the
 *   first time the spec accesses `prisma.someModel`. Each method is a
 *   `jest.fn()` so `mockResolvedValue(...)` / `mockReturnValue(...)` work as
 *   expected.
 *
 * Usage:
 *   const prisma = createMockPrisma();
 *   prisma.booking.findMany.mockResolvedValue([{ id: '1' }]);
 *
 *   const moduleRef = await Test.createTestingModule({
 *     providers: [
 *       MyService,
 *       { provide: PrismaService, useValue: prisma },
 *     ],
 *   }).compile();
 *
 * Notes:
 *   - `$transaction(fn)` defaults to invoking `fn(prisma)` so service code
 *     using `prisma.$transaction(async (tx) => { ... })` works without setup.
 *   - `$transaction([...])` (batch form) returns the array as-is.
 *   - Override any individual method with `prisma.booking.findMany.mockX(...)`.
 */
import { PrismaService } from '../../prisma/prisma.service';

const PRISMA_METHODS = [
  'findMany',
  'findFirst',
  'findUnique',
  'findFirstOrThrow',
  'findUniqueOrThrow',
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
] as const;

const TOP_LEVEL_METHODS = new Set([
  '$connect',
  '$disconnect',
  '$on',
  '$use',
  '$queryRaw',
  '$queryRawUnsafe',
  '$executeRaw',
  '$executeRawUnsafe',
  'onModuleInit',
  'onModuleDestroy',
]);

function makeModelMock(): Record<string, jest.Mock> {
  return PRISMA_METHODS.reduce<Record<string, jest.Mock>>((acc, method) => {
    // Sensible defaults so a service that auto-iterates a result doesn't
    // crash with "X is not iterable" when the spec didn't enumerate the
    // model. Specs that care override with .mockResolvedValue(...).
    if (method === 'findMany' || method === 'createMany' || method === 'groupBy') {
      acc[method] = jest.fn().mockResolvedValue([]);
    } else if (method === 'count') {
      acc[method] = jest.fn().mockResolvedValue(0);
    } else if (
      method === 'aggregate' ||
      method === 'updateMany' ||
      method === 'deleteMany'
    ) {
      acc[method] = jest.fn().mockResolvedValue({ count: 0 });
    } else {
      // findFirst/findUnique/etc default to null (no row found)
      acc[method] = jest.fn().mockResolvedValue(null);
    }
    return acc;
  }, {});
}

export type MockPrismaService = jest.Mocked<PrismaService> & {
  [model: string]: Record<string, jest.Mock> | jest.Mock | unknown;
};

/**
 * Wrap an existing manual prisma mock with a Proxy fallback so any model
 * the service touches that is NOT enumerated in the manual mock is still
 * served as `{ findMany: jest.fn(), findFirst: jest.fn(), ... }`. Existing
 * setup like `manualMock.booking.findMany.mockResolvedValue(...)` continues
 * to work — the Proxy only fills the gaps.
 *
 * Use this when porting an existing spec without rewriting all its setup.
 */
export function withPrismaFallback<T extends Record<string, unknown>>(
  manualMock: T,
): T & MockPrismaService {
  const cache = new Map<string, Record<string, jest.Mock>>();
  return new Proxy(manualMock, {
    get(target, prop: string | symbol, receiver) {
      if (typeof prop !== 'string') {
        return Reflect.get(target, prop, receiver);
      }
      // If the manual mock has it, prefer the manual setup (with all its state).
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      // $transaction(fn) — invoke fn(this) by default.
      if (prop === '$transaction') {
        const $tx = jest.fn(async (arg: unknown) => {
          if (typeof arg === 'function') {
            return (arg as (tx: unknown) => unknown)(receiver);
          }
          return Array.isArray(arg) ? arg : undefined;
        });
        // Cache so subsequent reads see the same fn for assertions.
        (target as Record<string, unknown>).$transaction = $tx;
        return $tx;
      }
      // Otherwise auto-stub a model.
      let model = cache.get(prop);
      if (!model) {
        model = makeModelMock();
        cache.set(prop, model);
      }
      return model;
    },
  }) as T & MockPrismaService;
}

export function createMockPrisma(): MockPrismaService {
  const cache = new Map<string, Record<string, jest.Mock>>();

  const $transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') {
      // Callback form — pass the proxy itself as the tx client
      return (arg as (tx: unknown) => unknown)(proxy);
    }
    if (Array.isArray(arg)) {
      // Batch form — return array as-is (each entry is already a jest mock result)
      return arg;
    }
    return undefined;
  });

  const baseFns: Record<string, jest.Mock> = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $on: jest.fn(),
    $use: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue([]),
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    $transaction,
    onModuleInit: jest.fn().mockResolvedValue(undefined),
    onModuleDestroy: jest.fn().mockResolvedValue(undefined),
  };

  const proxy: MockPrismaService = new Proxy({} as MockPrismaService, {
    get(_target, prop: string | symbol) {
      if (typeof prop !== 'string') return undefined;
      if (prop in baseFns) return baseFns[prop];
      if (TOP_LEVEL_METHODS.has(prop)) {
        // Should already be in baseFns; defensive fallback
        baseFns[prop] = jest.fn();
        return baseFns[prop];
      }
      // Treat as a model name — return cached or new model mock
      let model = cache.get(prop);
      if (!model) {
        model = makeModelMock();
        cache.set(prop, model);
      }
      return model;
    },
  });

  return proxy;
}
