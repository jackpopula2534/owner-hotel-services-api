import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsIn,
  IsArray,
} from 'class-validator';

export class CreateEvaluationCycleDto {
  @ApiProperty({ description: 'Template ID ที่ใช้', example: 'uuid' })
  @IsString()
  @IsNotEmpty()
  templateId: string;

  @ApiProperty({ description: 'ชื่อรอบ', example: 'ประเมินผล Q2 2568' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'รหัสรอบ', example: '2568-Q2' })
  @IsString()
  @IsNotEmpty()
  period: string;

  @ApiProperty({
    description: 'ประเภทรอบ',
    enum: ['quarterly', 'half_yearly', 'yearly'],
    example: 'quarterly',
  })
  @IsString()
  @IsIn(['quarterly', 'half_yearly', 'yearly'])
  periodType: string;

  @ApiProperty({ description: 'วันเริ่มต้นรอบ', example: '2568-04-01' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'วันสิ้นสุดรอบ', example: '2568-06-30' })
  @IsDateString()
  endDate: string;

  @ApiProperty({ description: 'วันครบกำหนดกรอก', example: '2568-07-15' })
  @IsDateString()
  dueDate: string;

  @ApiPropertyOptional({ description: 'คำอธิบายรอบ' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'รายการ Employee IDs ที่ต้องการเพิ่มในรอบนี้',
    type: [String],
    example: ['emp-uuid-1', 'emp-uuid-2'],
  })
  @IsArray()
  employeeIds: string[];
}

export class UpdateEvaluationCycleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ['open', 'closed', 'archived'] })
  @IsOptional()
  @IsString()
  @IsIn(['open', 'closed', 'archived'])
  status?: string;
}
