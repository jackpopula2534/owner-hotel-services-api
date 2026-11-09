import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecordWhtCertificateDto {
  @ApiProperty({ description: 'เลขที่หนังสือรับรอง 50 ทวิ' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  whtCertNo: string;

  @ApiPropertyOptional({ description: 'วันที่ในหนังสือรับรอง' })
  @IsOptional()
  @IsDateString()
  whtCertDate?: string;
}
