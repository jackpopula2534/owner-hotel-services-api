/**
 * ฉาก 3D ของโรงแรม — เก็บใน Property.map3dConfig (JSON)
 *
 * ระยะเป็นเมตร จุดกำเนิดอยู่กลางที่ดิน (x ไปทางขวา, z ไปทางผู้ชม)
 * ห้องพักไม่ได้เก็บตำแหน่งในตาราง rooms — จับคู่ผ่าน `slots`
 * คีย์ช่อง = `${buildingId}:${floor}:${side}:${index}`  ค่า = roomId
 *   floor เริ่ม 1 (ชั้นล่าง) · side 0 = ด้านหน้า, 1 = ด้านหลัง · index เริ่ม 0 จากซ้าย
 */
export const HOTEL_BUILDING_PRESETS = ['bar', 'tower', 'villas'] as const;
export type HotelBuildingPreset = (typeof HOTEL_BUILDING_PRESETS)[number];

export const HOTEL_PROP_TYPES = ['pool', 'restaurant', 'parking', 'garden', 'tree', 'gate'] as const;
export type HotelPropType = (typeof HOTEL_PROP_TYPES)[number];

export interface HotelBuilding {
  id: string;
  name: string;
  preset: HotelBuildingPreset;
  x: number;
  z: number;
  /** องศา 0..359 */
  rot: number;
  /** จำนวนชั้นทั้งหมด (วิลล่า = 1) */
  floors: number;
  /** ห้องต่อแถวต่อชั้น (วิลล่า = จำนวนหลัง) */
  per: number;
  /** 2 = ทางเดินกลาง ห้องสองฝั่ง · 1 = ทางเดินข้างเดียว */
  sides: 1 | 2;
  /** ชั้น 1 เป็นล็อบบี้/ส่วนกลาง (ไม่มีช่องห้อง) */
  lobby: boolean;
  wall: string;
  roof: 'flat' | 'gable';
}

export interface HotelProp {
  id: string;
  t: HotelPropType;
  x: number;
  z: number;
  rot: number;
}

export interface HotelMap3dConfig {
  version: 1;
  site: { widthM: number; depthM: number };
  buildings: HotelBuilding[];
  slots: Record<string, string>;
  props: HotelProp[];
}
