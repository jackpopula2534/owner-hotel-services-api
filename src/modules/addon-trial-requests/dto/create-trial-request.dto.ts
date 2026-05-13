import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';

export class CreateTrialRequestDto {
  @ApiProperty({ example: 'HR_MODULE', description: 'Add-on code ที่ต้องการทดลองใช้' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  addonCode: string;

  @ApiPropertyOptional({ example: 'ต้องการทดสอบระบบ HR ก่อนตัดสินใจ' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
