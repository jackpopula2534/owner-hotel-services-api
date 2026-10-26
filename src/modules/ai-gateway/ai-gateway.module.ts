import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiAdminController } from './ai-admin.controller';
import { AiAdminService } from './ai-admin.service';
import { AiGatewayService } from './ai-gateway.service';

/**
 * AI Gateway — คีย์ AI ระดับแพลตฟอร์ม + งบ + บันทึกต้นทุน
 * ฟีเจอร์ที่ใช้ AI (เช่น CAMP_3D_MAP) import โมดูลนี้แล้วเรียก AiGatewayService.run()
 */
@Module({
  imports: [PrismaModule],
  controllers: [AiAdminController],
  providers: [AiGatewayService, AiAdminService],
  exports: [AiGatewayService],
})
export class AiGatewayModule {}
