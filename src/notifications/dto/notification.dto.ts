import { IsString, IsOptional, IsBoolean, IsEnum } from 'class-validator';

export class CreateNotificationDto {
  @IsString()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsOptional()
  tenantId?: string;

  @IsString()
  title: string;

  @IsString()
  message: string;

  @IsString()
  @IsOptional()
  type?: string;

  @IsString()
  @IsOptional()
  category?: string;

  /** path ในแอปของหน้าต้นเรื่อง */
  @IsString()
  @IsOptional()
  link?: string;
}

export class NotificationQueryDto {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  isRead?: string;

  /** กรองตามโมดูล คั่นด้วย comma ได้ เช่น "inventory" หรือ "procurement,inventory" */
  @IsOptional()
  @IsString()
  category?: string;
}

/** แยก "a,b" → ['a','b'] (ตัดค่าว่าง) */
export function parseCategories(raw?: string): string[] {
  return (raw ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}
