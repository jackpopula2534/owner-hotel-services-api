import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Fields a user may change on their own account — never role, status or tenant. */
export class UpdateMyProfileDto {
  @ApiPropertyOptional({ example: 'สมชาย' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'ใจดี' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ example: '0812345678', description: 'Empty string clears the number' })
  @IsOptional()
  @IsString()
  @Matches(/^$|^[0-9+\-\s()]{6,20}$/, { message: 'เบอร์โทรศัพท์ไม่ถูกต้อง' })
  phone?: string;
}
