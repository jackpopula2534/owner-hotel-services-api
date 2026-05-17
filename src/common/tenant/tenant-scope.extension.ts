/**
 * Reserved for a future migration to Prisma's `$extends` API.
 *
 * Week 2 ships the tenant scope as a `$use` middleware
 * ({@link ./tenant-scope.middleware.ts}) because it requires zero changes to
 * the 76 NestJS services that already use `this.prisma.<model>` directly.
 *
 * When Prisma deprecates `$use` for real (currently soft-deprecated in 5.x),
 * port the same logic into a `Prisma.defineExtension(...)` factory here and
 * replace the consumer wiring in PrismaService. The set of operations and the
 * scoping field map (`tenant-scoped-models.ts`) carry over unchanged.
 */
export {};
