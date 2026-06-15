import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// ─── Stage 1: Manpower request ────────────────────────────────────────────────

export class CreateManpowerRequestDto {
  @ApiPropertyOptional() @IsOptional() @IsString() propertyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() positionId?: string;

  @ApiProperty({ description: 'Position title (free text when no master position yet)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  positionTitle: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  headcount?: number;

  @ApiPropertyOptional({ enum: ['FULLTIME', 'PARTTIME', 'CONTRACT', 'TEMPORARY'] })
  @IsOptional()
  @IsIn(['FULLTIME', 'PARTTIME', 'CONTRACT', 'TEMPORARY'])
  employmentType?: string;

  @ApiProperty({ description: 'เหตุผลการขอ: replacement | expansion | new_role + รายละเอียด' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) jobDescription?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expectedStartDate?: string;
}

export class UpdateManpowerRequestDto extends CreateManpowerRequestDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(191) declare positionTitle: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) declare reason: string;
}

export class ApprovalDecisionDto {
  @ApiPropertyOptional({ description: 'หมายเหตุประกอบการอนุมัติ/ปฏิเสธ' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

// ─── Stage 2: Budget ─────────────────────────────────────────────────────────

export class SubmitBudgetDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) salaryRangeMin?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) salaryRangeMax?: number;

  @ApiProperty({ description: 'งบรวม (เงินเดือน + onboarding cost)' })
  @IsNumber()
  @Min(0)
  budgetTotal: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) budgetNote?: string;
}

// ─── Stage 3: Equipment request ──────────────────────────────────────────────

export class EquipmentItemDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(191) name: string;
  @ApiProperty() @IsInt() @Min(1) qty: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) estimatedCost?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;

  @ApiPropertyOptional({ description: 'InventoryItem id — ผูกกับคลังเมื่อมี INVENTORY_MODULE (ไม่ระบุ = checklist อิสระ)' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ description: 'Warehouse id ที่จะเบิก/จองของ (default: คลังหลักของ property)' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

export class CreateEquipmentRequestDto {
  @ApiPropertyOptional({
    description:
      'พนักงานที่จ้างแล้วซึ่งจะเบิกของให้ (เบิกทีละคน) — บังคับเมื่อใบสรรหามีพนักงานที่จ้างแล้ว',
  })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiProperty({ type: [EquipmentItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EquipmentItemDto)
  items: EquipmentItemDto[];
}

/** แก้ไขรายการของคำขอเบิกที่ยังไม่อนุมัติ (status === 'pending') */
export class UpdateEquipmentRequestDto {
  @ApiProperty({ type: [EquipmentItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EquipmentItemDto)
  items: EquipmentItemDto[];
}

// ─── Stage 4: Candidate + interview ──────────────────────────────────────────

export class CreateCandidateDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(191) firstName: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(191) lastName: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) resumeUrl?: string;

  @ApiPropertyOptional({ enum: ['walk_in', 'referral', 'job_board', 'agency'] })
  @IsOptional()
  @IsIn(['walk_in', 'referral', 'job_board', 'agency'])
  source?: string;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) expectedSalary?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class UpdateCandidateDto extends CreateCandidateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(191) declare firstName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(191) declare lastName: string;

  @ApiPropertyOptional({ enum: ['screening', 'rejected', 'withdrawn'] })
  @IsOptional()
  @IsIn(['screening', 'rejected', 'withdrawn'])
  status?: string;
}

export class ScheduleInterviewDto {
  @ApiProperty({ description: 'วัน-เวลานัดสัมภาษณ์ (ISO)' })
  @IsDateString()
  scheduledAt: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) location?: string;

  @ApiProperty({ type: [String], description: 'userIds ของกรรมการสัมภาษณ์' })
  @IsArray()
  @IsString({ each: true })
  interviewerIds: string[];

  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(10) round?: number;
}

export class RescheduleInterviewDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() scheduledAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) location?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  interviewerIds?: string[];

  @ApiPropertyOptional({ enum: ['cancelled', 'no_show'] })
  @IsOptional()
  @IsIn(['cancelled', 'no_show'])
  status?: string;
}

export class InterviewResultDto {
  @ApiProperty({ enum: ['pass', 'fail', 'next_round'] })
  @IsIn(['pass', 'fail', 'next_round'])
  result: 'pass' | 'fail' | 'next_round';

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) score?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) feedback?: string;
}

// ─── Stage 5: Offer + hire ───────────────────────────────────────────────────

export class MakeOfferDto {
  @ApiProperty() @IsNumber() @Min(0) offeredSalary: number;

  @ApiProperty({ description: 'วันเริ่มงาน (YYYY-MM-DD)' })
  @IsDateString()
  startDate: string;

  @ApiPropertyOptional({ description: 'เวลารายงานตัว เช่น 08:30' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:mm' })
  startTime?: string;

  @ApiPropertyOptional({ default: 90 }) @IsOptional() @IsInt() @Min(7) @Max(365) probationDays?: number;
}

export class HireCandidateDto {
  @ApiPropertyOptional({ description: 'Override email สำหรับสร้าง Employee (default: email ผู้สมัคร)' })
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class CancelHireDto {
  @ApiPropertyOptional({ description: 'เหตุผลที่ยกเลิก เช่น ไม่มารายงานตัว' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

// ─── Public job posting (ประกาศรับสมัครสาธารณะ) ───────────────────────────────

export class UpsertJobPostingDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(191) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(191) location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) employmentType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(191) salaryRangeText?: string;

  @ApiPropertyOptional({ description: 'เปิดรับสมัครตั้งแต่ (ISO). ว่าง = เปิดทันทีที่เผยแพร่' })
  @IsOptional()
  @IsDateString()
  openAt?: string;

  @ApiPropertyOptional({ description: 'ปิดรับสมัครเมื่อ (ISO). ว่าง = ไม่มีกำหนดปิด' })
  @IsOptional()
  @IsDateString()
  closeAt?: string;
}

// ─── Public application (ข้อมูลชุดเดียว → Employee) ───────────────────────────

export class ApplicantEducationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(191) level?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(191) institution?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(191) major?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) year?: string;
}

export class ApplicantExperienceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(191) company?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(191) position?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) duration?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class ApplicantEmergencyContactDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(191) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) relationship?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) phone?: string;
}

export class ApplicationAttachmentDto {
  @ApiProperty({ enum: ['resume', 'photo', 'document'] })
  @IsIn(['resume', 'photo', 'document'])
  kind: 'resume' | 'photo' | 'document';

  @ApiProperty() @IsString() @MaxLength(1000) url: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) name?: string;
}

export class PublicApplicationDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(191) firstName: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(191) lastName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) nickname?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) phone?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) nationalId?: string;
  @ApiPropertyOptional({ description: 'วันเกิด (YYYY-MM-DD)' }) @IsOptional() @IsDateString() dateOfBirth?: string;
  @ApiPropertyOptional({ enum: ['male', 'female', 'other'] }) @IsOptional() @IsIn(['male', 'female', 'other']) gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) address?: string;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) expectedSalary?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(191) bankName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) bankAccount?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) taxId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) socialSecurity?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;

  @ApiPropertyOptional({ type: [ApplicantEducationDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ApplicantEducationDto)
  educations?: ApplicantEducationDto[];

  @ApiPropertyOptional({ type: [ApplicantExperienceDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ApplicantExperienceDto)
  workExperiences?: ApplicantExperienceDto[];

  @ApiPropertyOptional({ type: [ApplicantEmergencyContactDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ApplicantEmergencyContactDto)
  emergencyContacts?: ApplicantEmergencyContactDto[];

  @ApiPropertyOptional({ type: [ApplicationAttachmentDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ApplicationAttachmentDto)
  attachments?: ApplicationAttachmentDto[];

  @ApiProperty({ description: 'ยินยอม PDPA (ต้องเป็น true)' })
  @IsBoolean()
  consentGiven: boolean;
}
