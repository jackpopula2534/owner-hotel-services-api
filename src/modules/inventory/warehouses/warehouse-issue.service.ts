import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * เขียนใบเบิก/ใบคืน + ยอดคงเหลือของคลังหนึ่งใบ — จุดเดียวที่ "ของออกจากคลัง" ถูกบันทึก
 *
 * แยกออกมาเพราะตอนนี้มีสองจังหวะที่ของออก: ตอนกดสั่ง (ของสำเร็จรูปหยิบออกจากตู้ทันที)
 * และตอนปิดบิล (วัตถุดิบตามสูตร) ถ้าต่างคนต่างเขียน ยอดคงเหลือกับสมุดเคลื่อนไหว
 * จะกระทบยอดกันไม่ได้เมื่อฝั่งใดฝั่งหนึ่งถูกแก้
 *
 * ไม่มี state ของตัวเอง และรับ `tx` มาเสมอ — ผู้เรียกเป็นคนคุมขอบเขตทรานแซกชัน
 */
@Injectable()
export class WarehouseIssueService {
  private readonly logger = new Logger(WarehouseIssueService.name);

  /**
   * ตัดของออกจากคลัง
   *
   * ตัด **เต็มจำนวนที่ขายจริง** ไม่ใช่ Math.min กับของที่มีอยู่ — ของออกจากตู้ไปแล้ว
   * ถ้าคลังไม่มีของรองรับ ยอดจะติดลบ นั่นคือสัญญาณว่ามีของเข้าที่ไม่ได้ลงบันทึก
   * การตัดแค่เท่าที่มีทำให้สมุดเคลื่อนไหวกับยอดคงเหลือกระทบยอดกันไม่ได้ตลอดไป
   *
   * @returns จำนวนที่ขายเกินสต๊อก (0 = ปกติ)
   */
  async issue(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      warehouseId: string;
      itemId: string;
      quantity: number;
      referenceType: string;
      referenceId: string;
      /** ข้อความให้คนอ่านสมุดเข้าใจว่าตัดเพราะอะไร — ส่วนต่อท้ายเรื่องขายเกินเติมให้เอง */
      notes: string;
      createdBy: string;
      label?: string;
    },
  ): Promise<number> {
    const { tenantId, warehouseId, itemId, quantity } = params;
    const stock = await tx.warehouseStock.findUnique({
      where: { warehouseId_itemId: { warehouseId, itemId } },
      select: { quantity: true, avgCost: true },
    });

    const currentQty = stock?.quantity ?? 0;
    const avgCost = stock ? Number(stock.avgCost) : 0;
    const newQty = currentQty - quantity;
    const shortfallQty = newQty < 0 ? -newQty : 0;

    await tx.stockMovement.create({
      data: {
        tenantId,
        warehouseId,
        itemId,
        type: 'GOODS_ISSUE',
        quantity,
        shortfallQty,
        unitCost: avgCost,
        totalCost: quantity * avgCost,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        notes:
          params.notes +
          (shortfallQty > 0 ? ` — ขายเกินสต๊อก ${shortfallQty} หน่วย ต้องตรวจนับ` : ''),
        createdBy: params.createdBy,
      },
    });

    // upsert เพราะของที่ยังไม่เคยมีแถวในคลังนี้ก็ถูกขายไปแล้วได้ ต้องเหลือร่องรอยว่าติดลบ
    await tx.warehouseStock.upsert({
      where: { warehouseId_itemId: { warehouseId, itemId } },
      create: { warehouseId, itemId, quantity: newQty, avgCost, totalValue: newQty * avgCost },
      update: { quantity: newQty, totalValue: newQty * avgCost },
    });

    if (shortfallQty > 0) {
      this.logger.warn(
        `Oversold "${params.label ?? itemId}" by ${shortfallQty} in warehouse ${warehouseId} on ${params.referenceType} ${params.referenceId} (tenant ${tenantId})`,
      );
    }
    return shortfallQty;
  }

  /**
   * คืนของกลับเข้าคลัง — ใช้ตอนยกเลิกรายการที่หักไปแล้ว
   *
   * เขียนเป็นรายการ ADJUSTMENT_IN ใบใหม่ ไม่ลบใบเบิกเดิมทิ้ง เพราะของเคยออกจากคลังจริง
   * สมุดต้องเล่าได้ว่าออกไปแล้วกลับมา ไม่ใช่เหมือนไม่เคยเกิดขึ้น
   */
  async returnToStock(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      warehouseId: string;
      itemId: string;
      quantity: number;
      referenceType: string;
      referenceId: string;
      notes: string;
      createdBy: string;
    },
  ): Promise<void> {
    const { tenantId, warehouseId, itemId, quantity } = params;
    const stock = await tx.warehouseStock.findUnique({
      where: { warehouseId_itemId: { warehouseId, itemId } },
      select: { quantity: true, avgCost: true },
    });

    const currentQty = stock?.quantity ?? 0;
    const avgCost = stock ? Number(stock.avgCost) : 0;
    const newQty = currentQty + quantity;

    await tx.stockMovement.create({
      data: {
        tenantId,
        warehouseId,
        itemId,
        type: 'ADJUSTMENT_IN',
        quantity,
        unitCost: avgCost,
        totalCost: quantity * avgCost,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        notes: params.notes,
        createdBy: params.createdBy,
      },
    });

    await tx.warehouseStock.upsert({
      where: { warehouseId_itemId: { warehouseId, itemId } },
      create: { warehouseId, itemId, quantity: newQty, avgCost, totalValue: newQty * avgCost },
      update: { quantity: newQty, totalValue: newQty * avgCost },
    });
  }
}
