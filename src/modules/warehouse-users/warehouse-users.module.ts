import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { WarehouseUsersService } from './warehouse-users.service';
import { WarehouseUsersController } from './warehouse-users.controller';

/**
 * Warehouse Users module.
 *
 * Provides tenant-scoped CRUD for warehouse user accounts
 * (roles: warehouse_manager, inventory_clerk, qc_officer, receiver).
 *
 * This mirrors the Procurement Users pattern but is scoped under the
 * /warehouse namespace and supports per-user warehouseIds (multi-warehouse).
 */
@Module({
  imports: [PrismaModule],
  providers: [WarehouseUsersService],
  controllers: [WarehouseUsersController],
  exports: [WarehouseUsersService],
})
export class WarehouseUsersModule {}
