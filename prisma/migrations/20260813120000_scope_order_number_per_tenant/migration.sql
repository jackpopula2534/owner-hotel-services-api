-- Order numbers are per-tenant, not global.
--
-- `orders.orderNumber` carried a global UNIQUE index while `generateOrderNumber`
-- numbered orders per tenant (ORD-YYYYMMDD-0001, counting only that tenant's
-- orders for the day). The first tenant to open a bill on a given day took
-- ORD-<date>-0001 for the whole database, so every other tenant's first bill of
-- that day collided on `orders_orderNumber_key` and the raw Prisma error
-- ("This record already exists (orders_orderNumber_key)") reached the POS.
--
-- Exactly the bug fixed for `restaurants.code` in
-- 20260810120000_scope_restaurant_code_per_tenant — the same fix, same reason.

-- DropIndex
DROP INDEX `orders_orderNumber_key` ON `orders`;

-- CreateIndex
CREATE UNIQUE INDEX `orders_tenantId_orderNumber_key` ON `orders`(`tenantId`, `orderNumber`);
