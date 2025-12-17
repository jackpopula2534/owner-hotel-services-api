import {
  IsString,
  IsInt,
  IsOptional,
  IsEmail,
  IsPhoneNumber,
  Min,
  Max,
  MaxLength,
  IsEnum,
} from 'class-validator';

/**
 * Billing Cycle - รอบการชำระเงิน
 */
export enum BillingCycle {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

/**
 * DTO สำหรับสร้างโรงแรมใหม่ (เพิ่มโรงแรมใหม่)
 * ใช้ในหน้า Admin Panel เมื่อกดปุ่ม "+ เพิ่มโรงแรมใหม่"
 */
export class CreateHotelDto {
  // === ข้อมูลพื้นฐาน ===

  /**
   * ชื่อโรงแรม
   * @example "โรงแรมตัวอย่าง 1"
   */
  @IsString()
  @MaxLength(255)
  name: string;

  /**
   * จำนวนห้องพัก
   * @example 50
   */
  @IsInt()
  @Min(1)
  @Max(9999)
  roomCount: number;

  // === ข้อมูลลูกค้า/บริษัท ===

  /**
   * ชื่อลูกค้าหรือบริษัท
   * @example "บริษัท ABC จำกัด"
   */
  @IsString()
  @MaxLength(255)
  customerName: string;

  /**
   * เลขประจำตัวผู้เสียภาษี (ถ้ามี)
   * @example "0123456789012"
   */
  @IsString()
  @IsOptional()
  @MaxLength(13)
  taxId?: string;

  // === ข้อมูลติดต่อ ===

  /**
   * อีเมลติดต่อ
   * @example "contact@example-hotel.com"
   */
  @IsEmail()
  @IsOptional()
  email?: string;

  /**
   * เบอร์โทรศัพท์
   * @example "0812345678"
   */
  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  // === ที่อยู่ ===

  /**
   * ที่อยู่
   * @example "123 ถนนสุขุมวิท"
   */
  @IsString()
  @IsOptional()
  @MaxLength(500)
  address?: string;

  /**
   * เขต/อำเภอ
   * @example "วัฒนา"
   */
  @IsString()
  @IsOptional()
  @MaxLength(100)
  district?: string;

  /**
   * จังหวัด
   * @example "กรุงเทพมหานคร"
   */
  @IsString()
  @IsOptional()
  @MaxLength(100)
  province?: string;

  /**
   * รหัสไปรษณีย์
   * @example "10110"
   */
  @IsString()
  @IsOptional()
  @MaxLength(10)
  postalCode?: string;

  // === แพ็คเกจและการชำระเงิน ===

  /**
   * รหัสแพ็คเกจที่เลือก (S, M, L)
   * @example "M"
   */
  @IsString()
  planCode: string;

  /**
   * รอบการชำระเงิน
   * @example "monthly"
   */
  @IsEnum(BillingCycle)
  @IsOptional()
  billingCycle?: BillingCycle = BillingCycle.MONTHLY;

  // === หมายเหตุ ===

  /**
   * หมายเหตุเพิ่มเติม
   */
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;
}

/**
 * Response สำหรับการสร้างโรงแรมสำเร็จ
 */
export class CreateHotelResponseDto {
  success: boolean;
  message: string;
  messageTh: string;
  data: {
    hotel: {
      id: string;
      name: string;
      roomCount: number;
      status: string;
      statusTh: string;
    };
    subscription: {
      id: string;
      planCode: string;
      planName: string;
      status: string;
      startDate: string;
      endDate: string;
    };
    trial: {
      isInTrial: boolean;
      trialEndsAt: string;
      daysRemaining: number;
    };
  };
}
