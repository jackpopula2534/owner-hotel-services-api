// ข้อมูลตัวอย่างของลานทดสอบแพ็กใหญ่สุด (Pine Valley Camp) — ใช้โดย camp-premium.seeder.ts

export const CAMP_NAME = 'Pine Valley Camp';
export const CAMP_PHONE = '044-123-456';
export const CAMP_EMAIL = 'info.pinevalley@camp.test';
export const CAMP_ADDRESS = '88 หมู่ 5 ต.หมูสี อ.ปากช่อง จ.นครราชสีมา 30130';
export const SITE_SLUG = 'pine-valley';

/** รูปแปลนลาน — ไฟล์อยู่ใน public ของ frontend (owner-hotel-services/public/assets/camp) */
export const MAP_IMAGE_URL = '/assets/camp/pine-valley-map.jpg';
export const MAP_WIDTH = 1536;
export const MAP_HEIGHT = 1024;

/** กรอบแผนผัง (CampMap2D) เป็น 16:10 + object-cover → รูป 3:2 ถูกตัดบน/ล่างเท่ากัน */
const MAP_FRAME_RATIO = 16 / 10;

/** แปลงพิกเซลบนรูปแปลน → พิกัด normalized (0..1) ของกรอบแผนผัง ให้หมุดตรงกับแปลงในรูป */
export function mapPos(x: number, y: number): { posX: number; posY: number } {
  const visibleH = MAP_WIDTH / MAP_FRAME_RATIO;
  const cropTop = (MAP_HEIGHT - visibleH) / 2;
  const round = (n: number): number => Math.round(n * 10000) / 10000;
  return { posX: round(x / MAP_WIDTH), posY: round((y - cropTop) / visibleH) };
}

export interface ZoneSeed {
  code: string;
  name: string;
  type: string;
  description: string;
  basePrice: number;
  weekendPrice: number | null;
  pricingMode: 'per_night' | 'per_person';
  maxGuests: number;
  maxTents: number;
  allowVehicle: boolean;
  allowPet: boolean;
  hasElectricity: boolean;
  electricityFee: number | null;
  allowAircon: boolean;
  maxWatt: number | null;
  restrictions: string[];
  color: string;
  /** ตำแหน่งจุดกางบนรูปแปลน (พิกเซลของรูป 1536×1024) เรียงตามรหัส 1..n */
  pitches: Array<[number, number]>;
}

export const ZONES: ZoneSeed[] = [
  {
    code: 'A',
    name: 'โซน A ริมทะเลสาบ',
    type: 'mountain_view',
    description: 'ลานหญ้าบนเนิน เห็นทะเลหมอกตอนเช้า ใกล้ห้องน้ำ',
    basePrice: 450,
    weekendPrice: 550,
    pricingMode: 'per_night',
    maxGuests: 4,
    maxTents: 2,
    allowVehicle: true,
    allowPet: true,
    hasElectricity: true,
    electricityFee: 100,
    allowAircon: false,
    maxWatt: 1000,
    restrictions: ['งดส่งเสียงดังหลัง 22:00', 'ก่อไฟในเตาที่ลานจัดให้เท่านั้น'],
    color: '#16a34a',
    pitches: [
      [468, 345],
      [557, 368],
      [640, 377],
      [718, 378],
      [798, 378],
      [878, 378],
      [958, 380],
      [1043, 383],
      [1128, 378],
    ],
  },
  {
    code: 'B',
    name: 'โซน B ริมลำธาร',
    type: 'riverside',
    description: 'ติดลำธาร ร่มรื่น เสียงน้ำไหลทั้งคืน',
    basePrice: 500,
    weekendPrice: 650,
    pricingMode: 'per_night',
    maxGuests: 4,
    maxTents: 2,
    allowVehicle: false,
    allowPet: false,
    hasElectricity: false,
    electricityFee: null,
    allowAircon: false,
    maxWatt: null,
    restrictions: ['ห้ามนำรถเข้าโซน', 'ห้ามสัตว์เลี้ยง', 'ห้ามทิ้งขยะลงลำธาร'],
    color: '#0284c7',
    pitches: [
      [405, 487],
      [474, 496],
      [550, 501],
      [629, 503],
      [710, 505],
      [790, 507],
      [870, 510],
    ],
  },
  {
    code: 'C',
    name: 'โซน C รถบ้าน (RV)',
    type: 'rv',
    description: 'ลานพื้นแข็งสำหรับรถบ้าน/คาราวาน มีปลั๊ก 16A และจุดเติมน้ำ',
    basePrice: 800,
    weekendPrice: 950,
    pricingMode: 'per_night',
    maxGuests: 6,
    maxTents: 1,
    allowVehicle: true,
    allowPet: true,
    hasElectricity: true,
    electricityFee: 150,
    allowAircon: true,
    maxWatt: 3000,
    restrictions: ['ทิ้งน้ำเสียที่จุด dump station เท่านั้น'],
    color: '#ea580c',
    pitches: [
      [459, 642],
      [540, 642],
      [618, 644],
      [696, 646],
      [775, 648],
      [853, 652],
    ],
  },
  {
    code: 'D',
    name: 'โซน D แกลมปิ้ง',
    type: 'glamping',
    description: 'เต็นท์กระโจมพร้อมที่นอน ผ้าห่ม ไฟส่องสว่าง แค่ตัวมาก็พัก',
    basePrice: 1800,
    weekendPrice: 2200,
    pricingMode: 'per_night',
    maxGuests: 3,
    maxTents: 1,
    allowVehicle: false,
    allowPet: false,
    hasElectricity: true,
    electricityFee: 0,
    allowAircon: true,
    maxWatt: 1500,
    restrictions: ['ห้ามสูบบุหรี่ในเต็นท์', 'ห้ามสัตว์เลี้ยง'],
    color: '#a855f7',
    pitches: [
      [1222, 484],
      [1250, 552],
      [1250, 623],
    ],
  },
  {
    code: 'E',
    name: 'โซน E ลานกว้าง (ต่อคน)',
    type: 'lawn',
    description: 'ลานกว้างสำหรับกลุ่มใหญ่/ทริปบริษัท คิดราคาต่อคน',
    basePrice: 150,
    weekendPrice: 200,
    pricingMode: 'per_person',
    maxGuests: 10,
    maxTents: 4,
    allowVehicle: true,
    allowPet: true,
    hasElectricity: false,
    electricityFee: null,
    allowAircon: false,
    maxWatt: null,
    restrictions: ['กลุ่มเกิน 10 คนกรุณาแจ้งล่วงหน้า'],
    color: '#ca8a04',
    pitches: [
      [493, 800],
      [594, 803],
      [695, 808],
      [795, 808],
      [900, 808],
    ],
  },
];

/** ตำแหน่งบนรูปแปลน (พิกเซลของรูป) — วางบนอาคาร/ลานจอดรถ/ทางเดินที่เห็นในรูป */
export const FACILITIES = [
  { name: 'จุดต้อนรับ/เช็คอิน', type: 'service', x: 1013, y: 580, open24h: true },
  {
    name: 'ร้านค้าสวัสดิการ (น้ำแข็ง/ของใช้)',
    type: 'shop',
    x: 1098,
    y: 566,
    openingTime: '07:00',
    closingTime: '21:00',
  },
  { name: 'ห้องน้ำ-ห้องอาบน้ำ โซน A/D', type: 'restroom', x: 1200, y: 420, open24h: true },
  { name: 'ห้องน้ำ-ห้องอาบน้ำ โซน B/C/E', type: 'restroom', x: 380, y: 760, open24h: true },
  { name: 'ตู้จ่ายไฟกลาง (โซน RV)', type: 'electricity', x: 910, y: 610, open24h: true },
  {
    name: 'ลานกองไฟส่วนกลาง',
    type: 'other',
    x: 1003,
    y: 478,
    openingTime: '18:00',
    closingTime: '23:00',
  },
  { name: 'ลานจอดรถหน้าสำนักงาน', type: 'other', x: 1040, y: 640, open24h: true },
  {
    name: 'ลานจอดรถใหญ่ + Dump station รถบ้าน',
    type: 'other',
    x: 1200,
    y: 850,
    openingTime: '08:00',
    closingTime: '18:00',
  },
] as const;

export const EQUIPMENT = [
  {
    key: 'tent2',
    name: 'เต็นท์ 2 คน',
    category: 'tent',
    price: 250,
    unit: 'หลัง',
    deposit: 500,
    stock: 15,
    description: 'เต็นท์โดม 2 ชั้น กันฝน กางเสร็จใน 10 นาที',
  },
  {
    key: 'tent4',
    name: 'เต็นท์ครอบครัว 4 คน',
    category: 'tent',
    price: 400,
    unit: 'หลัง',
    deposit: 1000,
    stock: 8,
    description: 'มีห้องนอน + มุขหน้า',
  },
  {
    key: 'bag',
    name: 'ถุงนอน',
    category: 'sleeping',
    price: 80,
    unit: 'ชิ้น',
    deposit: 200,
    stock: 40,
    description: 'อุณหภูมิสบาย 10°C',
  },
  {
    key: 'mat',
    name: 'แผ่นรองนอนพองลม',
    category: 'sleeping',
    price: 60,
    unit: 'ชิ้น',
    deposit: 0,
    stock: 40,
    description: null,
  },
  {
    key: 'stove',
    name: 'ชุดเตาแก๊สปิกนิก + หม้อ',
    category: 'cooking',
    price: 150,
    unit: 'ชุด',
    deposit: 300,
    stock: 12,
    description: 'แก๊สกระป๋อง 1 กระป๋อง',
  },
  {
    key: 'wood',
    name: 'ฟืน',
    category: 'firewood',
    price: 100,
    unit: 'มัด',
    deposit: 0,
    stock: 100,
    description: 'มัดละประมาณ 5 กก.',
  },
  {
    key: 'lantern',
    name: 'ตะเกียง LED',
    category: 'gear',
    price: 50,
    unit: 'อัน',
    deposit: 100,
    stock: 30,
    description: null,
  },
  {
    key: 'cord',
    name: 'ปลั๊กพ่วง 10 ม.',
    category: 'electric',
    price: 50,
    unit: 'เส้น',
    deposit: 200,
    stock: 20,
    description: 'ใช้ในโซนที่มีไฟเท่านั้น',
  },
  {
    key: 'chair',
    name: 'เก้าอี้สนามพับได้',
    category: 'gear',
    price: 40,
    unit: 'ตัว',
    deposit: 0,
    stock: 0,
    description: 'สินค้าหมด — ใช้ทดสอบกรณีสต็อกเป็นศูนย์',
  },
] as const;

export type EquipmentKey = (typeof EQUIPMENT)[number]['key'];

export interface ReservationSeed {
  pitch: string;
  first: string;
  last: string;
  phone: string;
  email: string | null;
  /** วันเข้าเทียบกับวันนี้ */
  inOffset: number;
  nights: number;
  guests: number;
  tents: number;
  vehicles: number;
  pet: boolean;
  status: 'pending' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show';
  /** สัดส่วนที่จ่ายแล้ว 0..1 */
  paid: number;
  method: 'cash' | 'promptpay' | 'transfer';
  source: 'STAFF' | 'WEBSITE';
  gear: Array<[EquipmentKey, number]>;
  notes?: string;
}

export const RESERVATIONS: ReservationSeed[] = [
  {
    pitch: 'A1',
    first: 'สมชาย',
    last: 'ใจดี',
    phone: '0811111111',
    email: 'somchai@example.test',
    inOffset: -14,
    nights: 2,
    guests: 4,
    tents: 2,
    vehicles: 1,
    pet: false,
    status: 'checked_out',
    paid: 1,
    method: 'cash',
    source: 'STAFF',
    gear: [['wood', 2]],
  },
  {
    pitch: 'B2',
    first: 'Anna',
    last: 'Schmidt',
    phone: '0822222222',
    email: 'anna@example.test',
    inOffset: -10,
    nights: 3,
    guests: 2,
    tents: 1,
    vehicles: 0,
    pet: false,
    status: 'checked_out',
    paid: 1,
    method: 'promptpay',
    source: 'WEBSITE',
    gear: [
      ['tent2', 1],
      ['bag', 2],
      ['mat', 2],
    ],
  },
  {
    pitch: 'D1',
    first: 'วิภา',
    last: 'ศรีสุข',
    phone: '0833333333',
    email: 'wipa@example.test',
    inOffset: -7,
    nights: 1,
    guests: 2,
    tents: 1,
    vehicles: 1,
    pet: false,
    status: 'checked_out',
    paid: 1,
    method: 'transfer',
    source: 'STAFF',
    gear: [],
  },
  {
    pitch: 'E1',
    first: 'บริษัท',
    last: 'ทีมบิลดิ้ง จำกัด',
    phone: '0844444444',
    email: 'hr@teambuild.test',
    inOffset: -5,
    nights: 1,
    guests: 10,
    tents: 4,
    vehicles: 3,
    pet: false,
    status: 'checked_out',
    paid: 1,
    method: 'transfer',
    source: 'STAFF',
    gear: [
      ['tent4', 2],
      ['stove', 2],
      ['wood', 4],
    ],
    notes: 'ทริปบริษัท ออกใบกำกับภาษี',
  },
  {
    pitch: 'A3',
    first: 'ธนา',
    last: 'ภูผา',
    phone: '0855555555',
    email: null,
    inOffset: -3,
    nights: 1,
    guests: 3,
    tents: 1,
    vehicles: 1,
    pet: true,
    status: 'no_show',
    paid: 0,
    method: 'cash',
    source: 'STAFF',
    gear: [],
  },
  {
    pitch: 'A2',
    first: 'ปิยะ',
    last: 'ทองคำ',
    phone: '0866666666',
    email: 'piya@example.test',
    inOffset: -1,
    nights: 3,
    guests: 4,
    tents: 2,
    vehicles: 1,
    pet: true,
    status: 'checked_in',
    paid: 1,
    method: 'cash',
    source: 'STAFF',
    gear: [
      ['lantern', 2],
      ['wood', 3],
    ],
  },
  {
    pitch: 'C1',
    first: 'Mark',
    last: 'Wilson',
    phone: '0877777777',
    email: 'mark@example.test',
    inOffset: 0,
    nights: 2,
    guests: 4,
    tents: 1,
    vehicles: 1,
    pet: false,
    status: 'checked_in',
    paid: 0.5,
    method: 'promptpay',
    source: 'WEBSITE',
    gear: [['cord', 1]],
  },
  {
    pitch: 'D2',
    first: 'นภา',
    last: 'แสงจันทร์',
    phone: '0888888888',
    email: 'napa@example.test',
    inOffset: 0,
    nights: 1,
    guests: 2,
    tents: 1,
    vehicles: 1,
    pet: false,
    status: 'confirmed',
    paid: 1,
    method: 'promptpay',
    source: 'WEBSITE',
    gear: [],
    notes: 'มาถึงประมาณ 15:00',
  },
  {
    pitch: 'B1',
    first: 'กิตติ',
    last: 'รักป่า',
    phone: '0899999999',
    email: 'kitti@example.test',
    inOffset: 2,
    nights: 2,
    guests: 3,
    tents: 1,
    vehicles: 0,
    pet: false,
    status: 'confirmed',
    paid: 0.3,
    method: 'transfer',
    source: 'STAFF',
    gear: [
      ['tent4', 1],
      ['bag', 3],
    ],
  },
  {
    pitch: 'A5',
    first: 'มาลี',
    last: 'ดอกไม้',
    phone: '0812340001',
    email: 'malee@example.test',
    inOffset: 5,
    nights: 2,
    guests: 2,
    tents: 1,
    vehicles: 1,
    pet: false,
    status: 'pending',
    paid: 0,
    method: 'promptpay',
    source: 'WEBSITE',
    gear: [
      ['stove', 1],
      ['wood', 1],
    ],
    notes: 'แนบสลิปแล้ว รอตรวจยอด',
  },
  {
    pitch: 'E2',
    first: 'ชมรม',
    last: 'เดินป่าอีสาน',
    phone: '0812340002',
    email: null,
    inOffset: 9,
    nights: 2,
    guests: 8,
    tents: 4,
    vehicles: 2,
    pet: false,
    status: 'pending',
    paid: 0,
    method: 'cash',
    source: 'STAFF',
    gear: [],
  },
  {
    pitch: 'C2',
    first: 'Liam',
    last: 'Tan',
    phone: '0812340003',
    email: 'liam@example.test',
    inOffset: 12,
    nights: 3,
    guests: 5,
    tents: 1,
    vehicles: 1,
    pet: true,
    status: 'confirmed',
    paid: 1,
    method: 'promptpay',
    source: 'WEBSITE',
    gear: [],
  },
  {
    pitch: 'B4',
    first: 'สุดา',
    last: 'ยกเลิก',
    phone: '0812340004',
    email: 'suda@example.test',
    inOffset: 4,
    nights: 1,
    guests: 2,
    tents: 1,
    vehicles: 0,
    pet: false,
    status: 'cancelled',
    paid: 0,
    method: 'cash',
    source: 'WEBSITE',
    gear: [],
    notes: 'ลูกค้ายกเลิกเพราะติดธุระ',
  },
];
