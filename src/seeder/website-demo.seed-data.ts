/**
 * ข้อมูลตัวอย่างสำหรับห้องพัก + เว็บไซต์โรงแรม (add-on WEBSITE_BUILDER)
 *
 * แยกจาก seeder.service.ts เพราะเป็นข้อความ/ลิงก์รูปล้วน ๆ
 *   • ROOM_TYPE_SEED — รายละเอียดห้องตามประเภท (ใช้กับทุก tenant)
 *   • MOUNTAIN_VIEW_* — รีวิว + เนื้อหาเว็บของ SUB-002 Mountain View Resort
 * เนื้อหาเว็บที่นี่เป็น "ดิบ" — seeder ต้องส่งผ่าน sanitizeSiteContent/Theme/Seo ก่อนเขียนลง DB เสมอ
 */

/** รูปจาก Unsplash — ขนาดพอดีกับ hero/การ์ดห้องบนหน้าเว็บ */
export const unsplash = (id: string): string =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1600&q=75`;

export interface RoomTypeSeed {
  description: string;
  descriptionEn: string;
  displayNameTh: string;
  displayNameEn: string;
  size: number;
  bedType: string;
  maxOccupancy: number;
  amenities: string[];
  images: string[];
}

/** key = Room.type ที่ seeder สร้าง (ต้องตรงตัวอักษรกับ roomTypes ใน seedDemoBookings) */
export const ROOM_TYPE_SEED: Record<string, RoomTypeSeed> = {
  Standard: {
    displayNameTh: 'ห้องสแตนดาร์ด',
    displayNameEn: 'Standard Room',
    description:
      'ห้องพักโทนอบอุ่นตกแต่งด้วยไม้สักและผ้าทอพื้นเมือง เตียงควีนไซซ์นุ่มสบาย เหมาะสำหรับการพักผ่อนหลังวันเที่ยวในเมืองเชียงใหม่',
    descriptionEn:
      'A warm, teak-accented room with handwoven northern Thai textiles and a plush queen bed — an easy retreat after a day exploring Chiang Mai.',
    size: 28,
    bedType: 'Queen',
    maxOccupancy: 2,
    amenities: ['Free Wi-Fi', 'Air conditioning', 'Smart TV', 'Rain shower', 'Coffee & tea maker'],
    images: [
      unsplash('1631049307264-da0ec9d70304'),
      unsplash('1540518614846-7eded433c457'),
      unsplash('1512918728675-ed5a9ecdebfd'),
    ],
  },
  Deluxe: {
    displayNameTh: 'ห้องดีลักซ์ วิวภูเขา',
    displayNameEn: 'Deluxe Mountain View',
    description:
      'ห้องกว้างขวางพร้อมระเบียงส่วนตัวหันหน้าสู่ดอยสุเทพ ตื่นมารับลมเย็นและสายหมอกยามเช้า เลือกได้ทั้งเตียงคิงไซซ์หรือเตียงคู่',
    descriptionEn:
      'A spacious room with a private balcony facing Doi Suthep — wake up to cool breezes and morning mist. Choose a king bed or twin beds.',
    size: 36,
    bedType: 'King',
    maxOccupancy: 2,
    amenities: [
      'Free Wi-Fi',
      'Air conditioning',
      'Smart TV',
      'Mountain-view balcony',
      'Mini bar',
      'Coffee & tea maker',
    ],
    images: [
      unsplash('1618773928121-c32242e63f39'),
      unsplash('1505693416388-ac5ce068fe85'),
      unsplash('1595576508898-0ad5c879a061'),
    ],
  },
  Suite: {
    displayNameTh: 'สวีท',
    displayNameEn: 'Suite',
    description:
      'สวีทแยกส่วนนั่งเล่นและห้องนอน อ่างอาบน้ำแช่ตัวพร้อมวิวสวน เหมาะกับคู่รักหรือครอบครัวเล็กที่อยากได้พื้นที่เป็นส่วนตัวมากขึ้น',
    descriptionEn:
      'A suite with a separate living area and bedroom plus a soaking tub overlooking the garden — ideal for couples or small families who want more room to unwind.',
    size: 55,
    bedType: 'King',
    maxOccupancy: 3,
    amenities: [
      'Free Wi-Fi',
      'Air conditioning',
      'Smart TV',
      'Living area',
      'Bathtub',
      'Mini bar',
      'Nespresso machine',
    ],
    images: [unsplash('1578898886225-c7c894047899'), unsplash('1566665797739-1674de7a421a')],
  },
  Presidential: {
    displayNameTh: 'เพรสซิเดนเชียล สวีท',
    displayNameEn: 'Presidential Suite',
    description:
      'ห้องพักระดับสูงสุดของรีสอร์ต พร้อมเทอร์เรซส่วนตัวชมวิวขุนเขาแบบพาโนรามา ห้องรับประทานอาหาร และบริการบัตเลอร์ตลอดการเข้าพัก',
    descriptionEn:
      'Our finest residence, with a private panoramic mountain terrace, a dining room and dedicated butler service throughout your stay.',
    size: 110,
    bedType: 'King',
    maxOccupancy: 4,
    amenities: [
      'Free Wi-Fi',
      'Air conditioning',
      'Smart TV',
      'Private terrace',
      'Bathtub',
      'Dining area',
      'Butler service',
      'Airport transfer',
    ],
    images: [
      unsplash('1616594039964-ae9021a400a0'),
      unsplash('1578683010236-d716f9a3f461'),
      unsplash('1584622650111-993a426fbf0a'),
    ],
  },
};

// ─── Mountain View Resort (SUB-002) ────────────────────────────────────

export const MOUNTAIN_VIEW_PROPERTY = {
  name: 'Mountain View Resort',
  location: '456 ถนนห้วยแก้ว ตำบลสุเทพ อำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่ 50200',
  description:
    'รีสอร์ตบูทีคเชิงดอยสุเทพ ห่างจากนิมมานเหมินท์เพียง 10 นาที ห้องพัก 80 ห้องท่ามกลางสวนเขียวขจี ' +
    'สระว่ายน้ำอินฟินิตี้ชมวิวภูเขา สปา และห้องอาหารไทยภาคเหนือรสชาติต้นตำรับ',
  tenantAddress: '456 ถนนห้วยแก้ว ตำบลสุเทพ',
  district: 'เมืองเชียงใหม่',
  province: 'เชียงใหม่',
  postalCode: '50200',
};

export interface ReviewSeed {
  firstName: string;
  lastName: string;
  email: string;
  nationality: string;
  rating: number;
  comment: string;
  roomType: string;
  /** วันเช็คอินย้อนหลังจากวันนี้ */
  daysAgo: number;
  nights: number;
  featured?: boolean;
}

/** 14 รีวิว เฉลี่ย 4.6 (5×10, 4×3, 3×1) */
export const MOUNTAIN_VIEW_REVIEWS: ReviewSeed[] = [
  {
    firstName: 'ณัฐธิดา',
    lastName: 'วงศ์สวัสดิ์',
    email: 'natthida.w@example.com',
    nationality: 'Thailand',
    rating: 5,
    comment:
      'วิวจากระเบียงสวยมาก ตื่นเช้ามาเห็นทะเลหมอกบนดอยสุเทพ พนักงานยิ้มแย้มและใส่ใจทุกรายละเอียด อาหารเช้าข้าวซอยอร่อยที่สุด จะกลับมาอีกแน่นอนค่ะ',
    roomType: 'Deluxe',
    daysAgo: 45,
    nights: 2,
    featured: true,
  },
  {
    firstName: 'James',
    lastName: 'Whitfield',
    email: 'james.whitfield@example.com',
    nationality: 'United Kingdom',
    rating: 5,
    comment:
      'A genuinely peaceful escape just ten minutes from Nimman. The infinity pool overlooking the mountains is stunning, and the staff remembered our names from day one.',
    roomType: 'Suite',
    daysAgo: 62,
    nights: 3,
    featured: true,
  },
  {
    firstName: 'พิมพ์ชนก',
    lastName: 'ศรีสุข',
    email: 'pimchanok.s@example.com',
    nationality: 'Thailand',
    rating: 5,
    comment:
      'มาฉลองครบรอบแต่งงาน ทางรีสอร์ตจัดดอกไม้และเค้กให้โดยไม่ได้ขอ ประทับใจมาก ห้องสะอาด เตียงนุ่ม เงียบสงบเหมาะกับการพักผ่อนจริง ๆ',
    roomType: 'Presidential',
    daysAgo: 80,
    nights: 2,
    featured: true,
  },
  {
    firstName: 'Sophie',
    lastName: 'Laurent',
    email: 'sophie.laurent@example.com',
    nationality: 'France',
    rating: 5,
    comment:
      'Beautiful teak interiors, a wonderful spa and the best khao soi we had in Chiang Mai. The team arranged a temple tour for us at sunrise — unforgettable.',
    roomType: 'Deluxe',
    daysAgo: 98,
    nights: 4,
    featured: true,
  },
  {
    firstName: 'ธนพล',
    lastName: 'อินทรประเสริฐ',
    email: 'thanapol.i@example.com',
    nationality: 'Thailand',
    rating: 4,
    comment:
      'ห้องกว้าง บรรยากาศดี อากาศเย็นสบาย ที่จอดรถสะดวก ติดอย่างเดียวคือ Wi-Fi ช่วงค่ำช้าไปนิด แต่โดยรวมคุ้มค่ามากครับ',
    roomType: 'Standard',
    daysAgo: 115,
    nights: 2,
  },
  {
    firstName: 'Kenji',
    lastName: 'Tanaka',
    email: 'kenji.tanaka@example.com',
    nationality: 'Japan',
    rating: 5,
    comment:
      'Spotless rooms, quiet nights and very attentive service. Breakfast on the terrace with the mountain view was the highlight of our trip.',
    roomType: 'Suite',
    daysAgo: 134,
    nights: 3,
  },
  {
    firstName: 'อรอุมา',
    lastName: 'แก้วมณี',
    email: 'onuma.k@example.com',
    nationality: 'Thailand',
    rating: 5,
    comment:
      'พาครอบครัวมาพัก เด็ก ๆ ชอบสระว่ายน้ำมาก พนักงานช่วยแนะนำร้านอาหารและที่เที่ยวในเมืองอย่างดี สปาก็ผ่อนคลายสุด ๆ ค่ะ',
    roomType: 'Suite',
    daysAgo: 152,
    nights: 3,
  },
  {
    firstName: 'Michael',
    lastName: 'Brennan',
    email: 'michael.brennan@example.com',
    nationality: 'Australia',
    rating: 4,
    comment:
      'Great location for exploring the old city and Doi Suthep. Room was comfortable and clean; the restaurant menu could use a few more western options.',
    roomType: 'Deluxe',
    daysAgo: 171,
    nights: 2,
  },
  {
    firstName: 'กิตติพัฒน์',
    lastName: 'บุญมา',
    email: 'kittipat.b@example.com',
    nationality: 'Thailand',
    rating: 5,
    comment:
      'บริการระดับห้าดาวในราคาที่จับต้องได้ เช็คอินรวดเร็ว มีน้ำสมุนไพรต้อนรับ ห้องหอมสะอาด วิวภูเขาสวยทุกช่วงเวลา แนะนำเลยครับ',
    roomType: 'Deluxe',
    daysAgo: 190,
    nights: 2,
  },
  {
    firstName: 'Emma',
    lastName: 'Schneider',
    email: 'emma.schneider@example.com',
    nationality: 'Germany',
    rating: 5,
    comment:
      'We stayed during Yi Peng and the resort organised lanterns for all guests. Magical atmosphere, lovely staff and a very comfortable bed.',
    roomType: 'Presidential',
    daysAgo: 214,
    nights: 3,
  },
  {
    firstName: 'สุภาวดี',
    lastName: 'จันทร์เพ็ญ',
    email: 'supawadee.j@example.com',
    nationality: 'Thailand',
    rating: 3,
    comment:
      'ห้องและวิวดีค่ะ แต่ช่วงที่ไปมีงานปรับปรุงสวนทำให้เสียงดังตอนกลางวัน พนักงานขอโทษและอัปเกรดห้องให้ ถือว่าแก้ปัญหาได้ดี',
    roomType: 'Standard',
    daysAgo: 236,
    nights: 1,
  },
  {
    firstName: 'David',
    lastName: 'Chen',
    email: 'david.chen@example.com',
    nationality: 'Singapore',
    rating: 4,
    comment:
      'Lovely, calm resort with friendly staff. Rooms are well designed and the pool is great. A shuttle to Nimman more often would make it perfect.',
    roomType: 'Standard',
    daysAgo: 258,
    nights: 3,
  },
  {
    firstName: 'วรเมธ',
    lastName: 'ทองดี',
    email: 'woramet.t@example.com',
    nationality: 'Thailand',
    rating: 5,
    comment:
      'มาทำงานแบบ workation หนึ่งสัปดาห์ อินเทอร์เน็ตแรง มีมุมทำงานเงียบ ๆ กาแฟดอยอร่อย ตกเย็นลงสระชมพระอาทิตย์ตก ประทับใจทุกอย่างครับ',
    roomType: 'Deluxe',
    daysAgo: 280,
    nights: 4,
  },
  {
    firstName: 'Olivia',
    lastName: 'Martins',
    email: 'olivia.martins@example.com',
    nationality: 'United States',
    rating: 5,
    comment:
      'One of the most memorable hotels of our Southeast Asia trip. The butler arranged everything for us — cooking class, elephant sanctuary, night market. Highly recommended.',
    roomType: 'Presidential',
    daysAgo: 305,
    nights: 3,
  },
];

const lt = (th: string, en: string) => ({ th, en });

/** ค่าจาก Google Maps "Embed a map" ของพิกัด 18.7883, 98.9853 (ตัวเมืองเชียงใหม่) */
export const MOUNTAIN_VIEW_MAP_EMBED =
  'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d15109.0!2d98.9853!3d18.7883!2m3!1f0!2f0!3f0' +
  '!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zMTjCsDQ3JzE3LjkiTiA5OMKwNTknMDcuMSJF!5e0!3m2!1sth!2sth!4v1700000000000!5m2!1sth!2sth';

export const MOUNTAIN_VIEW_THEME = {
  primary: '#1c1c1c',
  accent: '#b08d57',
  font: 'serif',
  logoUrl: null,
};

export const MOUNTAIN_VIEW_SEO = {
  title: lt(
    'Mountain View Resort เชียงใหม่ | รีสอร์ตวิวดอยสุเทพ',
    'Mountain View Resort Chiang Mai | Boutique Resort by Doi Suthep',
  ),
  description: lt(
    'รีสอร์ตบูทีคเชิงดอยสุเทพ ห้องพักวิวภูเขา สระอินฟินิตี้ สปา และอาหารไทยภาคเหนือ ห่างนิมมานฯ 10 นาที จองตรงรับราคาดีที่สุด',
    'Boutique resort at the foot of Doi Suthep with mountain-view rooms, an infinity pool, spa and northern Thai dining — 10 minutes from Nimman.',
  ),
  ogImage: unsplash('1561409037-c7be81613c1f'),
};

/** เนื้อหาเว็บดิบ — featuredReviewIds ใส่ทีหลังเมื่อรู้ id รีวิวจริง */
export function buildMountainViewContent(input: {
  featuredReviewIds: string[];
  phone: string | null;
  email: string | null;
}) {
  const roomTypes = Object.fromEntries(
    Object.entries(ROOM_TYPE_SEED).map(([key, r], order) => [
      key,
      {
        displayName: lt(r.displayNameTh, r.displayNameEn),
        description: lt(r.description, r.descriptionEn),
        coverImages: r.images,
        hidden: false,
        order,
      },
    ]),
  );

  return {
    sections: [
      {
        type: 'hero',
        enabled: true,
        order: 0,
        props: {
          headline: lt('พักผ่อนท่ามกลางขุนเขา', 'Where the mountains meet quiet luxury'),
          subheadline: lt(
            'รีสอร์ตบูทีคเชิงดอยสุเทพ เชียงใหม่ — อากาศเย็นสบาย วิวภูเขาจากทุกห้อง และการต้อนรับแบบล้านนา',
            'A boutique hideaway at the foot of Doi Suthep, Chiang Mai — cool mountain air, sweeping views and warm Lanna hospitality.',
          ),
          images: [
            unsplash('1561409037-c7be81613c1f'),
            unsplash('1500534314209-a25ddb2bd429'),
            unsplash('1564078516393-cf04bd966897'),
          ],
          showBookingBar: true,
        },
      },
      {
        type: 'rooms',
        enabled: true,
        order: 1,
        props: {
          title: lt('ห้องพักและสวีท', 'Rooms & Suites'),
          intro: lt(
            'ห้องพักทุกห้องตกแต่งด้วยไม้สักและงานผ้าล้านนา พร้อมความสะดวกสบายครบครัน ให้คุณได้พักผ่อนอย่างเต็มที่ท่ามกลางธรรมชาติ',
            'Every room blends teak craftsmanship and Lanna textiles with modern comforts, so you can truly unwind surrounded by nature.',
          ),
        },
      },
      {
        type: 'offers',
        enabled: true,
        order: 2,
        props: {
          title: lt('ข้อเสนอพิเศษ', 'Special Offers'),
          items: [
            {
              id: 'offer-1',
              title: lt('พัก 3 คืน จ่ายเพียง 2', 'Stay 3, Pay 2'),
              description: lt(
                'อยู่ยาวขึ้นในราคาที่คุ้มกว่า เข้าพัก 3 คืนจ่ายเพียง 2 คืน รวมอาหารเช้าสำหรับ 2 ท่านทุกวัน',
                'Linger longer for less — stay three nights and pay for two, with daily breakfast for two included.',
              ),
              image: unsplash('1582610116397-edb318620f90'),
              validFrom: '2026-11-01',
              validTo: '2027-03-31',
              ctaText: lt('จองเลย', 'Book now'),
            },
            {
              id: 'offer-2',
              title: lt('แพ็กเกจสปาและสุขภาพ', 'Spa & Wellness Retreat'),
              description: lt(
                'นวดแผนไทยล้านนา 90 นาทีสำหรับ 2 ท่าน พร้อมคลาสโยคะยามเช้าและเครื่องดื่มสมุนไพรต้อนรับ',
                'A 90-minute Lanna massage for two, a sunrise yoga class and a welcome herbal infusion.',
              ),
              image: unsplash('1600334089648-b0d9d3028eb2'),
              validFrom: '2026-10-15',
              validTo: '2027-06-30',
              ctaText: lt('ดูรายละเอียด', 'Learn more'),
            },
            {
              id: 'offer-3',
              title: lt('ดินเนอร์โรแมนติกใต้แสงดาว', 'Romantic Dinner Under the Stars'),
              description: lt(
                'เซ็ตอาหารค่ำ 5 คอร์สริมสระชมวิวภูเขา พร้อมไวน์และการตกแต่งดอกไม้ เหมาะสำหรับวันพิเศษของคุณ',
                'A five-course poolside dinner with mountain views, wine pairing and floral styling — perfect for special occasions.',
              ),
              image: unsplash('1531971589569-0d9370cbe1e5'),
              validFrom: '2026-11-01',
              validTo: '2027-02-28',
              ctaText: lt('สำรองที่นั่ง', 'Reserve'),
            },
          ],
        },
      },
      {
        type: 'gallery',
        enabled: true,
        order: 3,
        props: {
          title: lt('แกลเลอรี', 'Gallery'),
          images: [
            unsplash('1506905925346-21bda4d32df4'),
            unsplash('1528181304800-259b08848526'),
            unsplash('1559628233-100c798642d4'),
            unsplash('1569562211093-4ed0d0758f12'),
            unsplash('1507652313519-d4e9174996dd'),
            unsplash('1506126613408-eca07ce68773'),
            unsplash('1509042239860-f550ce710b93'),
            unsplash('1555400038-63f5ba517a47'),
          ],
        },
      },
      {
        type: 'dining',
        enabled: true,
        order: 4,
        props: {
          title: lt('ห้องอาหารและเครื่องดื่ม', 'Dining'),
          intro: lt(
            'ลิ้มรสอาหารไทยภาคเหนือต้นตำรับและเมนูนานาชาติจากวัตถุดิบท้องถิ่น พร้อมกาแฟดอยคั่วสดทุกเช้า',
            'Savour authentic northern Thai cuisine and international favourites made with local produce, plus freshly roasted mountain coffee every morning.',
          ),
        },
      },
      {
        type: 'reviews',
        enabled: true,
        order: 5,
        props: {
          title: lt('เสียงจากผู้เข้าพัก', 'What Our Guests Say'),
          featuredReviewIds: input.featuredReviewIds,
        },
      },
      {
        type: 'location',
        enabled: true,
        order: 6,
        props: {
          title: lt('การเดินทาง', 'Getting Here'),
          mapEmbedUrl: MOUNTAIN_VIEW_MAP_EMBED,
          lat: 18.7883,
          lng: 98.9853,
          directions: lt(
            'ห่างจากสนามบินนานาชาติเชียงใหม่ประมาณ 20 นาที และจากถนนนิมมานเหมินท์ 10 นาที ทางรีสอร์ตมีบริการรถรับส่งสนามบิน (กรุณาแจ้งล่วงหน้า 24 ชั่วโมง)',
            'About 20 minutes from Chiang Mai International Airport and 10 minutes from Nimmanhaemin Road. Airport transfers are available on request (24 hours’ notice).',
          ),
        },
      },
      {
        type: 'contact',
        enabled: true,
        order: 7,
        props: {
          title: lt('ติดต่อเรา', 'Contact Us'),
          intro: lt(
            'มีคำถามหรือต้องการจัดทริปพิเศษ ทีมงานของเรายินดีช่วยเหลือทุกวัน 08:00–22:00 น.',
            'Questions or planning something special? Our team is happy to help every day from 8 am to 10 pm.',
          ),
        },
      },
    ],
    roomTypes,
    contact: {
      phone: input.phone,
      email: input.email,
      lineOaUrl: 'https://line.me/R/ti/p/@mountainview',
      facebookUrl: 'https://www.facebook.com/mountainviewcm',
      instagramUrl: 'https://www.instagram.com/mountainviewcm',
    },
  };
}
