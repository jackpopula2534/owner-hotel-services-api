# 🏗️ Architecture Recommendation: Monolith vs Separate Frontend/Backend

## 📊 สถานการณ์ปัจจุบัน

**Frontend (Next.js):**
- ✅ App Router with API Routes
- ✅ Server-side rendering
- ✅ API endpoints ใน `/app/api/`
- ✅ Database access ผ่าน Prisma
- ✅ Authentication ใน Next.js

**Backend (ที่วางแผน):**
- 🔄 NestJS (อีกโปรเจคหนึ่ง)
- 🔄 Separate API server

---

## 🤔 คำถาม: ควรแยก Frontend/Backend หรือไม่?

### ✅ **แนะนำ: แยก Frontend/Backend** (สำหรับระบบโรงแรม)

**เหตุผล:**

1. **Scalability**
   - Frontend และ Backend scale แยกกันได้
   - สามารถ deploy frontend หลาย instance
   - Backend สามารถ scale ตาม load

2. **Team Collaboration**
   - Frontend team และ Backend team ทำงานแยกกันได้
   - ไม่ต้องรอกัน
   - Code review แยกกัน

3. **Technology Flexibility**
   - Frontend: Next.js (React)
   - Backend: NestJS (Node.js/TypeScript)
   - Database: PostgreSQL
   - แต่ละส่วนเลือก technology stack ได้อิสระ

4. **Security**
   - Backend API ไม่ expose frontend code
   - API keys, secrets อยู่ที่ backend เท่านั้น
   - Better security boundaries

5. **Performance**
   - Backend สามารถ optimize สำหรับ API
   - Frontend สามารถ optimize สำหรับ UI
   - Caching strategies แยกกัน

6. **Microservices Ready**
   - พร้อมสำหรับการแยกเป็น microservices ในอนาคต
   - แต่ละ service deploy อิสระ

---

## 🏛️ Recommended Architecture

### Option 1: Separate Projects (Recommended)

```
owner-hotel-services/          (Frontend - Next.js)
├── app/
│   ├── (pages)
│   └── api/                   (API Routes - สำหรับ development/testing)
├── components/
├── lib/
│   └── api/                   (API client - เรียก backend)
└── package.json

hotel-services-api/            (Backend - NestJS) [New Project]
├── src/
│   ├── modules/
│   │   ├── auth/
│   │   ├── guests/
│   │   ├── bookings/
│   │   ├── rooms/
│   │   ├── restaurant/
│   │   ├── hr/
│   │   ├── channels/
│   │   └── reviews/
│   ├── common/
│   └── main.ts
├── prisma/
│   └── schema.prisma          (Shared schema)
└── package.json
```

**Communication:**
- Frontend → Backend: REST API หรือ GraphQL
- Authentication: JWT tokens
- CORS: Configured on backend

---

### Option 2: Monorepo (Alternative)

```
hotel-services-monorepo/
├── apps/
│   ├── frontend/              (Next.js)
│   └── backend/               (NestJS)
├── packages/
│   ├── shared-types/          (Shared TypeScript types)
│   ├── prisma-client/         (Generated Prisma client)
│   └── ui/                    (Shared UI components)
├── prisma/
│   └── schema.prisma          (Shared schema)
└── package.json               (Root workspace)
```

**Tools:**
- Turborepo หรือ Nx
- Shared types ผ่าน packages
- Single source of truth สำหรับ Prisma schema

---

## 📋 Implementation Plan

### Phase 1: Setup Backend (NestJS)

#### 1.1 Create NestJS Project
```bash
# สร้างโปรเจคใหม่
nest new hotel-services-api
cd hotel-services-api

# Install dependencies
npm install @prisma/client @nestjs/prisma
npm install @nestjs/jwt @nestjs/passport passport passport-jwt
npm install bcrypt class-validator class-transformer
npm install @nestjs/config
```

#### 1.2 Project Structure
```
src/
├── main.ts                    # Entry point
├── app.module.ts              # Root module
├── modules/
│   ├── auth/                  # Authentication
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   └── strategies/
│   │       └── jwt.strategy.ts
│   ├── guests/                # Guest management
│   │   ├── guests.module.ts
│   │   ├── guests.controller.ts
│   │   └── guests.service.ts
│   ├── bookings/              # Booking management
│   ├── rooms/                 # Room management
│   ├── restaurant/            # Restaurant module
│   ├── hr/                    # HR module
│   ├── channels/               # Channel management
│   └── reviews/               # Reviews module
├── common/
│   ├── guards/                # Auth guards
│   ├── decorators/            # Custom decorators
│   ├── filters/              # Exception filters
│   ├── interceptors/          # Interceptors
│   └── pipes/                 # Validation pipes
└── prisma/
    └── prisma.service.ts      # Prisma service
```

#### 1.3 Shared Prisma Schema
```typescript
// Option A: Copy schema to both projects
// Option B: Use shared package (monorepo)
// Option C: Git submodule
```

---

### Phase 2: Setup Frontend API Client

#### 2.1 Create API Client
```typescript
// lib/api/client.ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export const apiClient = {
  get: async (endpoint: string) => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json',
      },
    });
    return response.json();
  },
  
  post: async (endpoint: string, data: any) => {
    // ...
  },
  
  // ... other methods
};
```

#### 2.2 Update Stores
```typescript
// lib/stores/guestStore.ts
import { apiClient } from '@/lib/api/client';

export const useGuestStore = create<GuestStore>()(
  persist(
    (set, get) => ({
      fetchGuests: async (filters, page, limit) => {
        const response = await apiClient.get('/guests', { filters, page, limit });
        // ...
      },
      // ...
    })
  )
);
```

---

### Phase 3: Migration Strategy

#### Strategy A: Gradual Migration (Recommended)

```
Week 1-2: Setup NestJS backend
  - Create project structure
  - Setup authentication
  - Migrate 1-2 modules (e.g., Guests, Bookings)

Week 3-4: Update Frontend
  - Create API client
  - Update stores to call backend
  - Keep Next.js API routes as fallback

Week 5-6: Migrate remaining modules
  - Restaurant
  - HR
  - Channels
  - Reviews

Week 7: Remove Next.js API routes
  - All API calls go to NestJS
  - Next.js API routes removed
```

#### Strategy B: Big Bang Migration

```
1. Build complete NestJS backend
2. Test thoroughly
3. Switch frontend to use backend
4. Remove Next.js API routes
```

**ไม่แนะนำ** - Risk สูง, downtime มาก

---

## 🔧 Technical Considerations

### 1. Authentication

**Current (Next.js):**
```typescript
// JWT in cookies/localStorage
```

**With NestJS:**
```typescript
// Backend: JWT strategy
// Frontend: Store token, send in Authorization header
```

### 2. CORS Configuration

```typescript
// NestJS main.ts
app.enableCors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
});
```

### 3. Environment Variables

**Frontend (.env.local):**
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

**Backend (.env):**
```env
DATABASE_URL=postgresql://...
JWT_SECRET=...
FRONTEND_URL=http://localhost:3000
```

### 4. Shared Types

**Option A: Separate package**
```typescript
// packages/shared-types/src/index.ts
export interface Guest { ... }
export interface Booking { ... }
```

**Option B: Copy types**
- Keep types in sync manually
- Use code generation

**Option C: Generate from OpenAPI/Swagger**
- NestJS generates OpenAPI spec
- Frontend generates types from spec

---

## 📊 Comparison

| Aspect | Monolith (Current) | Separate (Recommended) |
|--------|-------------------|------------------------|
| **Development Speed** | ⚡ Fast (same project) | 🐢 Slower (context switching) |
| **Scalability** | ⚠️ Limited | ✅ Excellent |
| **Team Collaboration** | ⚠️ Conflicts | ✅ Independent |
| **Deployment** | ✅ Simple | ⚠️ More complex |
| **Security** | ⚠️ Mixed | ✅ Better separation |
| **Technology Flexibility** | ⚠️ Limited | ✅ High |
| **Testing** | ✅ Easy | ⚠️ Need integration tests |
| **Cost** | ✅ Lower | ⚠️ Higher (2 servers) |

---

## 🎯 Recommendation

### สำหรับระบบโรงแรมขนาดกลาง-ใหญ่: **แยก Frontend/Backend**

**เหตุผล:**
1. ✅ ระบบมีหลาย modules (HR, Restaurant, Rooms, Bookings, Channels, Reviews)
2. ✅ อาจมี mobile app ในอนาคต (ใช้ backend เดียวกัน)
3. ✅ อาจมี third-party integrations (OTA, Payment gateways)
4. ✅ Team scalability
5. ✅ Better security boundaries

### สำหรับระบบขนาดเล็ก/Startup: **Monolith (Next.js)**

**เหตุผล:**
1. ✅ Development เร็ว
2. ✅ Deploy ง่าย
3. ✅ Cost ต่ำ
4. ✅ Team เล็ก

---

## 🚀 Implementation Steps

### Step 1: Setup NestJS Backend

```bash
# Create new project
nest new hotel-services-api
cd hotel-services-api

# Install Prisma
npm install @prisma/client
npm install -D prisma

# Copy Prisma schema
cp ../owner-hotel-services/prisma/schema.prisma ./prisma/

# Generate Prisma client
npx prisma generate
```

### Step 2: Create Base Modules

```typescript
// src/modules/guests/guests.controller.ts
@Controller('guests')
@UseGuards(JwtAuthGuard)
export class GuestsController {
  constructor(private readonly guestsService: GuestsService) {}

  @Get()
  async findAll(@Query() query: any) {
    return this.guestsService.findAll(query);
  }

  @Post()
  async create(@Body() createGuestDto: CreateGuestDto) {
    return this.guestsService.create(createGuestDto);
  }
}
```

### Step 3: Update Frontend

```typescript
// lib/api/client.ts
const API_URL = process.env.NEXT_PUBLIC_API_URL;

export const api = {
  guests: {
    list: (params) => fetch(`${API_URL}/guests?${new URLSearchParams(params)}`),
    create: (data) => fetch(`${API_URL}/guests`, { method: 'POST', body: JSON.stringify(data) }),
  },
  // ...
};
```

### Step 4: Gradual Migration

1. Start with one module (e.g., Guests)
2. Test thoroughly
3. Migrate next module
4. Repeat until all migrated

---

## 🔐 Security Best Practices

### Backend (NestJS)
- ✅ JWT authentication
- ✅ Role-based access control (RBAC)
- ✅ Input validation (class-validator)
- ✅ Rate limiting
- ✅ CORS configuration
- ✅ API versioning

### Frontend (Next.js)
- ✅ Store JWT securely (httpOnly cookies recommended)
- ✅ Refresh token mechanism
- ✅ API error handling
- ✅ Request interceptors

---

## 📦 Deployment Strategy

### Option A: Separate Deployments

```
Frontend (Vercel/Netlify):
  - Next.js app
  - Environment: NEXT_PUBLIC_API_URL=https://api.hotel.com

Backend (AWS/DigitalOcean/Railway):
  - NestJS API
  - Environment: FRONTEND_URL=https://hotel.com
  - Database: PostgreSQL
```

### Option B: Docker Compose (Development)

```yaml
version: '3.8'
services:
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - API_URL=http://backend:3001

  backend:
    build: ./backend
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=postgresql://...
    depends_on:
      - postgres

  postgres:
    image: postgres:15
    # ...
```

---

## 💡 Best Practices

### 1. API Versioning
```typescript
// Backend
@Controller('api/v1/guests')
export class GuestsController { ... }
```

### 2. Error Handling
```typescript
// Backend: Standard error format
{
  success: false,
  error: "Error message",
  code: "ERROR_CODE",
  details: {}
}
```

### 3. Request/Response DTOs
```typescript
// Backend: Use DTOs for validation
export class CreateGuestDto {
  @IsString()
  @IsNotEmpty()
  firstName: string;
  
  @IsString()
  @IsNotEmpty()
  lastName: string;
}
```

### 4. API Documentation
```typescript
// Backend: Swagger/OpenAPI
@ApiTags('guests')
@ApiOperation({ summary: 'Get all guests' })
@Get()
```

---

## 🎯 Final Recommendation

### ✅ **แยก Frontend/Backend** (Recommended)

**เพราะ:**
1. ระบบมีหลาย modules และซับซ้อน
2. อาจมี mobile app ในอนาคต
3. Team scalability
4. Better architecture สำหรับ long-term

**แต่:**
- เริ่มจาก gradual migration
- Keep Next.js API routes ไว้ชั่วคราว
- Migrate module by module
- Test thoroughly ก่อน switch

---

## 📝 Migration Checklist

### Backend Setup
- [ ] Create NestJS project
- [ ] Setup Prisma
- [ ] Setup authentication (JWT)
- [ ] Create base modules structure
- [ ] Setup CORS
- [ ] API documentation (Swagger)

### Frontend Update
- [ ] Create API client
- [ ] Update environment variables
- [ ] Update stores to use API client
- [ ] Handle authentication
- [ ] Error handling
- [ ] Loading states

### Migration
- [ ] Migrate Guests module
- [ ] Migrate Bookings module
- [ ] Migrate Rooms module
- [ ] Migrate Restaurant module
- [ ] Migrate HR module
- [ ] Migrate Channels module
- [ ] Migrate Reviews module
- [ ] Remove Next.js API routes

### Testing
- [ ] Unit tests (Backend)
- [ ] Integration tests (Backend)
- [ ] E2E tests (Frontend)
- [ ] Load testing

---

**วันที่สร้าง:** 2024-12-14  
**สถานะ:** ✅ Recommendation ready

