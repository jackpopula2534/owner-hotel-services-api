import {
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRfqDto {
  @ApiProperty({
    example: 'prop-uuid-1',
    description: 'Property ID ที่ออก RFQ',
  })
  @IsString()
  propertyId!: string;

  @ApiProperty({
    example: ['pr-uuid-1', 'pr-uuid-2'],
    description: 'รายการ PR ที่จะรวมใน RFQ เดียว (รองรับ batching)',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'ต้องระบุ PR อย่างน้อย 1 รายการ' })
  @ArrayMinSize(1)
  @IsString({ each: true })
  purchaseRequisitionIds!: string[];

  @ApiProperty({
    example: ['sup-uuid-1', 'sup-uuid-2'],
    description: 'รายการซัพพลายเออร์ที่จะส่ง RFQ ไปหา',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'ต้องระบุซัพพลายเออร์อย่างน้อย 1 ราย' })
  @ArrayMinSize(1)
  @IsString({ each: true })
  supplierIds!: string[];

  @ApiProperty({
    example: 'ขอใบเสนอราคาเครื่องครัว',
    description: 'หัวข้อ RFQ',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  subject?: string;

  @ApiProperty({
    example: 'เรียน คู่ค้าที่เคารพ... ',
    description: 'ข้อความเปิด / cover letter',
    required: false,
  })
  @IsOptional()
  @IsString()
  coverLetter?: string;

  @ApiProperty({
    example: 'เงื่อนไขการชำระ NET30 เท่านั้น',
    description: 'เงื่อนไขเฉพาะของ RFQ ฉบับนี้',
    required: false,
  })
  @IsOptional()
  @IsString()
  customTerms?: string;

  @ApiProperty({
    example: '2026-04-30T00:00:00.000Z',
    description: 'Deadline ส่งใบเสนอราคากลับ',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  deadline?: string;

  @ApiProperty({
    example: 'template-uuid',
    description: 'Template ID (ถ้ามี)',
    required: false,
  })
  @IsOptional()
  @IsString()
  templateId?: string;

  @ApiProperty({
    example: false,
    description: 'ส่งทันทีหรือบันทึกเป็น DRAFT (default: false = DRAFT)',
    required: false,
  })
  @IsOptional()
  sendImmediately?: boolean;
}
