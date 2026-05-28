import { IsOptional, IsEnum, IsString, IsBoolean, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { AccountTypeEnum } from './create-account.dto';

export class QueryAccountDto {
  @ApiPropertyOptional({ description: 'Property ID' })
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiPropertyOptional({ description: 'กรองตามประเภทบัญชี', enum: AccountTypeEnum })
  @IsOptional()
  @IsEnum(AccountTypeEnum)
  type?: AccountTypeEnum;

  @ApiPropertyOptional({ description: 'กรองตาม parentId (null = แสดงเฉพาะ root)' })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({ description: 'ค้นหาตาม code หรือ name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'กรองเฉพาะที่ active', default: true })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'แสดงแบบ tree (hierarchy)', default: false })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  tree?: boolean;
}
