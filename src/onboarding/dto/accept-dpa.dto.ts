import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AcceptDpaDto {
  @ApiProperty({ example: true, description: 'Must be true to accept the DPA' })
  @IsBoolean()
  accepted: boolean;

  @ApiProperty({ example: '1.0', description: 'DPA document version accepted by the tenant' })
  @IsString()
  @IsNotEmpty()
  version: string;

  @ApiPropertyOptional({ example: 'StaySync Data Processing Agreement' })
  @IsString()
  @IsOptional()
  title?: string;
}
