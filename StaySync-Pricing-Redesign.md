# StaySync Pricing Page — UX Redesign Spec

> **Goal**: เพิ่ม free trial sign-up, ลด decision friction, เพิ่ม conversion rate  
> **API endpoint**: `GET /api/v1/plans` (public, no auth)  
> **New fields**: `subtitle`, `targetAudience`, `pricePerRoom` (added to API response)

---

## 1. Page Structure (Top → Bottom)

### Section A: Hero / Page Header
```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│   เลือกแพ็กเกจที่เหมาะกับโรงแรมของคุณ                         │
│   เริ่มต้นฟรี 14 วัน ไม่ต้องผูกบัตรเครดิต                       │
│                                                            │
│   ⭐ โรงแรมกว่า 500+ แห่งทั่วไทยไว้วางใจ StaySync           │
│                                                            │
│   [ รายเดือน ◉ ]  [ ◎ รายปี ประหยัดสูงสุด 20% ]               │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**Key changes**:
- Title บอก action ที่ต้องทำ (เลือก) ไม่ใช่แค่ statement
- Sub-headline ตัดสินใจง่าย = ฟรี + ไม่ต้องผูกบัตร
- Social proof number อยู่ใกล้ header ไม่ใช่ท้ายหน้า
- Billing toggle ชัดเจน, ฝั่ง "รายปี" มี badge "ประหยัดสูงสุด 20%"

### Section B: Pricing Cards — Horizontal Carousel (3 visible + peek)

**Layout**: แสดง 3 cards แรก (ทดลองฟรี, Starter, Professional) — card ที่ 4+ ซ่อนอยู่ทางขวา
โดยมี **peek indicator** (เห็นขอบ card ที่ 4 โผล่ ~40px) + ลูกศรบอกว่ามีเพิ่ม

```
                    ◄ visible viewport (3 cards) ►             ┊ hidden
                                                               ┊
┌──────────┐  ┌──────────┐  ┌═══════════════┐  ┊ ┌──────────┐
│ ทดลองฟรี   │  │ Starter  │  ║ Professional  ║  ┊ │ Enterpr… │ ← peek 40px
│            │  │          │  ║  คุ้มค่าที่สุด    ║  ┊ │          │
│  ฿0/เดือน   │  │ ฿1,990   │  ║   ฿4,990      ║  ┊ │ ฿9,99…   │
│  [CTA]     │  │  [CTA]   │  ║   [CTA]       ║  ┊ │          │
│  features  │  │ features │  ║  features     ║  ┊ │          │
└──────────┘  └──────────┘  ╚═══════════════╝  ┊ └──────────┘
                                                ┊
                                           [ → ] scroll arrow
```

**เลื่อนขวา 1 ครั้ง** → card ทดลองฟรี slide ออกซ้าย, Enterprise slide เข้ามาเต็ม:
```
        ┊              ◄ visible viewport (3 cards) ►
        ┊
──────┐ ┊ ┌──────────┐  ┌═══════════════┐  ┌──────────┐
ลองฟรี… │ ┊ │ Starter  │  ║ Professional  ║  │Enterprise│
        │ ┊ │          │  ║  คุ้มค่าที่สุด    ║  │          │
9…      │ ┊ │ ฿1,990   │  ║   ฿4,990      ║  │ ฿9,990   │
        │ ┊ │  [CTA]   │  ║   [CTA]       ║  │  [CTA]   │
──────┘ ┊ └──────────┘  ╚═══════════════╝  └──────────┘
        ┊
  [ ← ] scroll arrow
```

**Carousel Rules**:
- แสดง 3 cards พร้อมกันเสมอ (desktop) — card ที่เกินจากนี้ซ่อนทางขวา
- มี **peek** (card ที่ซ่อนโผล่ขอบ ~40px) + **gradient fade** ทางขวาบอกว่ามีเพิ่ม
- เลื่อนทีละ 1 card ต่อครั้ง (snap to card)
- ทั้ง scroll ซ้าย/ขวา ทำได้ — smooth transition (`scroll-behavior: smooth`)
- **Navigation arrows**: แสดงทางขวาเมื่อมี card ซ่อนอยู่ / แสดงทางซ้ายเมื่อเลื่อนไปแล้ว
- **Dot indicators** ใต้ carousel บอกว่าอยู่ตำแหน่งไหน (4 dots, highlight active range)
- **Swipe gesture** บน touch devices — snap to nearest card
- Professional card ยังคง scale(1.03) + ring border สี `#8B5CF6` เสมอ

### Section C: Feature Comparison Table
### Section D: FAQ Accordion
### Section E: Final CTA + Social Proof

---

## 2. Pricing Card Anatomy (Per Card)

Each card from top to bottom:

```
┌─────────────────────────────────────┐
│  [Badge]  e.g. "คุ้มค่าที่สุด"          │  ← Only if badge exists
│                                     │
│  Plan Name                          │  ← h3, bold
│  subtitle (1 line)                  │  ← text-sm, muted
│                                     │
│  ฿X,XXX /เดือน                       │  ← Large price
│  ~฿XX/ห้อง/เดือน                      │  ← text-xs, muted (pricePerRoom)
│  ┌ ประหยัด ฿X,XXX/ปี ┐                │  ← Only when yearly toggle on
│                                     │
│  [ CTA Button - Full Width ]        │  ← Primary for Professional,
│                                     │     Secondary for others
│                                     │
│  targetAudience                     │  ← text-xs, italic
│  ──────────────────                 │
│                                     │
│  ✓ Feature 1 (benefit-focused)      │
│  ✓ Feature 2                        │
│  ✓ Feature 3                        │
│  ...                                │
└─────────────────────────────────────┘
```

---

## 3. Final Card Content (API Response → UI Mapping)

### Card 1: ทดลองฟรี
| Field | Value |
|---|---|
| **name** | ทดลองฟรี |
| **badge** | ฟรี 14 วัน |
| **subtitle** | เริ่มต้นใน 2 นาที ไม่มีค่าใช้จ่าย |
| **price** | ฿0/เดือน |
| **pricePerRoom** | — |
| **targetAudience** | สำหรับทุกโรงแรมที่อยากลองก่อนตัดสินใจ |
| **CTA** | เริ่มทดลองฟรี — ไม่มีค่าใช้จ่าย |
| **CTA style** | Outlined purple, full-width |
| **features** | |
| | ✓ ฟีเจอร์ครบทุกระบบ ไม่มีกั๊ก |
| | ✓ จัดการจอง + เช็คอิน/เอาท์ |
| | ✓ ระบบ Housekeeping อัตโนมัติ |
| | ✓ รายงานรายได้แบบเรียลไทม์ |
| | ✓ ไม่ต้องผูกบัตรเครดิต |
| | ✓ ยกเลิกได้ตลอดเวลา |

### Card 2: Starter — ฿1,990/เดือน
| Field | Value |
|---|---|
| **name** | Starter |
| **badge** | — |
| **subtitle** | เปลี่ยนจากสมุดจดมาเป็นระบบมืออาชีพ |
| **price** | ฿1,990/เดือน |
| **pricePerRoom** | ~฿100/ห้อง/เดือน |
| **targetAudience** | โรงแรมขนาดเล็ก · เกสต์เฮาส์ · โฮสเทล 1-20 ห้อง |
| **CTA** | เริ่มใช้งาน Starter |
| **CTA style** | Solid gray, full-width |
| **features** | |
| | ✓ จัดการจองออนไลน์ ลด no-show |
| | ✓ Front Desk ดิจิทัล เช็คอิน/เอาท์ง่าย |
| | ✓ มอบหมายงาน Housekeeping อัตโนมัติ |
| | ✓ รายงานรายได้ + ยอดจองรายวัน |
| | ✓ แจ้งเตือนอีเมลอัตโนมัติ |
| | ✓ Email Support ตอบภายใน 24 ชม. |

### Card 3: Professional — ฿4,990/เดือน ⭐ RECOMMENDED
| Field | Value |
|---|---|
| **name** | Professional |
| **badge** | คุ้มค่าที่สุด |
| **subtitle** | ฟีเจอร์ครบ คุ้มที่สุด สำหรับโรงแรมที่พร้อมเติบโต |
| **price** | ฿4,990/เดือน |
| **pricePerRoom** | ~฿100/ห้อง/เดือน |
| **targetAudience** | โรงแรม · รีสอร์ท · บูทีค 21-50 ห้อง |
| **CTA** | เริ่มใช้งาน Professional |
| **CTA style** | **Solid purple (#8B5CF6)**, full-width, **larger padding** |
| **Card style** | `ring-2 ring-purple-500`, `scale-105`, `shadow-xl` |
| **features** | |
| | ✓ ทุกฟีเจอร์ของ Starter + |
| | ✓ ระบบ HR จัดการพนักงาน เวร ลางาน |
| | ✓ ระบบร้านอาหาร (F&B) ลิงก์กับ Folio แขก |
| | ✓ รายงานเชิงลึก + Revenue Analytics |
| | ✓ Channel Manager เชื่อม OTA อัตโนมัติ |
| | ✓ ส่งรีวิวรีเควสต์หลังเช็คเอาท์ |
| | ✓ Loyalty Program สะสมแต้มแขกประจำ |
| | ✓ Priority Support ตอบภายใน 4 ชม. |

### Card 4: Enterprise — ฿9,990/เดือน
| Field | Value |
|---|---|
| **name** | Enterprise |
| **badge** | ประหยัดสุด/ห้อง |
| **subtitle** | ควบคุมทุกสาขาจาก Dashboard เดียว |
| **price** | ฿9,990/เดือน |
| **pricePerRoom** | ~฿50/ห้อง/เดือน |
| **targetAudience** | เชนโรงแรม · กลุ่มธุรกิจ 51-200+ ห้อง · หลาย property |
| **CTA** | ติดต่อทีมขาย |
| **CTA style** | Solid dark, full-width |
| **features** | |
| | ✓ ทุกฟีเจอร์ของ Professional + |
| | ✓ Multi-property Dashboard รวมศูนย์ |
| | ✓ API Access เชื่อมระบบภายนอก |
| | ✓ Custom Integration ตามธุรกิจ |
| | ✓ Dedicated Account Manager ดูแลเฉพาะ |
| | ✓ PromptPay QR Payment ในระบบ |
| | ✓ Audit Log + Security ระดับองค์กร |
| | ✓ 24/7 Premium Support โทร + แชท |

---

## 4. Feature Comparison Table

Below the cards, add a toggleable "เปรียบเทียบทุกแพ็กเกจ" section.

| Feature | Free | Starter | Professional | Enterprise |
|---|:---:|:---:|:---:|:---:|
| **จำนวนห้อง** | 5 | 20 | 50 | 200 |
| **จำนวนผู้ใช้** | 2 | 3 | 10 | 50 |
| **จำนวน Property** | 1 | 1 | 3 | 10 |
| **ระบบจอง + Front Desk** | ✓ | ✓ | ✓ | ✓ |
| **Housekeeping อัตโนมัติ** | ✓ | ✓ | ✓ | ✓ |
| **อีเมลแจ้งเตือนอัตโนมัติ** | ✓ | ✓ | ✓ | ✓ |
| **รายงานรายได้** | Basic | Basic | Advanced | Advanced |
| **ระบบ HR** | — | — | ✓ | ✓ |
| **ระบบร้านอาหาร (F&B)** | — | — | ✓ | ✓ |
| **Channel Manager (OTA)** | — | — | ✓ | ✓ |
| **Revenue Analytics** | — | — | ✓ | ✓ |
| **Loyalty Program** | — | — | ✓ | ✓ |
| **Multi-property** | — | — | — | ✓ |
| **API Access** | — | — | — | ✓ |
| **Custom Integration** | — | — | — | ✓ |
| **PromptPay QR Payment** | — | — | — | ✓ |
| **Audit Log** | — | — | — | ✓ |
| **Support** | — | Email (24 ชม.) | Priority (4 ชม.) | 24/7 Premium |
| **Dedicated Manager** | — | — | — | ✓ |

---

## 5. Conversion Elements

### 5.1 Social Proof Bar (above cards)
```
"โรงแรมกว่า 500+ แห่ง" · "4.8/5 ⭐ จากผู้ใช้จริง" · "ลดเวลาทำงาน 60%"
```
Show 3 mini-stats in a row. Keep numbers concrete.

### 5.2 Urgency / Incentive (below billing toggle)
```
🎁 สมัครรายปีวันนี้ ประหยัดสูงสุด ฿23,976/ปี
```
This line only shows when "รายปี" toggle is active.

### 5.3 Trust Badges (below cards)
```
🔒 ข้อมูลปลอดภัย     ⚡ เริ่มใช้ใน 2 นาที     💳 ไม่ต้องผูกบัตร     🔄 ยกเลิกได้ตลอด
```

### 5.4 Testimonial Section (below comparison table)
2-3 quotes from hotel owners, with:
- Name, role, hotel name
- Hotel size (e.g., "บูทีคโฮเทล 30 ห้อง, เชียงใหม่")
- 1-2 sentence quote about a specific result

Example:
> "เปลี่ยนจากจดสมุดมา StaySync แค่เดือนเดียว ลดปัญหา double booking ได้ 100%"  
> — คุณสมชาย, GM โรงแรมลานนา เชียงใหม่ (25 ห้อง)

### 5.5 Final CTA Section (bottom of page)
```
┌──────────────────────────────────────────────┐
│  ยังไม่แน่ใจ? ลองฟรีก่อน ไม่มีข้อผูกมัด         │
│                                              │
│  [ เริ่มทดลองฟรี 14 วัน ]                      │
│                                              │
│  หรือ นัดเดโม่กับทีมงาน →                       │
└──────────────────────────────────────────────┘
```

---

## 6. FAQ Section

Collapsible accordion, answers common objections:

**Q: ทดลองฟรีต้องผูกบัตรเครดิตไหม?**  
A: ไม่ต้องครับ สมัครได้เลยทันที ใช้แค่อีเมล

**Q: เปลี่ยนแพ็กเกจภายหลังได้ไหม?**  
A: ได้ครับ อัพเกรดหรือดาวน์เกรดได้ตลอดเวลา คิดค่าบริการตามสัดส่วน (prorate)

**Q: ข้อมูลโรงแรมจะปลอดภัยไหม?**  
A: ข้อมูลทั้งหมดเข้ารหัสด้วย SSL + เก็บบน cloud ที่ได้มาตรฐาน พร้อม backup อัตโนมัติ

**Q: ใช้ StaySync กับโรงแรมหลายสาขาได้ไหม?**  
A: แพ็กเกจ Professional รองรับ 3 property, Enterprise รองรับ 10 property

**Q: มีค่าติดตั้งหรือค่า setup เพิ่มเติมไหม?**  
A: ไม่มีครับ ราคาที่เห็นคือทั้งหมด รวม onboarding ฟรี

---

## 7. Visual Design Guidelines (for Frontend Dev)

### Card Styling
```css
/* Normal card */
.plan-card {
  background: white;
  border: 1px solid #E5E7EB;
  border-radius: 16px;
  padding: 32px 24px;
  transition: all 0.2s;
}
.plan-card:hover { box-shadow: 0 8px 30px rgba(0,0,0,0.08); }

/* Recommended card (Professional) — use isPopular + highlightColor */
.plan-card--popular {
  border: 2px solid #8B5CF6;
  transform: scale(1.03);
  box-shadow: 0 8px 40px rgba(139,92,246,0.15);
  position: relative;
}

/* Badge */
.plan-badge {
  position: absolute;
  top: -14px; left: 50%; transform: translateX(-50%);
  background: #8B5CF6;
  color: white;
  padding: 4px 16px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
}

/* Price */
.plan-price { font-size: 36px; font-weight: 800; color: #111; }
.plan-price-unit { font-size: 16px; color: #6B7280; }
.plan-price-per-room { font-size: 13px; color: #9CA3AF; }

/* CTA */
.plan-cta { width: 100%; padding: 14px; border-radius: 12px; font-weight: 600; }
.plan-cta--primary { background: #8B5CF6; color: white; }
.plan-cta--secondary { background: #F3F4F6; color: #374151; }
.plan-cta--outline { border: 2px solid #8B5CF6; color: #8B5CF6; background: transparent; }
```

### Carousel Implementation (CSS Scroll Snap + JS)

```html
<!-- Container -->
<div class="plans-carousel-wrapper">
  <!-- Left arrow (hidden initially) -->
  <button class="carousel-arrow carousel-arrow--left" aria-label="เลื่อนซ้าย">
    <svg><!-- chevron-left icon --></svg>
  </button>

  <!-- Scrollable track -->
  <div class="plans-carousel">
    <div class="plans-carousel__track">
      <!-- Card 1..N rendered from API -->
      <div class="plan-card">...</div>
      <div class="plan-card">...</div>
      <div class="plan-card plan-card--popular">...</div>
      <div class="plan-card">...</div>
      <!-- Future cards 5, 6, 7... auto-supported -->
    </div>
  </div>

  <!-- Right arrow -->
  <button class="carousel-arrow carousel-arrow--right" aria-label="เลื่อนขวา">
    <svg><!-- chevron-right icon --></svg>
  </button>

  <!-- Dot indicators -->
  <div class="carousel-dots">
    <span class="carousel-dot carousel-dot--active"></span>
    <span class="carousel-dot"></span>
    <!-- 1 dot per scroll position -->
  </div>

  <!-- Right fade gradient (hints more content) -->
  <div class="carousel-fade carousel-fade--right"></div>
  <div class="carousel-fade carousel-fade--left"></div>
</div>
```

```css
/* ==================== Carousel Container ==================== */
.plans-carousel-wrapper {
  position: relative;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 60px;               /* Space for arrows */
}

/* ==================== Scrollable Track ==================== */
.plans-carousel {
  overflow-x: auto;
  overflow-y: visible;            /* Allow popular card scale to overflow */
  scroll-behavior: smooth;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;          /* Firefox */
  padding: 20px 0;               /* Vertical space for badge + scale overflow */
}
.plans-carousel::-webkit-scrollbar { display: none; }

.plans-carousel__track {
  display: flex;
  gap: 24px;
}

/* ==================== Card Sizing ==================== */
.plan-card {
  /* Show exactly 3 cards: (100% - 2 gaps - peek) / 3 */
  flex: 0 0 calc((100% - 48px - 40px) / 3);
  scroll-snap-align: start;
  background: white;
  border: 1px solid #E5E7EB;
  border-radius: 16px;
  padding: 32px 24px;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
  min-width: 280px;
}
.plan-card:hover {
  box-shadow: 0 8px 30px rgba(0,0,0,0.08);
}

/* Popular card — always visually elevated */
.plan-card--popular {
  border: 2px solid #8B5CF6;
  transform: scale(1.03);
  box-shadow: 0 8px 40px rgba(139,92,246,0.15);
  position: relative;
  z-index: 2;
}

/* ==================== Peek & Fade Gradients ==================== */
/* Right fade: hints there are more cards */
.carousel-fade--right {
  position: absolute;
  top: 0; right: 50px; bottom: 0;
  width: 80px;
  background: linear-gradient(to right, transparent, rgba(244,244,245,0.95));
  pointer-events: none;
  z-index: 3;
  transition: opacity 0.3s;
}
.carousel-fade--left {
  position: absolute;
  top: 0; left: 50px; bottom: 0;
  width: 80px;
  background: linear-gradient(to left, transparent, rgba(244,244,245,0.95));
  pointer-events: none;
  z-index: 3;
  opacity: 0;                     /* Hidden initially (at start) */
  transition: opacity 0.3s;
}

/* ==================== Navigation Arrows ==================== */
.carousel-arrow {
  position: absolute;
  top: 50%; transform: translateY(-50%);
  z-index: 5;
  width: 44px; height: 44px;
  border-radius: 50%;
  background: white;
  border: 1px solid #E5E7EB;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.carousel-arrow:hover {
  background: #8B5CF6;
  color: white;
  border-color: #8B5CF6;
  box-shadow: 0 4px 16px rgba(139,92,246,0.3);
}
.carousel-arrow--left  { left: 8px; }
.carousel-arrow--right { right: 8px; }
.carousel-arrow[disabled] {
  opacity: 0;
  pointer-events: none;
}

/* ==================== Dot Indicators ==================== */
.carousel-dots {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 20px;
}
.carousel-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #D1D5DB;
  transition: all 0.3s;
  cursor: pointer;
}
.carousel-dot--active {
  background: #8B5CF6;
  width: 24px;
  border-radius: 4px;
}
```

```typescript
// ==================== Carousel Logic (React / Vanilla JS) ====================

// State
let currentIndex = 0;
const VISIBLE_COUNT = 3;  // Cards visible at once

function initCarousel() {
  const track = document.querySelector('.plans-carousel');
  const cards = document.querySelectorAll('.plan-card');
  const totalCards = cards.length;
  const maxIndex = Math.max(0, totalCards - VISIBLE_COUNT);

  const arrowLeft  = document.querySelector('.carousel-arrow--left');
  const arrowRight = document.querySelector('.carousel-arrow--right');
  const fadeLeft   = document.querySelector('.carousel-fade--left');
  const fadeRight  = document.querySelector('.carousel-fade--right');
  const dotsContainer = document.querySelector('.carousel-dots');

  // Generate dots (1 per scroll position)
  dotsContainer.innerHTML = '';
  for (let i = 0; i <= maxIndex; i++) {
    const dot = document.createElement('span');
    dot.className = `carousel-dot${i === 0 ? ' carousel-dot--active' : ''}`;
    dot.addEventListener('click', () => scrollToIndex(i));
    dotsContainer.appendChild(dot);
  }

  // Scroll to specific index
  function scrollToIndex(index: number) {
    currentIndex = Math.max(0, Math.min(index, maxIndex));
    const card = cards[currentIndex] as HTMLElement;
    track.scrollTo({ left: card.offsetLeft - track.offsetLeft, behavior: 'smooth' });
  }

  // Update UI after scroll
  function updateUI() {
    // Detect current position from scroll
    const scrollLeft = track.scrollLeft;
    const cardWidth = (cards[0] as HTMLElement).offsetWidth + 24; // card + gap
    currentIndex = Math.round(scrollLeft / cardWidth);
    currentIndex = Math.max(0, Math.min(currentIndex, maxIndex));

    // Arrows: hide when at boundary
    arrowLeft.disabled  = currentIndex === 0;
    arrowRight.disabled = currentIndex >= maxIndex;

    // Fades: show/hide based on position
    fadeLeft.style.opacity  = currentIndex > 0 ? '1' : '0';
    fadeRight.style.opacity = currentIndex < maxIndex ? '1' : '0';

    // Dots: update active
    dotsContainer.querySelectorAll('.carousel-dot').forEach((dot, i) => {
      dot.className = `carousel-dot${i === currentIndex ? ' carousel-dot--active' : ''}`;
    });
  }

  // Event listeners
  arrowLeft.addEventListener('click',  () => scrollToIndex(currentIndex - 1));
  arrowRight.addEventListener('click', () => scrollToIndex(currentIndex + 1));

  // Listen to native scroll (supports touch swipe + mouse wheel)
  let scrollTimeout: number;
  track.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = window.setTimeout(updateUI, 50); // debounce
  });

  // Keyboard navigation
  track.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft')  scrollToIndex(currentIndex - 1);
    if (e.key === 'ArrowRight') scrollToIndex(currentIndex + 1);
  });

  // Initial state
  updateUI();
}
```

### Responsive Breakpoints

| Breakpoint | Visible Cards | Behavior |
|---|---|---|
| **Desktop (>1024px)** | 3 cards + peek of 4th | Carousel arrows + dots + fade |
| **Tablet (768-1024px)** | 2 cards + peek of 3rd | Same carousel, `VISIBLE_COUNT = 2` |
| **Mobile (<768px)** | 1 card + peek of 2nd | Swipe-native, `VISIBLE_COUNT = 1`, dots only (no arrows) |

```css
/* Tablet */
@media (max-width: 1024px) {
  .plan-card {
    flex: 0 0 calc((100% - 24px - 40px) / 2);  /* 2 visible + peek */
    min-width: 260px;
  }
  .plan-card--popular { transform: scale(1.02); }
}

/* Mobile */
@media (max-width: 768px) {
  .plans-carousel-wrapper { padding: 0 16px; }
  .plan-card {
    flex: 0 0 calc(100% - 40px);                /* 1 visible + peek */
    min-width: 240px;
  }
  .plan-card--popular { transform: none; }
  .carousel-arrow { display: none; }             /* Swipe only */

  /* Sticky CTA at bottom */
  .mobile-sticky-cta {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    padding: 12px 16px;
    background: white;
    border-top: 1px solid #E5E7EB;
    box-shadow: 0 -4px 12px rgba(0,0,0,0.1);
    z-index: 50;
  }
}
```

### Yearly Toggle Behavior
When user switches to "รายปี":
1. Price animates from monthly → yearly (per month equivalent)
2. Show strikethrough on original monthly price
3. Show savings badge: "ประหยัด ฿X,XXX/ปี" in green
4. API provides `priceYearly`, `yearlySavings` automatically

### Scalability Note
Carousel รองรับ N plans โดยอัตโนมัติ:
- 3 plans = ไม่มี arrow/dots, แสดงครบ
- 4-7 plans = carousel active, เลื่อนได้
- ไม่ต้อง hardcode จำนวน — ใช้ `totalCards - VISIBLE_COUNT` คำนวณ `maxIndex`

---

## 8. API Response Mapping

```typescript
// GET /api/v1/plans response
interface PlanCard {
  id: string;
  code: string;           // "FREE" | "S" | "M" | "L"
  name: string;           // Display name
  subtitle: string;       // Marketing tagline
  description: string;    // Longer description
  targetAudience: string; // "โรงแรมขนาดเล็ก · เกสต์เฮาส์ · โฮสเทล 1-20 ห้อง"
  priceMonthly: number;   // 0 | 1990 | 4990 | 9990
  priceYearly?: number;   // Calculated yearly total
  yearlySavings?: number; // How much saved annually
  yearlyDiscountPercent?: number; // 10 | 15 | 20
  pricePerRoom?: string;  // "~฿100/ห้อง/เดือน"
  maxRooms: number;
  maxUsers: number;
  isPopular: boolean;     // true = Professional
  badge?: string;         // "คุ้มค่าที่สุด"
  highlightColor?: string; // "#8B5CF6"
  features: string[];     // Benefit-focused feature list
  buttonText: string;     // CTA button text
  addOnFeatures?: {       // Optional add-ons
    code: string;
    name: string;
    priceMonthly: number;
  }[];
}
```

---

## 9. A/B Testing Suggestions

### Test 1: CTA Text
- **A**: "เริ่มทดลองฟรี" (current)
- **B**: "เริ่มทดลองฟรี — ไม่มีค่าใช้จ่าย" (new, longer)
- **Metric**: Free trial sign-up rate

### Test 2: Professional Card Emphasis
- **A**: Same size, purple border only
- **B**: Scale 1.05 + gradient background + "แนะนำ" ribbon
- **Metric**: Professional plan selection rate

### Test 3: Price Anchoring
- **A**: Show priceMonthly only
- **B**: Show pricePerRoom prominently ("เริ่มต้น ฿50/ห้อง/เดือน")
- **Metric**: Overall conversion rate

### Test 6: Carousel vs Grid
- **A**: 3-visible carousel with peek (new design)
- **B**: 4-column grid no scroll (old design)
- **Metric**: Click-through on card 4 (Enterprise), overall engagement

### Test 4: Yearly Toggle Default
- **A**: Default monthly (current)
- **B**: Default yearly with monthly prices shown as strikethrough
- **Metric**: Average revenue per user (ARPU)

### Test 5: Social Proof Placement
- **A**: Below cards only
- **B**: Inline within Professional card ("เลือกโดย 60% ของผู้ใช้")
- **Metric**: Professional plan selection rate

---

## 10. Copy Principles Applied

| Before (Feature-listing) | After (Benefit-focused) |
|---|---|
| รองรับ 50 ห้อง | — (shown as maxRooms number, not a feature) |
| ระบบ Housekeeping | มอบหมายงาน Housekeeping อัตโนมัติ |
| รายงานเบื้องต้น | รายงานรายได้ + ยอดจองรายวัน |
| Channel Manager | Channel Manager เชื่อม OTA อัตโนมัติ |
| Priority Support | Priority Support ตอบภายใน 4 ชม. |
| ระบบจอง + Front Desk | จัดการจองออนไลน์ ลด no-show |
| Email Support | Email Support ตอบภายใน 24 ชม. |

**Rules**:
1. Every feature line tells the user what THEY GET, not what the system HAS
2. Include response time for support tiers (concrete = trustworthy)
3. Use "ลด X", "เพิ่ม Y", "อัตโนมัติ" to imply saved effort
4. First feature on paid plans = "ทุกฟีเจอร์ของ [previous plan] +" — progressive disclosure
