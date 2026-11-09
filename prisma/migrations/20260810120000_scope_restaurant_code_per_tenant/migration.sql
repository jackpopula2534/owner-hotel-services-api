-- Restaurant codes are per-tenant, not global.
--
-- `restaurants.code` carried a global UNIQUE index while the code generator
-- numbered restaurants per tenant (RES-001, RES-002, ...). The first tenant to
-- create a restaurant took RES-001 for the whole database, so every other
-- tenant's first restaurant collided on `restaurants_code_key` — the duplicate
-- check in the service is tenant-scoped, so it passed and the raw Prisma error
-- reached the user instead.
--
-- Matches the `@@unique([tenantId, code])` pattern already used by suppliers,
-- warehouses, inventory categories and the rest of the coded documents.

-- DropIndex
DROP INDEX `restaurants_code_key` ON `restaurants`;

-- CreateIndex
CREATE UNIQUE INDEX `restaurants_tenantId_code_key` ON `restaurants`(`tenantId`, `code`);
