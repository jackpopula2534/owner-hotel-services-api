/**
 * โครงสร้างเนื้อหาเว็บไซต์โรงแรม + ตัวทำความสะอาดข้อมูล
 *
 * draftContent / theme / seo เป็น JSON ที่ client ส่งมาทั้งก้อน — ทุกครั้งที่จะเขียนลง DB
 * ต้องผ่าน sanitize* ในไฟล์นี้ ซึ่ง:
 *   • เก็บเฉพาะฟิลด์ที่รู้จัก ตัดที่เหลือทิ้ง
 *   • ตัดความยาวข้อความ จำกัดจำนวนรูป/รายการ
 *   • URL รับเฉพาะ http(s) และลิงก์โซเชียล/แผนที่ต้องเป็นโดเมนของบริการนั้นจริง
 *     (หน้าเว็บสาธารณะเอา URL พวกนี้ไปใส่ href / iframe src ตรง ๆ)
 *   • section ครบทุกชนิด ชนิดละหนึ่งอัน เรียงลำดับใหม่ 0..n
 * ข้อมูลรูปทรงผิดจะถูกแทนด้วยค่าเริ่มต้นแทนการ throw — editor ส่งทั้งก้อนทุกครั้ง
 * จึงไม่มีทางที่ field ที่ผิดจะทำให้บันทึกส่วนอื่นไม่ได้
 */
import {
  SECTION_TYPES,
  SectionType,
  SiteKind,
  TEMPLATE_KEYS,
  TemplateKey,
} from './website.constants';

export interface LocalizedText {
  th: string;
  en: string;
}

export interface SiteTheme {
  primary: string;
  accent: string;
  font: 'serif' | 'sans';
  logoUrl: string | null;
}

export interface SiteSeo {
  title: LocalizedText;
  description: LocalizedText;
  ogImage: string | null;
}

export interface OfferItem {
  id: string;
  title: LocalizedText;
  description: LocalizedText;
  image: string | null;
  validFrom: string | null; // YYYY-MM-DD
  validTo: string | null;
  ctaText: LocalizedText;
}

export interface SectionPropsMap {
  hero: {
    headline: LocalizedText;
    subheadline: LocalizedText;
    images: string[];
    showBookingBar: boolean;
  };
  rooms: { title: LocalizedText; intro: LocalizedText };
  offers: { title: LocalizedText; items: OfferItem[] };
  gallery: { title: LocalizedText; images: string[] };
  dining: { title: LocalizedText; intro: LocalizedText };
  reviews: { title: LocalizedText; featuredReviewIds: string[] };
  location: {
    title: LocalizedText;
    mapEmbedUrl: string | null;
    lat: number | null;
    lng: number | null;
    directions: LocalizedText;
  };
  contact: { title: LocalizedText; intro: LocalizedText };
}

export type SiteSection = {
  [K in SectionType]: { type: K; enabled: boolean; order: number; props: SectionPropsMap[K] };
}[SectionType];

export interface RoomTypeContent {
  displayName: LocalizedText;
  description: LocalizedText;
  coverImages: string[];
  hidden: boolean;
  order: number;
}

export interface SiteContact {
  phone: string | null;
  email: string | null;
  lineOaUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
}

export interface SiteContent {
  sections: SiteSection[];
  roomTypes: Record<string, RoomTypeContent>;
  contact: SiteContact;
}

// ─── limits ────────────────────────────────────────────────────────────
const SHORT = 120;
const MEDIUM = 300;
const LONG = 2000;
const MAX_HERO_IMAGES = 6;
const MAX_GALLERY_IMAGES = 30;
const MAX_ROOM_IMAGES = 8;
const MAX_OFFERS = 12;
const MAX_FEATURED_REVIEWS = 12;
const MAX_ROOM_TYPES = 50;

// ─── primitives ────────────────────────────────────────────────────────
type Raw = Record<string, unknown>;

function asObject(v: unknown): Raw {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {};
}

export function cleanText(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export function cleanLocalized(v: unknown, max: number, fallback?: LocalizedText): LocalizedText {
  const o = asObject(v);
  const th = cleanText(o.th, max);
  const en = cleanText(o.en, max);
  if (!th && !en && fallback) return { ...fallback };
  return { th, en };
}

/** http(s) absolute URL เท่านั้น — กัน javascript:, data: ฯลฯ ที่จะไปอยู่ใน href/src */
export function cleanUrl(v: unknown, allowedHosts?: readonly string[]): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  let url: URL;
  try {
    url = new URL(v.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (allowedHosts) {
    const host = url.hostname.toLowerCase();
    const ok = allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
    if (!ok || url.protocol !== 'https:') return null;
  }
  return url.toString().slice(0, 1000);
}

function cleanUrlList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const url = cleanUrl(item);
    if (url && !out.includes(url)) out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

function cleanIdList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const ids = v
    .filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(x))
    .slice(0, max);
  return Array.from(new Set(ids));
}

function cleanDate(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

function cleanNumber(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function cleanColor(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback;
}

const lt = (th: string, en: string): LocalizedText => ({ th, en });
const EMPTY: LocalizedText = lt('', '');

// ─── defaults ──────────────────────────────────────────────────────────
export const TEMPLATE_THEMES: Record<TemplateKey, Omit<SiteTheme, 'logoUrl'>> = {
  classic: { primary: '#1f1f1f', accent: '#b08d57', font: 'serif' },
  fresh: { primary: '#0f766e', accent: '#f59e0b', font: 'sans' },
};

export function isTemplateKey(v: unknown): v is TemplateKey {
  return typeof v === 'string' && (TEMPLATE_KEYS as readonly string[]).includes(v);
}

/**
 * เว็บลานกางเต็นท์ใช้ section ชุดเดียวกับโรงแรม แต่ความหมายต่างกัน:
 *   rooms  → โซนลานกางเต็นท์ (ราคา/ความจุจาก CampZone)
 *   dining → สิ่งอำนวยความสะดวก + อุปกรณ์ให้เช่า
 *   reviews → ไม่มีข้อมูลรีวิวของลาน (ปิดไว้และหน้าเว็บไม่แสดง)
 */
const CAMP_TITLES: Partial<Record<SectionType, LocalizedText>> = {
  rooms: { th: 'โซนลานกางเต็นท์', en: 'Camping Zones' },
  dining: { th: 'สิ่งอำนวยความสะดวก & อุปกรณ์ให้เช่า', en: 'Facilities & Gear Rental' },
  reviews: { th: 'รีวิวจากนักแคมป์', en: 'Camper Reviews' },
};

function defaultSectionProps<K extends SectionType>(
  type: K,
  hotelName: string,
  kind: SiteKind = 'hotel',
): SectionPropsMap[K] {
  const props = baseSectionProps(type, hotelName);
  const campTitle = kind === 'camp' ? CAMP_TITLES[type] : undefined;
  return campTitle ? ({ ...props, title: { ...campTitle } } as SectionPropsMap[K]) : props;
}

function baseSectionProps<K extends SectionType>(type: K, hotelName: string): SectionPropsMap[K] {
  const defaults: SectionPropsMap = {
    hero: {
      headline: lt(hotelName, hotelName),
      subheadline: EMPTY,
      images: [],
      showBookingBar: true,
    },
    rooms: { title: lt('ห้องพัก', 'Accommodations'), intro: EMPTY },
    offers: { title: lt('ข้อเสนอพิเศษ', 'Offers'), items: [] },
    gallery: { title: lt('แกลเลอรี', 'Gallery'), images: [] },
    dining: { title: lt('ห้องอาหาร', 'Dining'), intro: EMPTY },
    reviews: { title: lt('รีวิวจากผู้เข้าพัก', 'Guest Reviews'), featuredReviewIds: [] },
    location: {
      title: lt('ที่ตั้ง', 'Location'),
      mapEmbedUrl: null,
      lat: null,
      lng: null,
      directions: EMPTY,
    },
    contact: { title: lt('ติดต่อเรา', 'Contact Us'), intro: EMPTY },
  };
  return defaults[type];
}

const DEFAULT_ENABLED: Record<SectionType, boolean> = {
  hero: true,
  rooms: true,
  offers: false,
  gallery: false,
  dining: false,
  reviews: false,
  location: true,
  contact: true,
};

// ─── section sanitizers ────────────────────────────────────────────────
const MAP_EMBED_HOSTS = ['google.com', 'google.co.th'] as const;

function cleanOffer(v: unknown, index: number): OfferItem {
  const o = asObject(v);
  const id =
    typeof o.id === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(o.id) ? o.id : `offer-${index + 1}`;
  return {
    id,
    title: cleanLocalized(o.title, SHORT),
    description: cleanLocalized(o.description, LONG),
    image: cleanUrl(o.image),
    validFrom: cleanDate(o.validFrom),
    validTo: cleanDate(o.validTo),
    ctaText: cleanLocalized(o.ctaText, 40),
  };
}

function cleanSectionProps<K extends SectionType>(
  type: K,
  raw: unknown,
  hotelName: string,
  kind: SiteKind,
): SectionPropsMap[K] {
  const o = asObject(raw);
  const d = defaultSectionProps(type, hotelName, kind) as SectionPropsMap[SectionType];
  const title = (): LocalizedText =>
    cleanLocalized(o.title, SHORT, (d as { title?: LocalizedText }).title);

  let props: SectionPropsMap[SectionType];
  switch (type) {
    case 'hero':
      props = {
        headline: cleanLocalized(o.headline, SHORT, lt(hotelName, hotelName)),
        subheadline: cleanLocalized(o.subheadline, MEDIUM),
        images: cleanUrlList(o.images, MAX_HERO_IMAGES),
        showBookingBar: typeof o.showBookingBar === 'boolean' ? o.showBookingBar : true,
      };
      break;
    case 'rooms':
    case 'dining':
    case 'contact':
      props = { title: title(), intro: cleanLocalized(o.intro, LONG) };
      break;
    case 'offers':
      props = {
        title: title(),
        items: (Array.isArray(o.items) ? o.items : []).slice(0, MAX_OFFERS).map(cleanOffer),
      };
      break;
    case 'gallery':
      props = { title: title(), images: cleanUrlList(o.images, MAX_GALLERY_IMAGES) };
      break;
    case 'reviews':
      props = {
        title: title(),
        featuredReviewIds: cleanIdList(o.featuredReviewIds, MAX_FEATURED_REVIEWS),
      };
      break;
    case 'location':
      props = {
        title: title(),
        mapEmbedUrl: cleanUrl(o.mapEmbedUrl, MAP_EMBED_HOSTS),
        lat: cleanNumber(o.lat, -90, 90),
        lng: cleanNumber(o.lng, -180, 180),
        directions: cleanLocalized(o.directions, LONG),
      };
      break;
    default:
      props = d;
  }
  return props as SectionPropsMap[K];
}

export function sanitizeSections(
  raw: unknown,
  hotelName: string,
  kind: SiteKind = 'hotel',
): SiteSection[] {
  const list = Array.isArray(raw) ? raw.map(asObject) : [];
  const byType = new Map<SectionType, Raw>();
  for (const s of list) {
    const type = s.type as SectionType;
    if ((SECTION_TYPES as readonly string[]).includes(type) && !byType.has(type)) {
      byType.set(type, s);
    }
  }

  const sections = SECTION_TYPES.map((type, defaultIndex) => {
    const s = byType.get(type);
    const order = s ? (cleanNumber(s.order, 0, 1000) ?? defaultIndex) : 100 + defaultIndex;
    return {
      type,
      enabled: s && typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_ENABLED[type],
      order,
      props: cleanSectionProps(type, s?.props, hotelName, kind),
    } as SiteSection;
  });

  return [...sections]
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({ ...s, order: i }) as SiteSection);
}

function sanitizeRoomTypes(raw: unknown): Record<string, RoomTypeContent> {
  const o = asObject(raw);
  const out: Record<string, RoomTypeContent> = {};
  for (const key of Object.keys(o).slice(0, MAX_ROOM_TYPES)) {
    const k = key.trim().slice(0, 120);
    if (!k) continue;
    const r = asObject(o[key]);
    out[k] = {
      displayName: cleanLocalized(r.displayName, SHORT),
      description: cleanLocalized(r.description, LONG),
      coverImages: cleanUrlList(r.coverImages, MAX_ROOM_IMAGES),
      hidden: r.hidden === true,
      order: cleanNumber(r.order, 0, 1000) ?? 0,
    };
  }
  return out;
}

function sanitizeContact(raw: unknown): SiteContact {
  const o = asObject(raw);
  const email = cleanText(o.email, 160);
  return {
    phone: cleanText(o.phone, 30).replace(/[^0-9+\-() ]/g, '') || null,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    lineOaUrl: cleanUrl(o.lineOaUrl, ['line.me', 'lin.ee']),
    facebookUrl: cleanUrl(o.facebookUrl, ['facebook.com', 'fb.com', 'fb.me']),
    instagramUrl: cleanUrl(o.instagramUrl, ['instagram.com']),
  };
}

// ─── public API ────────────────────────────────────────────────────────
export function sanitizeSiteContent(
  raw: unknown,
  hotelName: string,
  kind: SiteKind = 'hotel',
): SiteContent {
  const o = asObject(raw);
  return {
    sections: sanitizeSections(o.sections, hotelName, kind),
    roomTypes: sanitizeRoomTypes(o.roomTypes),
    contact: sanitizeContact(o.contact),
  };
}

export function sanitizeTheme(raw: unknown, templateKey: TemplateKey): SiteTheme {
  const o = asObject(raw);
  const d = TEMPLATE_THEMES[templateKey];
  return {
    primary: cleanColor(o.primary, d.primary),
    accent: cleanColor(o.accent, d.accent),
    font: o.font === 'serif' || o.font === 'sans' ? o.font : d.font,
    logoUrl: cleanUrl(o.logoUrl),
  };
}

export function sanitizeSeo(raw: unknown, hotelName: string): SiteSeo {
  const o = asObject(raw);
  return {
    title: cleanLocalized(o.title, 70, lt(hotelName, hotelName)),
    description: cleanLocalized(o.description, 160),
    ogImage: cleanUrl(o.ogImage),
  };
}

export interface DefaultContentInput {
  hotelName: string;
  phone: string | null;
  email: string | null;
  /** โรงแรม: มีห้องอาหาร / ลาน: มีสิ่งอำนวยความสะดวกหรืออุปกรณ์ให้เช่า → เปิด section dining */
  hasRestaurants: boolean;
  kind?: SiteKind;
}

/** เนื้อหาเริ่มต้นตอนสร้างเว็บ — เปิดเฉพาะ section ที่มีข้อมูลพร้อมแสดงแล้ว */
export function buildDefaultContent(input: DefaultContentInput): SiteContent {
  const kind = input.kind ?? 'hotel';
  const base = sanitizeSiteContent(
    { contact: { phone: input.phone, email: input.email } },
    input.hotelName,
    kind,
  );
  return {
    ...base,
    sections: base.sections.map((s) => {
      if (s.type === 'dining') return { ...s, enabled: input.hasRestaurants } as SiteSection;
      if (s.type === 'reviews' && kind === 'camp') return { ...s, enabled: false } as SiteSection;
      return s;
    }),
  };
}
