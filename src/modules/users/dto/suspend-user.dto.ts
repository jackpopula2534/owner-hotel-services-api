import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SuspendUserDto {
  @ApiPropertyOptional({
    description: 'เหตุผลในการระงับการใช้งาน (แนะนำให้ใส่เพื่อ audit)',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
