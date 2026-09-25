import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AddonModule } from '../addons/addon.module';
import { SubscriptionsModule } from '../../subscriptions/subscriptions.module';
import { TenantUsersController } from './tenant-users.controller';
import { TenantUsersService } from './tenant-users.service';

/**
 * ผู้ใช้ของ tenant ในมุมมองเดียว — ใครเข้าระบบย่อยไหนได้ในบทบาทอะไร
 * (AuditLogModule เป็น @Global จึงไม่ต้อง import)
 */
@Module({
  imports: [PrismaModule, AddonModule, SubscriptionsModule],
  controllers: [TenantUsersController],
  providers: [TenantUsersService],
  exports: [TenantUsersService],
})
export class TenantUsersModule {}
