import { PartialType, OmitType, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateAccountDto } from './create-account.dto';

export class UpdateAccountDto extends PartialType(OmitType(CreateAccountDto, ['code'] as const)) {
  @ApiPropertyOptional({ description: 'เปิด/ปิดใช้งานบัญชี' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
