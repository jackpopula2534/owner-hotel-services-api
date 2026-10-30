import { FixedAssetCategory } from '@prisma/client';

/** บัญชีราคาทุนสินทรัพย์ตามหมวด (ใช้เมื่อสินทรัพย์ไม่ได้ระบุ assetAccountId เอง) */
export const ASSET_COST_CODE: Record<FixedAssetCategory, string> = {
  LAND: '1201',
  BUILDING: '1202',
  BUILDING_IMPROVE: '1202',
  FURNITURE: '1204',
  LINEN_UNIFORM: '1204',
  OTHER: '1204',
  EQUIPMENT: '1206',
  IT_EQUIPMENT: '1206',
  KITCHEN_EQUIPMENT: '1206',
  VEHICLE: '1208',
};

/** ค่าเสื่อมราคาสะสมตามหมวดสินทรัพย์ (ใช้เมื่อสินทรัพย์ไม่ได้ระบุ accumDeprecAccountId เอง) */
export const ACCUM_DEPRECIATION_CODE: Record<FixedAssetCategory, string> = {
  LAND: '1205',
  BUILDING: '1203',
  BUILDING_IMPROVE: '1203',
  FURNITURE: '1205',
  LINEN_UNIFORM: '1205',
  OTHER: '1205',
  EQUIPMENT: '1207',
  IT_EQUIPMENT: '1207',
  KITCHEN_EQUIPMENT: '1207',
  VEHICLE: '1209',
};

/** กำไรจากการจำหน่ายสินทรัพย์ → รายได้อื่น, ขาดทุน → ค่าใช้จ่ายอื่น */
export const DISPOSAL_GAIN_CODE = '4309'; // 4300 เป็นหัวข้อ ลงตรงไม่ได้
export const DISPOSAL_LOSS_CODE = '6309';
