---
name: staysync-dev
description: |
  StaySync Hotel Management full-stack development skill. ใช้ทุกครั้งที่มีงาน dev ในโปรเจ็ค StaySync ไม่ว่าจะเป็น Backend (owner-hotel-services-api) หรือ Frontend (owner-hotel-services).

  Trigger เมื่อ:
  - "แก้ bug ใน StaySync", "fix issue", "แก้ error ใน rooms/bookings/guests/payments"
  - "เพิ่ม feature", "สร้าง endpoint ใหม่", "เพิ่ม module NestJS", "สร้าง page ใหม่ใน dashboard"
  - "ทำ migration", "แก้ schema", "เพิ่ม field ใน Prisma"
  - "refactor", "ลบ any type", "ลบ console.log", "clean up code"
  - "แก้ StaySync", "งานใน owner-hotel-services", "เพิ่ม API hotel"
  - "สร้าง NestJS module ใหม่สำหรับ StaySync", "เพิ่ม Next.js page ใน hotel dashboard"
  - พูดถึง rooms, bookings, guests, payments, housekeeping, restaurant, HR ใน context hotel

  ใช้ skill นี้ก่อนเริ่มงาน dev ทุกครั้ง เพื่อให้ได้ code ที่ตรงกับ conventions ของโปรเจ็ค
---

# StaySync Hotel Management — Dev Skill

StaySync เป็นระบบ Hotel Management SaaS แบบ Multi-tenant
- **Backend**: `owner-hotel-services-api/` — NestJS 10 + Prisma 5 + MySQL
- **Frontend**: `owner-hotel-services/` — Next.js 14 App Router + Zustand + Tailwind
- **GitHub root**: `/sessions/*/mnt/GitHub/` (หา path จริงด้วย `find /sessions/*/mnt/GitHub -name "deploy.sh" -maxdepth 1`)

---

## ก่อนเริ่มทำงาน

1. ระบุว่างานอยู่ใน **Backend**, **Frontend**, หรือทั้งคู่
2. อ่าน CLAUDE.md ของโปรเจ็คนั้นก่อนทุกครั้ง (มีรายละเอียด tech stack + conventions ครบ)
3. ถ้าแก้ Bug → อ่านไฟล์ที่เกี่ยวข้องก่อน อย่าสุ่มแก้
4. ถ้าเพิ่ม Feature → ดู module ที่ใกล้เคียงเป็น reference เช่น rooms module สำหรับ feature ที่คล้ายกัน

---

## Backend Conventions (NestJS + Prisma)

### Module Pattern
ทุก feature เป็น module แยกใน `src/modules/` หรือ `src/<feature>/`

โครงสร้างมาตรฐาน:
```
src/modules/<feature>/
├── dto/
│   ├── create-<feature>.dto.ts
│   └── update-<feature>.dto.ts
├── <feature>.controller.ts
├── <feature>.service.ts
└── <feature>.module.ts
```

### DTO — ต้องใช้ class-validator เสมอ
```typescript
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateXxxDto {
  @ApiProperty({ example: 'example-value' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  propertyId?: string;
}
```

### Service — Prisma + Logger + NestJS Exceptions
```typescript
@Injectable()
export class XxxService {
  private readonly logger = new Logger(XxxService.name);

  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string): Promise<Xxx[]> {
    // tenantId ต้องเสมอใน where clause — multi-tenant isolation!
    return this.prisma.xxx.findMany({ where: { tenantId } });
  }

  async findOne(id: string, tenantId: string): Promise<Xxx> {
    const record = await this.prisma.xxx.findFirst({ where: { id, tenantId } });
    if (!record) throw new NotFoundException(`Xxx ${id} not found`);
    return record;
  }
}
```

**กฎสำคัญ:**
- ใช้ `Prisma.<Model>CreateInput` / `Prisma.<Model>UpdateInput` แทน `any`
- ใช้ NestJS exceptions: `NotFoundException`, `BadRequestException`, `ConflictException`, `UnauthorizedException`
- ไม่มี `console.log` — ใช้ `this.logger.log()`, `this.logger.error()`, `this.logger.warn()` เสมอ
- ทุก query ต้องมี `tenantId` ใน where clause (ยกเว้น admin/platform endpoints)

### Controller Pattern
```typescript
@ApiTags('xxx')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'xxx', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class XxxController {
  constructor(private readonly xxxService: XxxService) {}

  @Get()
  @Roles('tenant_admin', 'manager', 'staff')
  @ApiOperation({ summary: 'Get all xxx' })
  findAll(@Query() query: FindXxxQueryDto, @CurrentUser() user: { tenantId?: string }) {
    return this.xxxService.findAll(user.tenantId);
  }
}
```

**Roles ที่ใช้ได้:** `platform_admin`, `tenant_admin`, `manager`, `staff`, `receptionist`, `housekeeper`

### เพิ่ม Module ใหม่
1. สร้างไฟล์ตาม structure ด้านบน
2. เพิ่ม module ใน `src/app.module.ts`
3. ถ้าต้องการ cross-module → export service ใน module.ts + import ใน module ปลายทาง

### Prisma Schema Changes → Migration
```bash
# 1. แก้ prisma/schema.prisma
# 2. สร้าง migration
cd owner-hotel-services-api
npx prisma migrate dev --name add_xxx_to_yyy

# 3. ถ้าใน Docker (production)
npx prisma migrate deploy
```

**กฎ Prisma:**
- ทุก model ที่เป็น tenant-scoped ต้องมี `tenantId String?`
- ID ใช้ `@id @default(uuid())`
- ต้องมี `createdAt DateTime @default(now())` และ `updatedAt DateTime @updatedAt`
- ใช้ `@@map("snake_case_table_name")` ทุกครั้ง

---

## Frontend Conventions (Next.js + Zustand)

### Page Pattern (App Router)
```typescript
// app/dashboard/xxx/page.tsx
'use client'
import { useEffect, useState } from 'react'
import { useXxxStore } from '@/lib/stores/xxxStore'
import { useAuthStore } from '@/lib/stores/authStore'

export default function XxxPage() {
  const { user } = useAuthStore()
  const { items, isLoading, fetchItems } = useXxxStore()

  useEffect(() => {
    if (user?.tenantId) fetchItems(user.tenantId)
  }, [user?.tenantId])

  if (isLoading) return <LoadingSkeleton />

  return (
    <div className="p-6">
      {/* content */}
    </div>
  )
}
```

### Component Pattern
```typescript
// components/Xxx/XxxCard.tsx
interface XxxCardProps {
  item: Xxx            // ห้ามใช้ any — ใช้ type จาก lib/types/index.ts
  onEdit: () => void
}

// ห้ามใช้ React.FC — ใช้ function ธรรมดา
export function XxxCard({ item, onEdit }: XxxCardProps) {
  return (...)
}
```

### Zustand Store Pattern
```typescript
// lib/stores/xxxStore.ts
import { create } from 'zustand'
import { api } from '@/lib/api/client'

interface XxxState {
  items: Xxx[]
  isLoading: boolean
  error: string | null
}
interface XxxActions {
  fetchItems: (tenantId: string) => Promise<void>
}

export const useXxxStore = create<XxxState & XxxActions>()((set) => ({
  items: [],
  isLoading: false,
  error: null,
  fetchItems: async (tenantId) => {
    set({ isLoading: true, error: null })
    try {
      const data = await api.xxx.findAll(tenantId)
      set({ items: data, isLoading: false })
    } catch (error) {
      set({ error: 'Failed to load', isLoading: false })
    }
  },
}))
```

### API Client
เพิ่ม endpoint ใน `lib/api/client.ts`:
```typescript
// ภายใน api object
xxx: {
  findAll: (tenantId: string) => get<Xxx[]>(`/xxx?tenantId=${tenantId}`),
  findOne: (id: string) => get<Xxx>(`/xxx/${id}`),
  create: (data: CreateXxxDto) => post<Xxx>('/xxx', data),
  update: (id: string, data: UpdateXxxDto) => patch<Xxx>(`/xxx/${id}`, data),
  delete: (id: string) => del(`/xxx/${id}`),
},
```

**กฎ Frontend:**
- ไม่ hardcode API URL — ใช้ `process.env.NEXT_PUBLIC_API_URL`
- Error/loading states ต้องจัดการเสมอ
- ไม่ใช้ `console.log` ใน production — ลบออกหรือ wrap ด้วย `if (process.env.NODE_ENV === 'development')`
- Form validation ใช้ Zod schema
- UI components ใช้จาก `components/ui/` (custom, ไม่ใช่ shadcn)
- Tailwind classes: ใช้ purple-based theme ของ StaySync (`primary-600`, `primary-700`)

---

## Refactoring Guide

### แก้ `any` types ใน Backend
```typescript
// ❌ ก่อน
const data: any = { price: dto.price, tenantId };

// ✅ หลัง
const data: Prisma.RoomCreateInput = {
  price: new Prisma.Decimal(dto.price),
  tenantId,
};
```

### แก้ `query: any` ใน Controller
```typescript
// ❌ ก่อน
findAll(@Query() query: any) {}

// ✅ หลัง — สร้าง DTO
export class FindXxxQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @Type(() => Number) @IsInt() page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() limit?: number = 10;
}

findAll(@Query() query: FindXxxQueryDto) {}
```

### ลบ console.log + เพิ่ม Logger (Backend)
```typescript
// ❌ ก่อน
console.log('User found:', user);
console.error('Error:', error);

// ✅ หลัง
this.logger.log(`User found: ${user.id}`);
this.logger.error(`Error in findOne: ${error.message}`, error.stack);
```

---

## Bug Fix Workflow

1. อ่าน error message ให้ละเอียด
2. ค้นหาไฟล์ที่เกี่ยวข้อง: `grep -rn "ErrorText" src/`
3. ตรวจสอบ Prisma schema ว่า field ตรงกับที่ใช้ใน service หรือไม่
4. ตรวจ multi-tenant isolation: ทุก query ต้องมี `tenantId`
5. ตรวจ DTO validation: field ที่ส่งมาตรงกับ DTO ที่ define ไว้ไหม
6. แก้แล้วทำ `npm run build` ตรวจ compile errors

---

## Docker Dev Environment

```bash
# รัน stack ทั้งหมด (จาก GitHub root)
cd /path/to/GitHub
docker compose -f docker-compose.dev.yml up --build

# Port:
# 9010 → Frontend (Next.js)
# 9011 → Backend (NestJS API)
# 9012 → MySQL
# 9013 → Redis
# 9014 → Adminer (DB admin UI)
```

---

## ข้อควรระวัง (Security)

- **ห้าม commit .env** — มีใน .gitignore แล้ว
- **ห้าม hardcode JWT_SECRET** ใน docker-compose — ใช้ `${JWT_SECRET:?must be set}`
- **ทุก endpoint ต้อง `@UseGuards(JwtAuthGuard)`** ยกเว้น public endpoints ที่ mark `@Public()`
- **tenantId isolation** — ทุก query ใน tenant-scoped service ต้องกรองด้วย tenantId
