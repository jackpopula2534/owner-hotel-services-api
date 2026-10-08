import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { TEMPLATE_KEYS, TemplateKey } from '../website.constants';

export class CreateWebsiteSiteDto {
  @ApiProperty({ example: 'grand-hotel', description: 'subdomain: a-z 0-9 - (3-40 ตัว)' })
  @IsString()
  @MaxLength(40)
  slug: string;

  @ApiProperty({ enum: TEMPLATE_KEYS, required: false })
  @IsOptional()
  @IsIn(TEMPLATE_KEYS)
  templateKey?: TemplateKey;

  /** ไม่ระบุ = property หลัก (isDefault) ของ tenant */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  propertyId?: string;
}
