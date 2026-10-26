import { BadRequestException, Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { HotelMap3dService } from './hotel-map3d.service';
import { SaveHotelMap3dDto } from './hotel-map3d.dto';

interface HotelUser {
  id?: string;
  tenantId?: string;
}

/** อ่านฉาก/บอร์ด — ทุกคนที่เปิดหน้าห้องพักได้ */
export const HOTEL_MAP3D_READ_ROLES = [
  'admin',
  'manager',
  'tenant_admin',
  'receptionist',
  'platform_admin',
  'staff',
  'user',
  'hotel_manager',
  'front_desk',
] as const;
/** แก้ฉาก — ผู้จัดการ (เหมือนสร้าง/แก้ห้อง) */
export const HOTEL_MAP3D_WRITE_ROLES = ['admin', 'manager', 'tenant_admin', 'platform_admin', 'hotel_manager'] as const;

function requireTenant(user: HotelUser): string {
  if (!user?.tenantId) throw new BadRequestException('ต้องเข้าสู่ระบบด้วยบัญชีของกิจการ');
  return user.tenantId;
}

/**
 * /api/v1/properties/:propertyId/map3d — ฉาก 3D ของโรงแรม + บอร์ด Monitor
 * ยังไม่ผูก add-on (เปิดให้ทุก tenant โรงแรม) — ถ้าจะขายแยกใส่ AddonGuard + RequireAddon('HOTEL_3D_MAP') ที่นี่
 */
@ApiTags('hotel-map3d')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'properties/:propertyId/map3d', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class HotelMap3dController {
  constructor(private readonly service: HotelMap3dService) {}

  @Get()
  @ApiOperation({ summary: 'Published 3D hotel scene (null = not built yet)' })
  @Roles(...HOTEL_MAP3D_READ_ROLES)
  get(@Param('propertyId') propertyId: string, @CurrentUser() user: HotelUser) {
    return this.service.get(propertyId, requireTenant(user));
  }

  @Put()
  @ApiOperation({ summary: 'Publish the 3D hotel scene (keeps a version)' })
  @Roles(...HOTEL_MAP3D_WRITE_ROLES)
  save(@Param('propertyId') propertyId: string, @Body() dto: SaveHotelMap3dDto, @CurrentUser() user: HotelUser) {
    return this.service.save(propertyId, requireTenant(user), dto.config, user.id);
  }

  @Get('versions')
  @ApiOperation({ summary: 'Published versions (newest first, max 30)' })
  @Roles(...HOTEL_MAP3D_WRITE_ROLES)
  versions(@Param('propertyId') propertyId: string, @CurrentUser() user: HotelUser) {
    return this.service.listVersions(propertyId, requireTenant(user));
  }

  @Get('versions/:versionId')
  @ApiOperation({ summary: 'One published version with its full scene' })
  @Roles(...HOTEL_MAP3D_WRITE_ROLES)
  version(@Param('propertyId') propertyId: string, @Param('versionId') versionId: string, @CurrentUser() user: HotelUser) {
    return this.service.getVersion(propertyId, versionId, requireTenant(user));
  }

  @Get('board')
  @ApiOperation({ summary: 'Monitor board: rooms, today stays with balance, open housekeeping & maintenance' })
  @Roles(...HOTEL_MAP3D_READ_ROLES)
  board(@Param('propertyId') propertyId: string, @CurrentUser() user: HotelUser) {
    return this.service.board(propertyId, requireTenant(user));
  }
}
