# Technical Design Document
## Plan-Addons Integration Fix

**Version:** 1.0
**Date:** 2026-05-10
**Author:** Engineering
**Status:** Draft — Ready for Implementation
**Reviewers:** Backend Lead, Frontend Lead, Product

---

## 1. Overview

### 1.1 Goal
ทำให้ Add-ons ที่ Admin ผูกเข้ากับ Plan ผ่านหน้า `/admin/plans` (ปุ่ม "จัดการ Add-ons") ส่งผลในทุกชั้น:

1. **Sales page (`/pricing`)** — แสดง Add-ons ที่รวมในแผนนั้น
2. **Customer signup** — ลูกค้าที่สมัครแผนได้สิทธิ์ใช้ Add-ons เหล่านั้นทันที
3. **Runtime entitlement (`AddonGuard`)** — endpoint ที่ป้องกันด้วย `@RequireAddon('POS_MODULE')` ปล่อยผ่านสำหรับ tenant ที่อยู่แผนซึ่งรวม `POS_MODULE`

### 1.2 Background
ระบบปัจจุบันมีตารางหลัก 5 ตารางที่เกี่ยวข้องกับ entitlement:

```
features ─────┬─→ plan_features ─────┐
              └─→ subscription_features ─┐
                                         ├─→ AddonService.getActiveAddons()
                                         │   (ใช้โดย AddonGuard)
add_ons ─────────→ plan_addons ─────────×  ← จุดที่ขาดการเชื่อม
                   (เพิ่มใหม่ในรอบที่แล้ว)
```

`plan_addons` ถูกสร้างขึ้นเพื่อให้ Admin จัดการได้ใน UI แต่ "ไม่มีใครอ่านมัน" — ทั้ง public sales endpoint และ entitlement engine ไม่รู้จักตารางนี้

### 1.3 Out of Scope
- ไม่รวมการรวม `features` กับ `add_ons` เข้าด้วยกัน — ทั้งสองยังอยู่แยกกันโดยตั้งใจ (`features` = ความสามารถระดับ system, `add_ons` = โมดูลที่ขายเป็นแพ็กเกจ)
- ไม่เปลี่ยน schema ของตาราง `add_ons` หรือ `features`
- ไม่ทำ migration ของข้อมูลเก่า (ทุกแผนเริ่มที่ 0 add-ons จนกว่า Admin จะ assign)

---

## 2. System Architecture

### 2.1 Component Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                          Frontend Layer                            │
├──────────────────────────────────────────────────────────────────┤
│  /admin/plans          │  /pricing            │  Tenant App      │
│  PlanAddonManager ✓    │  PricingCard         │  Sidebar (modules)│
│                        │  AddonSelector       │                   │
└────────┬───────────────┴──────────┬───────────┴──────────┬───────┘
         │                          │                      │
         ▼                          ▼                      ▼
┌──────────────────────────────────────────────────────────────────┐
│                          API Layer                                 │
├──────────────────────────────────────────────────────────────────┤
│  AdminPlanAddonsController ✓ │ PlansController       │ AddonGuard │
│  /admin/plans/:id/addons     │ /api/v1/plans         │ runtime   │
└────────┬─────────────────────┴──────────┬─────────────┴────┬─────┘
         │                                │                  │
         ▼                                ▼                  ▼
┌──────────────────────────────────────────────────────────────────┐
│                       Service Layer                                │
├──────────────────────────────────────────────────────────────────┤
│  AdminPlanAddonsService ✓ │ PlansService    │ AddonService        │
│  (CRUD on plan_addons)    │ findAll/findOne │ getActiveAddons()   │
└────────┬──────────────────┴────────┬───────┴────────────┬────────┘
         │                           │                    │
         ▼                           ▼                    ▼
┌──────────────────────────────────────────────────────────────────┐
│                       Database (Prisma)                            │
├──────────────────────────────────────────────────────────────────┤
│  plans ─┬─→ plan_features → features                              │
│         └─→ plan_addons   → add_ons    ← NEW connection          │
│  subscriptions → subscription_features → features                 │
└──────────────────────────────────────────────────────────────────┘
```

✓ = ทำเสร็จในรอบที่แล้ว
× = จุดที่ design นี้ต้องเชื่อม

### 2.2 Data Flow After Fix

**Flow A — Sales Page Listing**
```
Customer → GET /api/v1/plans
        → PlansService.findAll() — include plan_addons + plan_features
        → PlansController map ผนวก add_ons เข้า response DTO
        → Frontend แสดงในการ์ด + AddonSelector แสดงเป็น "✓ รวมในแผนแล้ว"
```

**Flow B — Tenant Entitlement Check**
```
Tenant request /restaurant/menu @RequireAddon('POS_MODULE')
        → AddonGuard.canActivate()
        → AddonService.hasActiveAddon(tenantId, 'POS_MODULE')
        → getActiveAddons() union 3 sources:
              ├─ plan_features → features.code (existing)
              ├─ plan_addons   → add_ons.code  (NEW)
              └─ subscription_features → features.code (existing)
        → ถ้า POS_MODULE ใน set → 200 OK
```

**Flow C — Admin Assigns Add-on**
```
Admin → PlanAddonManager → POST /admin/plans/:id/addons
     → AdminPlanAddonsService.assignAddonToPlan()
     → INSERT plan_addons row
     → AddonService.invalidateAddonCacheForPlan(planId) ✓ (ทำแล้ว)
     → ทุก tenant ในแผนนั้น cache miss ครั้งถัดไป → ดึงสิทธิ์ใหม่
```

---

## 3. Database Design

### 3.1 ไม่มี Schema Change
Migration `20260510120000_add_plan_addons_table` ที่สร้างไปแล้วเพียงพอ

### 3.2 ความสัมพันธ์ที่ต้องทำให้ Prisma รู้
```
plans
├── plan_features  (existing)  — used in entitlement
└── plan_addons    (existing)  — NEW: ต้อง include ใน query

add_ons
└── plan_addons    (existing)  — back-reference เพื่อ join
```

### 3.3 ไม่ต้อง Index เพิ่ม
Index `IDX_plan_addons_plan_id` ใน migration เดิมเพียงพอสำหรับ lookup pattern `WHERE plan_id = ?`

---

## 4. API Design

### 4.1 Public Endpoint — `GET /api/v1/plans`

**เดิม:** `addOnFeatures` มาจาก `plan_features` เท่านั้น

**ใหม่:** เพิ่ม field ใหม่ `includedAddOns` แยกออกจาก `addOnFeatures` (ป้องกัน semantic ปนกัน)

**Request:** ไม่เปลี่ยน

**Response เพิ่ม field:**
```json
{
  "data": [
    {
      "id": "uuid",
      "code": "M",
      "name": "Professional",
      "priceMonthly": 4990,
      "addOnFeatures": [
        { "code": "advanced_reports", "name": "Advanced Reports", "priceMonthly": 0 }
      ],
      "includedAddOns": [
        {
          "id": "uuid",
          "code": "POS_MODULE",
          "name": "POS System",
          "description": "ระบบ POS ครบวงจร",
          "price": 790,
          "billingCycle": "monthly",
          "category": "Restaurant",
          "icon": "shopping-cart"
        }
      ]
    }
  ],
  "total": 4
}
```

**Errors:** ไม่เปลี่ยน

### 4.2 Admin Endpoints — ไม่เปลี่ยน
`/admin/plans/:id/addons` (GET/POST/DELETE) ที่สร้างไปแล้วใช้งานต่อได้

### 4.3 Tenant Sidebar / Modules Endpoint — ไม่เปลี่ยน Surface
Endpoint ที่อยู่หลัง `AddonGuard` ไม่ต้องแก้ — แค่แก้ logic ภายใน `getActiveAddons()` เท่านั้น

---

## 5. Service Layer Changes

### 5.1 `PlansService` — `src/plans/plans.service.ts`

**Files affected:** 1 file
**Lines changed:** ~12 lines (3 methods × 4 lines)

```typescript
// findAll / findOne / findByCode — เพิ่ม include
return this.prisma.plans.findMany({
  where: { is_active: 1 },
  include: {
    plan_features: { include: { features: true } },
    plan_addons: { include: { add_ons: true } },  // ← NEW
  },
  orderBy: [{ display_order: 'asc' }, { price_monthly: 'asc' }],
});
```

### 5.2 `PlansController` — `src/plans/plans.controller.ts`

**Files affected:** 1 file
**Lines changed:** ~30 lines (refactor + เพิ่ม mapping)

**Action:** Extract mapping เป็น helper function (ลด duplicate ระหว่าง findAll/findOne) แล้วเพิ่ม mapping ของ `includedAddOns`

```typescript
private mapPlanToPublicDto(plan): PublicPlanDto {
  // ... mapping เดิม ...
  const includedAddOns: PublicPlanAddonDto[] =
    plan.plan_addons?.map((pa) => ({
      id: pa.add_ons.id,
      code: pa.add_ons.code,
      name: pa.add_ons.name,
      description: pa.add_ons.description ?? undefined,
      price: Number(pa.add_ons.price ?? 0),
      billingCycle: pa.add_ons.billing_cycle,
      category: pa.add_ons.category ?? undefined,
      icon: pa.add_ons.icon ?? undefined,
    })) ?? [];

  return {
    // ... field อื่นๆ เดิม ...
    addOnFeatures: addOnFeatures.length > 0 ? addOnFeatures : undefined,
    includedAddOns: includedAddOns.length > 0 ? includedAddOns : undefined,
  };
}
```

### 5.3 `PublicPlanDto` — `src/plans/dto/public-plans.dto.ts`

**Files affected:** 1 file
**Lines changed:** ~20 lines (เพิ่ม DTO ใหม่)

```typescript
export class PublicPlanAddonDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ example: 'POS_MODULE' })
  code: string;

  @ApiProperty({ example: 'POS System' })
  name: string;

  @ApiPropertyOptional({ example: 'ระบบ POS ครบวงจร' })
  description?: string;

  @ApiProperty({ example: 790 })
  price: number;

  @ApiProperty({ example: 'monthly', enum: ['monthly', 'yearly', 'one_time'] })
  billingCycle: string;

  @ApiPropertyOptional({ example: 'Restaurant' })
  category?: string;

  @ApiPropertyOptional({ example: 'shopping-cart' })
  icon?: string;
}

export class PublicPlanDto {
  // ... ฟิลด์เดิม ...

  @ApiPropertyOptional({
    type: [PublicPlanAddonDto],
    description: 'Add-ons included with this plan (no extra charge)',
  })
  includedAddOns?: PublicPlanAddonDto[];
}
```

### 5.4 `AddonService.getActiveAddons()` — ⚠️ Critical Fix

**File:** `src/modules/addons/addon.service.ts` (lines ~110–186)
**Lines changed:** ~25 lines

```typescript
async getActiveAddons(tenantId: string): Promise<AddonStatus[]> {
  return this.cacheService.getOrSet<AddonStatus[]>(
    `${tenantId}:all`,
    async () => {
      const subscription = await this.prisma.subscriptions.findFirst({
        where: { tenant_id: tenantId, status: { in: [...this.ENTITLEMENT_STATUSES] } },
        orderBy: { created_at: 'desc' },
        include: {
          plans_subscriptions_plan_idToplans: {
            include: {
              plan_features: {
                include: { features: { select: { code, name, type, is_active } } },
              },
              plan_addons: {  // ← NEW
                include: {
                  add_ons: { select: { code: true, name: true, is_active: true } },
                },
              },
            },
          },
          subscription_features: {
            where: { is_active: 1 },
            include: { features: { select: { code, name, type, is_active } } },
          },
        },
      });

      if (!subscription) return [];
      const merged = new Map<string, AddonStatus>();
      const plan = subscription.plans_subscriptions_plan_idToplans;

      // 1) Plan-level features (existing)
      for (const pf of plan?.plan_features ?? []) {
        const f = pf.features;
        if (!f || f.type !== 'module' || f.is_active !== 1) continue;
        merged.set(f.code, { code: f.code, name: f.name, isActive: true,
                            expiresAt: null, source: 'plan' });
      }

      // 2) Plan-level add-ons (NEW) — bypass type check; add_ons ทุกตัวคือ module
      for (const pa of plan?.plan_addons ?? []) {
        const a = pa.add_ons;
        if (!a || a.is_active !== 1) continue;
        if (merged.has(a.code)) continue;  // dedupe กับ features
        merged.set(a.code, { code: a.code, name: a.name, isActive: true,
                             expiresAt: null, source: 'plan' });
      }

      // 3) Subscription-level standalone (existing)
      for (const sf of subscription.subscription_features) {
        const f = sf.features;
        if (!f || f.type !== 'module' || f.is_active !== 1) continue;
        if (merged.has(f.code)) continue;
        merged.set(f.code, { code: f.code, name: f.name, isActive: true,
                             expiresAt: null, source: 'subscription' });
      }

      return Array.from(merged.values());
    },
    { ttl: this.CACHE_TTL, namespace: this.CACHE_NS },
  );
}
```

**Dedupe priority:**
1. Plan features (ลำดับสูงสุด)
2. Plan add-ons
3. Subscription standalone (ลำดับต่ำสุด — override โดย plan ได้)

---

## 6. Frontend Changes

### 6.1 Type Update — `lib/api/types.ts`

```typescript
export interface PublicPlanAddon {
  id: string;
  code: string;
  name: string;
  description?: string;
  price: number;
  billingCycle: 'monthly' | 'yearly' | 'one_time';
  category?: string;
  icon?: string;
}

export interface PublicPlan {
  // ... ฟิลด์เดิม ...
  addOnFeatures?: PublicPlanFeature[];
  includedAddOns?: PublicPlanAddon[];  // ← NEW
}
```

### 6.2 Pricing Page — `app/pricing/page.tsx`

**Changes:**
1. อ่าน `selectedPlanData.includedAddOns` แทน fallback ไป catalog
2. ส่งให้ `AddonSelector` พร้อมธง `isIncluded: true`

```typescript
const includedAddOns = selectedPlanData?.includedAddOns ?? []
const includedCodes = new Set(includedAddOns.map(a => a.code))

const addonsForPlan: PublicPlanAddon[] = useMemo(() => {
  // เริ่มจาก catalog ทั้งหมด แล้ว mark ตัวที่ included
  return catalogAddons.map(addon => ({
    ...addon,
    isIncluded: includedCodes.has(addon.code),
  }))
}, [catalogAddons, includedCodes])
```

### 6.3 AddonSelector — `components/pricing/AddonSelector.tsx`

**Changes:** เพิ่ม visual state สำหรับ "รวมในแผนแล้ว"

```tsx
{addons.map(addon => (
  <div className={addon.isIncluded ? 'bg-green-50 border-green-300' : ''}>
    {addon.isIncluded ? (
      <div className="flex items-center gap-2">
        <Check className="w-4 h-4 text-green-600" />
        <span className="text-green-800 font-medium">รวมในแผนแล้ว</span>
      </div>
    ) : (
      <Checkbox
        checked={selected.includes(addon.id)}
        onChange={() => toggle(addon.id)}
      />
    )}
  </div>
))}
```

**Pricing logic:** Add-ons ที่ `isIncluded` ไม่ถูกบวกเข้า total — ราคาแพ็กเกจรวมอยู่แล้วใน `priceMonthly` ของแผน

### 6.4 PricingCard — `components/pricing/PricingCard.tsx`

**Changes (optional, polish):** แสดง list ของ included add-ons ในการ์ด

```tsx
{plan.includedAddOns && plan.includedAddOns.length > 0 && (
  <div className="mt-4 pt-4 border-t">
    <p className="text-xs font-semibold text-gray-700 mb-2">
      รวม Add-ons:
    </p>
    <ul className="space-y-1">
      {plan.includedAddOns.map(a => (
        <li key={a.id} className="flex items-center gap-2 text-sm">
          <Check className="w-4 h-4 text-green-600" />
          {a.name}
        </li>
      ))}
    </ul>
  </div>
)}
```

### 6.5 Admin Plan Card (Optional Polish) — `app/admin/plans/page.tsx`

แสดง count badge เพิ่ม:
```tsx
{plan.addonCount !== undefined && (
  <div className="flex items-center gap-2 text-sm text-gray-700">
    <Puzzle className="w-4 h-4 text-gray-400" />
    <span>Add-ons: {plan.addonCount} รายการ</span>
  </div>
)}
```

ต้องเพิ่ม `addonCount` ใน `AdminPlansService.findAll()` (Prisma include `_count: { plan_addons: true }`)

---

## 7. Business Logic / Rules

### 7.1 Validation Rules

| Rule | Source | Behavior |
|------|--------|----------|
| Add-on code ต้อง active | `add_ons.is_active === 1` | ถ้า inactive → ไม่ส่งออก public, ไม่ให้สิทธิ์ |
| Plan ต้อง active | `plans.is_active === 1` | ถ้า inactive → ไม่ขึ้นบน sales page |
| Subscription ต้อง active หรือ trial | ENTITLEMENT_STATUSES | กลุ่มอื่น (cancelled/expired) ไม่ได้สิทธิ์ |
| Dedupe by code | feature wins over addon wins over subscription | ตามลำดับใน section 5.4 |

### 7.2 Edge Cases

| Case | Handling |
|------|----------|
| Add-on ที่ assign แล้วถูก soft-delete | `is_active === 0` → guard 403 ทันที (cache 5 นาที) |
| Plan ถูก deactivate | Tenants ใน plan หมดสิทธิ์เมื่อ subscription expire/renew |
| Add-on code ซ้ำกับ feature code | feature ชนะ (ลำดับ 1 ใน merge) — ไม่ break |
| Tenant ไม่มี subscription | `getActiveAddons` คืน `[]` → ทุก gated endpoint 403 |
| Trial plan + plan_addons | Trial users ได้สิทธิ์ Add-ons ตามที่ admin assign — ตรงกับเจตนาเดิมของ trial = full access |

### 7.3 Error Handling

| Case | HTTP Status | Message |
|------|-------------|---------|
| Plan not found ใน admin endpoint | 404 | `Plan with ID "..." not found` |
| Add-on not found | 404 | `Add-on with ID "..." not found` |
| Duplicate assign | 409 | `Add-on "..." is already assigned to this plan` |
| Remove non-existent assignment | 404 | `Add-on "..." is not assigned to this plan` |

---

## 8. Security Considerations

- **AuthZ:** Admin endpoints ใช้ `@Roles('platform_admin')` แล้ว — ไม่ต้องแก้
- **Input validation:** `AssignAddonToPlanDto.addonId` ใช้ `IsString` แล้ว — เพิ่ม `IsUUID()` ได้ถ้าต้องการ
- **Cache poisoning:** Cache key ใช้ `tenantId` เป็น namespace — ไม่ leak cross-tenant
- **SQL injection:** ใช้ Prisma parameterized queries ทั้งหมด

---

## 9. Performance Considerations

### 9.1 Query Cost
- `getActiveAddons` เพิ่ม 1 join (plan_addons → add_ons) ใน existing query — n+1 ไม่เกิดเพราะใช้ Prisma `include` ครั้งเดียว
- Cache TTL 5 นาที (เดิม) ไม่เปลี่ยน

### 9.2 Cache Invalidation
- Assign/remove → `invalidateAddonCacheForPlan()` ลบ cache ทุก tenant ในแผนนั้น (เดิมก็ทำแล้วสำหรับ features)
- Public plans endpoint **ไม่ cache ที่ backend** — frontend อาจ cache ผ่าน Next.js (ตรวจ `dynamic = 'force-dynamic'`)

### 9.3 Worst Case
- Plan ที่มี 50 add-ons + 50 features = 100 entries ใน Map → ไม่มีปัญหา
- ทำ index แล้วใน migration เดิม

---

## 10. Testing Strategy

### 10.1 Unit Tests (เพิ่มใหม่)

**File:** `src/modules/addons/addon.service.spec.ts`

| Test Case | Expected |
|-----------|----------|
| `getActiveAddons` — tenant on plan with `plan_addons` only | คืน add-on codes ที่ assign |
| `getActiveAddons` — tenant on plan with both features and addons | union ทั้งสอง, dedupe ตาม priority |
| `getActiveAddons` — addon `is_active = 0` | ไม่อยู่ใน result |
| `getActiveAddons` — feature `type !== 'module'` | ไม่อยู่ใน result (rule เดิม) |
| `getActiveAddons` — addon code ชนกับ feature code | feature wins, source = 'plan' |

### 10.2 Integration Tests

**File:** `src/integration/plan-addon-entitlement.spec.ts` (สร้างใหม่)

```
Scenario: Admin assigns POS_MODULE to FREE plan, then tenant signs up
  Given: FREE plan exists, POS_MODULE add-on is active in catalog
  When:  POST /admin/plans/:freePlanId/addons { addonId: posModuleId }
  And:   POST /onboarding/register (creates trial subscription on FREE plan)
  Then:  GET /api/v1/plans → response.data[freePlan].includedAddOns contains POS_MODULE
  And:   GET /restaurant/menu (with new tenant token) → 200 OK (not 403)
```

### 10.3 Manual Smoke Test

| Step | Expected Result |
|------|-----------------|
| 1. ไปหน้า `/admin/plans` กด "จัดการ Add-ons" บนแผน FREE | Modal เปิด แสดง catalog |
| 2. กดเพิ่ม POS System | Card เลื่อนไป assigned section |
| 3. ไปหน้า `/pricing` (incognito) เลือกแผน FREE | เห็น "รวม: POS System" ในการ์ด |
| 4. AddonSelector แสดง POS System | มาร์ก "✓ รวมในแผนแล้ว", disabled |
| 5. สมัครใหม่บน FREE plan | Tenant ได้รับ trial subscription |
| 6. Login เป็น tenant ใหม่ → เปิด `/restaurant` | เข้าได้ (ไม่ใช่ 403) |
| 7. กลับไป admin ลบ POS จากแผน | ภายใน 5 นาที tenant ถูก 403 ใน `/restaurant` |

### 10.4 Regression Tests

- `getActiveAddons` กับ plan ที่ไม่มี `plan_addons` (มีแค่ features เดิม) → result เหมือนเดิม
- `/api/v1/plans` ไม่ส่ง `includedAddOns` field ออกถ้า plan ไม่มี add-ons → optional field
- AddonGuard 403 message ไม่เปลี่ยน

---

## 11. Implementation Order

### Phase 1 — Backend Core (Day 1, ~2 ชม.)
1. ✏️ `PlansService` — เพิ่ม `include: { plan_addons: ... }` 3 method
2. ✏️ `PublicPlanDto` — เพิ่ม `PublicPlanAddonDto` + field `includedAddOns`
3. ✏️ `PlansController` — refactor mapping → helper, เพิ่ม `includedAddOns`
4. ✅ Test: curl `/api/v1/plans` เห็น `includedAddOns` ในแผนที่มี add-ons

### Phase 2 — Entitlement Engine (Day 1, ~1.5 ชม.) ⚠️ Critical
5. ✏️ `AddonService.getActiveAddons()` — เพิ่ม include `plan_addons` + branch ใหม่
6. ✏️ Unit test 5 cases ตาม section 10.1
7. ✅ Manual: assign POS_MODULE → tenant ได้สิทธิ์

### Phase 3 — Frontend (Day 2, ~3 ชม.)
8. ✏️ `lib/api/types.ts` — เพิ่ม `PublicPlanAddon` + field
9. ✏️ `app/pricing/page.tsx` — อ่าน `includedAddOns`, mark catalog items
10. ✏️ `AddonSelector.tsx` — visual state "รวมในแผนแล้ว" + ไม่บวกเข้า total
11. ✏️ `PricingCard.tsx` (polish) — list included add-ons ในการ์ด
12. ✅ Visual review บน `/pricing`

### Phase 4 — Admin UX Polish (Day 2, ~1 ชม.)
13. ✏️ `AdminPlansService.findAll/findOne` — เพิ่ม `_count: { plan_addons }` ใน query (ใช้ TypeORM relation count, ไม่ใช่ Prisma)
14. ✏️ `AdminPlanItemDto` + `PlanResponseDto` — เพิ่ม `addonCount`
15. ✏️ `app/admin/plans/page.tsx` — แสดง "Add-ons: N รายการ" ในการ์ด

### Phase 5 — Verification (Day 2, ~1 ชม.)
16. รัน `npm test` ทั้ง backend + frontend
17. Manual smoke test ตาม section 10.3
18. ตรวจ Swagger doc ว่า `includedAddOns` ขึ้นถูกต้อง

**Total estimate:** 1.5 working days

---

## 12. Deployment Notes

### 12.1 Migration
Migration `20260510120000_add_plan_addons_table` ส่งไปแล้วในรอบก่อน — ไม่ต้องเพิ่มใหม่

```bash
cd owner-hotel-services-api
npx prisma migrate deploy
npx prisma generate   # ⚠️ ต้องรันหลัง migrate ให้ Prisma client รู้จัก plan_addons
```

### 12.2 Cache
หลัง deploy:
- Redis cache namespace `addon` จะ self-heal ภายใน 5 นาที
- ถ้าต้องการบังคับ refresh ทั้งระบบ: `redis-cli KEYS "addon:*" | xargs redis-cli DEL`

### 12.3 Feature Flag
ไม่จำเป็น — การเพิ่ม include + branch ใหม่ใน `getActiveAddons` เป็น additive (ไม่ break case ที่ `plan_addons` ว่าง)

### 12.4 Rollback Plan
ถ้าพบปัญหาใน production:
1. Revert commit ที่แก้ `AddonService.getActiveAddons()` (ลำดับสำคัญที่สุด — ส่งผลต่อ guard)
2. Revert `PlansService` + `PlansController` (ทำ public endpoint กลับไปแบบเดิม)
3. ตาราง `plan_addons` ค้างอยู่ในฐานข้อมูล แต่ไม่มีใครอ่าน → ปลอดภัย

---

## 13. Open Questions

| # | คำถาม | เจ้าของ | สถานะ |
|---|------|--------|------|
| 1 | Add-on ที่ included ในแผนมี billingCycle ที่ไม่ใช่ monthly (เช่น yearly) จะ pro-rate ยังไง? | Product | Pending |
| 2 | ควรปล่อยให้ admin assign add-on ที่ `is_active = 0` ได้ไหม? (ปัจจุบัน: ใช่) | Product | Pending |
| 3 | ต้องการ audit log ของ assign/remove plan_addons ไหม? | Engineering | Pending |
| 4 | Frontend `/pricing` ต้องแยก section "Included" จาก "Optional" add-ons แบบเด่นชัดไหม? | UX | Pending |

---

## 14. Acceptance Criteria

Implementation จะถือว่าเสร็จเมื่อ:

- [ ] `GET /api/v1/plans` ส่ง field `includedAddOns` สำหรับแผนที่มี add-ons
- [ ] หน้า `/pricing` แสดง add-ons ที่รวมในแผนเป็น "✓ รวมในแผนแล้ว" ใน AddonSelector
- [ ] หน้า `/pricing` ไม่บวกราคา add-ons ที่ included เข้า total
- [ ] Tenant ที่อยู่บนแผนซึ่งรวม `POS_MODULE` เข้า `/restaurant/*` ได้ทันทีหลังสมัคร (ไม่ต้องไปจ่ายเพิ่ม)
- [ ] Admin ลบ add-on จากแผน → tenant ที่อยู่แผนนั้นถูก 403 ภายใน 5 นาที
- [ ] Admin Plan card แสดง count badge "Add-ons: N รายการ"
- [ ] Unit tests ผ่านทั้ง 5 cases ใน section 10.1
- [ ] Manual smoke test 7 ขั้นตอนใน section 10.3 ผ่าน
- [ ] Swagger UI แสดง `PublicPlanAddonDto` schema ถูกต้อง

---

## 15. Appendix

### 15.1 Files Touched (ประมาณ)

**Backend (5 files):**
1. `src/plans/plans.service.ts` — +6 lines
2. `src/plans/plans.controller.ts` — refactor mapping (~30 lines)
3. `src/plans/dto/public-plans.dto.ts` — +25 lines
4. `src/modules/addons/addon.service.ts` — +20 lines (critical)
5. `src/admin/admin-plans.service.ts` — +5 lines (count badge)
6. `src/admin/dto/admin-plans.dto.ts` — +3 lines (addonCount field)

**Frontend (4 files):**
1. `lib/api/types.ts` — +15 lines
2. `app/pricing/page.tsx` — ~10 lines
3. `components/pricing/AddonSelector.tsx` — ~15 lines (visual state)
4. `components/pricing/PricingCard.tsx` — ~12 lines (polish)
5. `app/admin/plans/page.tsx` — ~6 lines (count badge)

**Tests (2 files ใหม่):**
1. `src/modules/addons/addon.service.spec.ts` — 5 new test cases
2. `src/integration/plan-addon-entitlement.spec.ts` — 1 integration scenario

**Total:** ~10 ไฟล์ที่แก้ + 2 ไฟล์ test ใหม่ + 0 migration ใหม่

### 15.2 Reference

- Migration ที่สร้างไปแล้ว: `prisma/migrations/20260510120000_add_plan_addons_table/migration.sql`
- Prisma schema: `prisma/schema.prisma` (model `plan_addons` + relations บน `plans` และ `add_ons`)
- Admin endpoints (มีอยู่แล้ว): `src/admin/admin-plan-addons.controller.ts`
- Admin service (มีอยู่แล้ว): `src/admin/admin-plan-addons.service.ts`
