import { Decimal } from '@prisma/client/runtime/library';

export interface MenuEngineeringItemEntity {
  id: string;
  snapshotId: string;
  menuItemId: string;
  menuItemName: string;
  categoryName?: string;
  quantitySold: number;
  sellingPrice: Decimal;
  ingredientCost: Decimal;
  contributionMargin: Decimal;
  marginPercent: Decimal;
  totalRevenue: Decimal;
  totalCost: Decimal;
  totalProfit: Decimal;
  popularityIndex: Decimal;
  classification: string; // STAR | PLOWHORSE | PUZZLE | DOG
  recommendation?: string;
  createdAt: Date;
}
