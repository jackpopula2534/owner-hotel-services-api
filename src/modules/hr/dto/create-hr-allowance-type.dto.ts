import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsInt, Min, MaxLength } from 'class-validator';

export class CreateHrAllowanceTypeDto {
  @ApiProperty({ example: 'เซอร์วิสชาร์จ' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Service Charge' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameEn?: string;

  @ApiProperty({ example: 'SERVICE_CHARGE' })
  @IsString()
  @MaxLength(50)
  code: string;

  @ApiPropertyOptional({ default: false, description: 'ต้องเสียภาษีหรือไม่' })
  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
