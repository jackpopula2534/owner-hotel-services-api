import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiPropertyOptional({ minLength: 8, description: 'Omit to generate a temporary password' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
