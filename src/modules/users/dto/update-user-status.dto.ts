import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserStatus } from '../constants/user-status.enum';

export class UpdateUserStatusDto {
  @ApiProperty({
    enum: UserStatus,
    description: 'สถานะใหม่ของบัญชีผู้ใช้',
    example: UserStatus.SUSPENDED,
  })
  @IsEnum(UserStatus, {
    message: `status ต้องเป็นหนึ่งในค่า: ${Object.values(UserStatus).join(', ')}`,
  })
  status: UserStatus;

  @ApiPropertyOptional({
    description: 'เหตุผล (จำเป็นเมื่อ status = suspended)',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
