import { IsNotEmpty, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RunNightAuditDto {
  @ApiProperty({ description: 'Property ID', example: 'uuid-xxx' })
  @IsNotEmpty()
  @IsUUID()
  propertyId: string;

  @ApiPropertyOptional({
    description: 'วันที่ทำ Night Audit (YYYY-MM-DD) ถ้าไม่ระบุใช้วันนี้',
    example: '2025-05-25',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'auditDate must be YYYY-MM-DD' })
  auditDate?: string;
}
