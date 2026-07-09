import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, UserRole } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Role Hierarchy - Level System
 * Higher level roles automatically inherit access to lower level endpoints
 *
 * **ไม่ใช่ทุก role ใน `UserRole` จะอยู่ที่นี่ และนั่นตั้งใจ**
 * role ที่ไม่อยู่ที่นี่ = ไม่สืบทอดอะไรเลย เข้าได้เฉพาะ endpoint ที่ **เอ่ยชื่อมันตรงๆ**
 * ใน `@Roles(...)` (ดู `inheritanceFloor` ว่าทำไมต้องเป็นแบบนั้น)
 * ปัจจุบัน: crm_manager, crm_agent, sales_rep, hotel_manager, warehouse_manager,
 * accounting_manager, owner, cashier, system
 *
 * การ "เติมให้ครบ" คือกับดัก — ให้ level กับ role หนึ่ง = เปิด endpoint **ทุกอัน**
 * ที่พื้นต่ำกว่านั้นทั้งระบบให้มันทันที ไม่ใช่แค่ endpoint ของโดเมนตัวเอง
 */
const ROLE_LEVELS: Record<string, number> = {
  platform_admin: 1000,
  admin: 90,
  tenant_admin: 85,
  manager: 80,
  procurement_manager: 75,
  hr: 70,
  chef: 60,
  receptionist: 50,
  waiter: 50,
  approver: 45,
  buyer: 45,
  receiver: 45,
  housekeeper: 40,
  maintenance: 40,
  accountant: 40,
  security: 40,
  staff: 30,
  user: 10,
};

function getRoleLevel(role: string): number {
  return ROLE_LEVELS[role] ?? 0;
}

/**
 * ระดับต่ำสุดที่ "สืบทอด" เข้า endpoint นี้ได้
 *
 * ต้องคิดจาก **เฉพาะ role ที่มีอันดับใน ROLE_LEVELS** เท่านั้น
 * role ที่ไม่มีอันดับ (เช่น `crm_manager`, `crm_agent`, `sales_rep` ซึ่งประกาศใน
 * `UserRole` แต่ไม่เคยถูกใส่ใน ROLE_LEVELS) จะได้ `getRoleLevel()` = 0 ถ้านับรวม
 * เข้ามาใน `Math.min` **พื้นจะตกเป็น 0 ทันที** แล้ว `userLevel >= 0` ก็จริงเสมอ
 * = ลิสต์ @Roles ทั้งอันเลิกกันใครทั้งสิ้น (แม่บ้านลบ CRM contact ได้)
 *
 * role ที่ไม่มีอันดับไม่เสียอะไรจากการถูกตัดออกตรงนี้ เพราะมันผ่านด่าน
 * exact match ซึ่งรันก่อนอยู่แล้ว การให้มันมีส่วนใน `Math.min` มีผลอย่างเดียวคือ
 * เปิดประตูให้ **คนอื่น**
 *
 * ถ้าไม่มี role ที่มีอันดับเลย → คืน Infinity = ไม่มีใครสืบทอดเข้าได้ (fail closed)
 * ลิสต์แบบนั้นถือว่าตั้งใจปิด inheritance ไม่ใช่เปิดให้ทุกคน
 */
function inheritanceFloor(requiredRoles: UserRole[]): number {
  const rankedLevels = requiredRoles.filter((r) => r in ROLE_LEVELS).map((r) => ROLE_LEVELS[r]);

  return rankedLevels.length > 0 ? Math.min(...rankedLevels) : Infinity;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1) Public route -> allow
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // 2) If no roles metadata -> allow (only JwtAuthGuard will run)
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as { role?: UserRole };

    if (!user || !user.role) {
      return false;
    }

    // Check exact role match first
    const hasExactRole = requiredRoles.includes(user.role);
    if (hasExactRole) {
      return true;
    }

    // Check hierarchy: user's level >= lowest RANKED required role level
    const userLevel = getRoleLevel(user.role);
    const minRequiredLevel = inheritanceFloor(requiredRoles);

    const hasHierarchyAccess = userLevel >= minRequiredLevel;

    if (!hasHierarchyAccess) {
      throw new ForbiddenException(
        `Access denied. You have role "${user.role}" (level ${userLevel}), but this resource requires one of: [${requiredRoles.join(', ')}]`,
      );
    }

    return true;
  }
}
