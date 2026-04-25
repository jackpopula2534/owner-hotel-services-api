import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, UserRole } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Role Hierarchy - Level System
 * Higher level roles automatically inherit access to lower level endpoints
 */
const ROLE_LEVELS: Record<string, number> = {
  platform_admin: 1000,
  super_admin: 100,
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

    // Check hierarchy: user's level >= highest required role level
    const userLevel = getRoleLevel(user.role);
    const minRequiredLevel = Math.min(...requiredRoles.map((r) => getRoleLevel(r)));

    const hasHierarchyAccess = userLevel >= minRequiredLevel;

    if (!hasHierarchyAccess) {
      throw new ForbiddenException(
        `Access denied. You have role "${user.role}" (level ${userLevel}), but this resource requires one of: [${requiredRoles.join(', ')}]`,
      );
    }

    return true;
  }
}
