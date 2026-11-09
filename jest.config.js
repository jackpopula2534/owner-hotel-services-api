module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    '**/*.(t|j)s',
    '!**/*.spec.ts',
    '!**/*.dto.ts',
    '!**/*.module.ts',
    '!**/dto/**',
    '!**/entities/**',
    '!**/types/**',
    '!**/main.ts',
    '!**/index.ts',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // ── Coverage floor (Phase 4 — incremental ratchet) ──────────────────────
  // Strategy: pin a global floor at the current observed level so coverage
  // can never regress. Then bump these numbers by ~5% per sprint until the
  // 80% target in TESTING.md is hit.
  //
  // Per-file overrides target the highest-risk files (auth, bookings,
  // payments). These files MUST be near-fully covered before anything
  // else; the floors here are conservative starting points.
  //
  // To verify locally:  npm run test:cov
  // To bump the floor:  raise the numbers below in a small PR after
  //                     enough new tests land to clear the bar.
  coverageThreshold: {
    global: {
      statements: 12,
      branches: 7,
      functions: 10,
      lines: 12,
    },
    'src/modules/auth/auth.service.ts': {
      statements: 44,
      branches: 29,
      functions: 26,
      lines: 44,
    },
    'src/modules/bookings/bookings.service.ts': {
      statements: 34,
      branches: 33,
      functions: 22,
      lines: 35,
    },
    'src/modules/housekeeping/housekeeping.service.ts': {
      statements: 23,
      branches: 12,
      functions: 18,
      lines: 22,
    },
    'src/modules/maintenance/maintenance.service.ts': {
      statements: 39,
      branches: 37,
      functions: 38,
      lines: 38,
    },
    'src/modules/staff/staff.service.ts': {
      statements: 27,
      branches: 9,
      functions: 31,
      lines: 26,
    },
  },
};

