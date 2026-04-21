import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ExtendDeadlineDto {
  @ApiProperty({
    example: '2026-05-15T17:00:00.000Z',
    description: 'Deadline ใหม่ (ต้องเลยจาก deadline เดิม)',
  })
  @IsDateString()
  deadline!: string;
}
