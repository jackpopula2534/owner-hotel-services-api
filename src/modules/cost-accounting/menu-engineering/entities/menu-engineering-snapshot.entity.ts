import { Decimal } from '@prisma/client/runtime/library';
import { MenuEngineeringItemEntity } from './menu-engineering-item.entity';

export interface MenuEngineeringSnapshotEntity {
  id: string;
  tenantId: string;
  propertyId: string;
  restaurantId?: string;
  period: string; // YYYY-MM
  snapshotDate: Date;
  avgPopularity: Decimal;
  avgMargin: Decimal;
  totalItems: number;
  starsCount: number;
  plowhorsesCount: number;
  puzzlesCount: number;
  dogsCount: number;
  createdBy: string;
  createdAt: Date;
  items?: MenuEngineeringItemEntity[];
}
