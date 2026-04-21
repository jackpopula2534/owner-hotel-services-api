import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsInt, Min, MaxLength } from 'class-validator';

export class CreateHrDeductionTypeDto {
  @ApiProperty({ example: 'ประกันสังคม' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Social Security' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameEn?: string;

  @ApiProperty({ example: 'SOCIAL_SECURITY' })
  @IsString()
  @MaxLength(50)
  code: string;

  @ApiPropertyOptional({ default: false, description: 'บังคับตัดทุกคน' })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

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
