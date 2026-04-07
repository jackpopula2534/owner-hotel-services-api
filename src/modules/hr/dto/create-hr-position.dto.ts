import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsUUID,
  Min,
  Max,
  MaxLength,
} from 'class-validator';

export class CreateHrPositionDto {
  @ApiProperty({ description: 'ID ของแผนก' })
  @IsUUID()
  departmentId: string;

  @ApiProperty({ example: 'Front Desk Agent', description: 'ชื่อตำแหน่ง' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Front Desk Agent' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameEn?: string;

  @ApiPropertyOptional({ example: 'FDA' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @ApiPropertyOptional({ example: 2, description: 'ระดับตำแหน่ง (1=ต่ำสุด, 10=สูงสุด)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  level?: number;

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
