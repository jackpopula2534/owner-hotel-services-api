import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsInt, Min, MaxLength } from 'class-validator';

export class CreateHrDepartmentDto {
  @ApiProperty({ example: 'Front Office', description: 'ชื่อแผนก (ภาษาไทย)' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Front Office', description: 'ชื่อแผนก (ภาษาอังกฤษ)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameEn?: string;

  @ApiProperty({ example: 'FO', description: 'รหัสแผนก (unique per tenant)' })
  @IsString()
  @MaxLength(20)
  code: string;

  @ApiPropertyOptional({ example: 'แผนกต้อนรับส่วนหน้า' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '#8B5CF6', description: 'สีแผนก (hex color)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

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
