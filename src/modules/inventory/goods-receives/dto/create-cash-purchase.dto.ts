import {
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsUUID,
  Min,
  Max,
  MaxLength,
  Matches,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CashPaymentMethod, GoodsReceiveAttachmentKind } from '@prisma/client';

/** โฟลเดอร์ปลายทางของสลิปซื้อสด — ใช้ร่วมกันระหว่าง controller (ตอนอัพ) และ service (ตอนตรวจ key) */
export const CASH_PURCHASE_SLIP_FOLDER = 'cash-purchase-slips';

/** แนบได้สูงสุดกี่ไฟล์ต่อการซื้อหนึ่งครั้ง — ไปตลาดหลายแผงก็หลายสลิป แต่ไม่ใช่อัลบั้มรูป */
export const CASH_PURCHASE_SLIP_MAX_FILES = 5;

/** ขนาดไฟล์สูงสุดต่อไฟล์ (ไบต์) — รูปจากมือถือรุ่นใหม่ใบเดียวก็แตะ 8 MB ได้ */
export const CASH_PURCHASE_SLIP_MAX_BYTES = 10 * 1024 * 1024;

export class CashPurchaseItemDto {
  @ApiProperty({ description: 'Inventory item ID' })
  @IsUUID()
  itemId: string;

  @ApiProperty({
    example: 1500,
    description:
      'Quantity in the item’s own stock unit — whole numbers only, because warehouse stock is ' +
      'integer. Buying 1.5 kg of an item stocked in grams means sending 1500, not 1.5.',
  })
  @IsNumber()
  @Min(1)
  receivedQty: number;

  @ApiProperty({
    example: 0.45,
    description: 'What was actually paid per stock unit — the real price, not an estimate.',
  })
  @IsNumber()
  @Min(0)
  unitCost: number;

  @ApiPropertyOptional({ example: '2026-08-14', description: 'Expiry date (ISO 8601)' })
  @IsOptional()
  @IsString()
  expiryDate?: string;

  @ApiPropertyOptional({ description: 'Free-text note for this line' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/**
 * สลิปหนึ่งใบที่อัพโหลดไว้แล้ว รอผูกกับใบรับของ
 *
 * รับแค่ `storageKey` ที่ POST /cash-purchase/slips คืนมา ไม่รับ URL — ถ้ารับ URL
 * ตรง ๆ ใครก็ยิงลิงก์ภายนอกมาแปะเป็น "หลักฐานการจ่ายเงิน" ได้ แล้วหน้ารายละเอียด
 * จะ render ให้ตามนั้น service เป็นคนประกอบ URL จาก key เอง
 */
export class CashPurchaseSlipDto {
  @ApiProperty({
    example: 'cash-purchase-slips/<tenantId>/slip-1754812345678-123456789.jpg',
    description:
      'Key returned by POST /inventory/goods-receives/cash-purchase/slips. Must sit inside the ' +
      'caller’s own tenant folder — a key from another tenant is rejected.',
  })
  @IsString()
  @MaxLength(500)
  // ปิดทาง path traversal และ key ข้าม folder ตั้งแต่ชั้น validation
  // (service ตรวจซ้ำอีกชั้นว่า tenantId ในนั้นตรงกับคนเรียกจริง)
  @Matches(/^cash-purchase-slips\/[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/, {
    message: 'storageKey ไม่ถูกต้อง — ต้องเป็น key ที่ได้จาก endpoint อัพโหลดสลิปเท่านั้น',
  })
  storageKey: string;

  @ApiPropertyOptional({ example: 'IMG_2043.jpg', description: 'Original filename, for display' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  originalName?: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @MaxLength(100)
  mimeType: string;

  @ApiProperty({ example: 348122, description: 'File size in bytes' })
  @IsNumber()
  @Min(1)
  @Max(CASH_PURCHASE_SLIP_MAX_BYTES)
  sizeBytes: number;

  @ApiPropertyOptional({
    enum: GoodsReceiveAttachmentKind,
    default: GoodsReceiveAttachmentKind.SLIP,
    description:
      'PHOTO when the stall gave no receipt and the evidence is a picture of the goods instead.',
  })
  @IsOptional()
  @IsEnum(GoodsReceiveAttachmentKind)
  kind?: GoodsReceiveAttachmentKind;
}

/**
 * A purchase that already happened.
 *
 * Everything else in procurement describes an intention — a requisition asks,
 * an RFQ invites, a PO commits. This one is a report: the money is gone and the
 * goods are in the van. That inverts the usual validation question. There is no
 * approving it after the fact, so what the DTO insists on instead is the record
 * being *answerable later*: who went, who paid, out of whose pocket, and from
 * which shop — the things nobody can reconstruct a week after the fact.
 */
export class CreateCashPurchaseDto {
  @ApiProperty({ description: 'Warehouse the goods are being put into' })
  @IsUUID()
  warehouseId: string;

  @ApiPropertyOptional({
    description:
      'Supplier record, when the shop is a real one already in the system. Market stalls will ' +
      'not have one — send vendorName instead.',
  })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({
    example: 'ตลาดสดบางกะปิ',
    description:
      'Where it was bought, in plain words. Required when there is no supplierId, because a ' +
      'receipt that cannot say where the goods came from is not a record of anything.',
  })
  @ValidateIf((dto: CreateCashPurchaseDto) => !dto.supplierId)
  @IsString()
  @MaxLength(255)
  vendorName?: string;

  @ApiProperty({ enum: CashPaymentMethod, description: 'Where the money came from' })
  @IsEnum(CashPaymentMethod)
  paymentMethod: CashPaymentMethod;

  @ApiPropertyOptional({
    description:
      'User who fronted the money. Defaults to the person recording the purchase — which is ' +
      'wrong whenever the housekeeper went to the market and someone else typed it in, so the ' +
      'UI should always ask rather than let the default stand.',
  })
  @IsOptional()
  @IsUUID()
  paidBy?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Market stalls rarely give receipts. Ticking this is the audit trail’s answer to “where is the slip?”',
  })
  @IsOptional()
  @IsBoolean()
  hasNoReceipt?: boolean;

  @ApiPropertyOptional({ description: 'Receipt / slip number when there is one' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  invoiceNumber?: string;

  @ApiPropertyOptional({ description: 'Date on the receipt (ISO 8601). Defaults to now.' })
  @IsOptional()
  @IsString()
  purchaseDate?: string;

  @ApiPropertyOptional({
    description: 'Purchase requisition this trip was made against, if any',
  })
  @IsOptional()
  @IsUUID()
  purchaseRequisitionId?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Close that requisition once the goods land. Deliberately explicit rather than inferred ' +
      'from coverage: a trip that only got half the list should leave procurement still chasing ' +
      'the rest, and only the person who went knows which case this is.',
  })
  @IsOptional()
  @IsBoolean()
  closePurchaseRequisition?: boolean;

  @ApiPropertyOptional({ description: 'Notes for the whole trip' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    type: [CashPurchaseSlipDto],
    description:
      'Slips/photos already uploaded via POST /cash-purchase/slips. Attached to the receipt in ' +
      'the same transaction, so a receipt never claims evidence that failed to save.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CASH_PURCHASE_SLIP_MAX_FILES)
  @ValidateNested({ each: true })
  @Type(() => CashPurchaseSlipDto)
  slips?: CashPurchaseSlipDto[];

  @ApiProperty({ type: [CashPurchaseItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CashPurchaseItemDto)
  items: CashPurchaseItemDto[];
}
