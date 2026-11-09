import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { INQUIRY_STATUSES, INQUIRY_TYPES, InquiryStatus, InquiryType } from '../website.constants';

export class WebsiteInquiryQueryDto {
  @ApiProperty({ enum: INQUIRY_STATUSES, required: false })
  @IsOptional()
  @IsIn(INQUIRY_STATUSES)
  status?: InquiryStatus;

  @ApiProperty({ enum: INQUIRY_TYPES, required: false })
  @IsOptional()
  @IsIn(INQUIRY_TYPES)
  type?: InquiryType;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class UpdateWebsiteInquiryDto {
  @ApiProperty({ enum: INQUIRY_STATUSES, required: false })
  @IsOptional()
  @IsIn(INQUIRY_STATUSES)
  status?: InquiryStatus;

  /** ผูกกับการจองที่สร้างจากคำขอนี้ — ต้องเป็นการจองของ tenant เดียวกัน; null = ถอดออก */
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  bookingId?: string | null;
}
