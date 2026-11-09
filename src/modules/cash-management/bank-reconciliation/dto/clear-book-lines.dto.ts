import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ClearBookLinesDto {
  @ApiProperty({ description: 'id รายการ journal_lines ของบัญชีธนาคาร', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  journalLineIds: string[];

  @ApiProperty({ description: 'true = ปรากฏใน Statement แล้ว, false = ยกเลิกการกระทบ' })
  @IsBoolean()
  cleared: boolean;
}
