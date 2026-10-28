import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsStrictBoolean } from '../../../common/decorators/strict-boolean.decorator';
import { PaymentMethodEnum } from '../order/dto/process-payment.dto';

export enum RestaurantTypeEnum {
  FINE_DINING = 'FINE_DINING',
  CASUAL = 'CASUAL',
  BUFFET = 'BUFFET',
  BAR = 'BAR',
  CAFE = 'CAFE',
  POOL_BAR = 'POOL_BAR',
  ROOM_SERVICE = 'ROOM_SERVICE',
}

export class CreateRestaurantDto {
  @ApiProperty({ example: 'Main Restaurant' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: '358ac78f-7f4e-4a01-bfbf-65c69d7dfe03' })
  @IsString()
  @IsOptional()
  propertyId?: string;

  @ApiPropertyOptional({
    description:
      'คลังต้นทางของสินค้าสำเร็จรูปที่ขายที่ร้านนี้ — น้ำขวดที่บาร์ไม่ได้มาจากคลังครัว ' +
      'ไม่ระบุ = ใช้คลังครัวของ property นั้นตามเดิม',
  })
  // null = ล้างค่ากลับไปใช้คลังครัวตามเดิม จึงต้องข้าม IsString ตอนเป็น null
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @IsOptional()
  warehouseId?: string | null;

  @ApiPropertyOptional({ example: 'REST001' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ enum: RestaurantTypeEnum, example: RestaurantTypeEnum.CASUAL })
  @IsEnum(RestaurantTypeEnum)
  @IsOptional()
  type?: RestaurantTypeEnum;

  @ApiPropertyOptional({ example: 'Fine dining restaurant on the rooftop' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'Ground Floor, Building A' })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({ example: 80 })
  @IsInt()
  @IsOptional()
  capacity?: number;

  @ApiPropertyOptional({ example: '07:00' })
  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'openTime must be HH:mm format' })
  openTime?: string;

  @ApiPropertyOptional({ example: '22:00' })
  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'closeTime must be HH:mm format' })
  closeTime?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Charge VAT on bills from this outlet. Off for a non-VAT-registered outlet.',
    example: true,
  })
  @IsStrictBoolean()
  @IsOptional()
  vatEnabled?: boolean;

  @ApiPropertyOptional({ description: 'VAT percentage', example: 7 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  vatRate?: number;

  @ApiPropertyOptional({
    description: 'Add a service charge to bills from this outlet',
    example: true,
  })
  @IsStrictBoolean()
  @IsOptional()
  serviceChargeEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Service charge percentage', example: 10 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  serviceRate?: number;

  @ApiPropertyOptional({
    description: 'ช่องทางชำระเงินที่ร้านนี้รับ — null = รับทุกช่องทาง',
    enum: PaymentMethodEnum,
    isArray: true,
    example: ['CASH', 'QR_PAYMENT', 'ROOM_CHARGE'],
  })
  @ValidateIf((_, value) => value !== null)
  @IsArray()
  @ArrayNotEmpty({ message: 'ต้องเปิดรับอย่างน้อย 1 ช่องทาง' })
  @ArrayUnique()
  @IsEnum(PaymentMethodEnum, { each: true })
  @IsOptional()
  acceptedPaymentMethods?: PaymentMethodEnum[] | null;

  @ApiPropertyOptional({ enum: PaymentMethodEnum, description: 'ช่องทางที่ POS เลือกไว้ให้ก่อน' })
  @ValidateIf((_, value) => value !== null)
  @IsEnum(PaymentMethodEnum)
  @IsOptional()
  defaultPaymentMethod?: PaymentMethodEnum | null;

  @ApiPropertyOptional({
    description: 'บัญชี QR ของร้าน (kind promptpay / qr_image) — null = ใช้บัญชีหลักของโรงแรม',
  })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @IsOptional()
  qrPaymentAccountId?: string | null;

  @ApiPropertyOptional({
    description: 'บัญชีธนาคารรับโอนของร้าน (kind bank) — null = ใช้บัญชีหลักของโรงแรม',
  })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @IsOptional()
  transferPaymentAccountId?: string | null;

  @ApiPropertyOptional({
    description: 'Floor plan layout data (positions, zones, grid size)',
    example: { width: 800, height: 600, gridSize: 20, zones: [] },
  })
  @IsObject()
  @IsOptional()
  layoutData?: Record<string, unknown>;
}
