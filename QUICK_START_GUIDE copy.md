# Quick Start Guide - Developer Onboarding

## 🚀 สำหรับนักพัฒนาใหม่

เอกสารนี้จะช่วยให้คุณเริ่มงานได้อย่างรวดเร็ว

---

## 📚 เอกสารที่ต้องอ่าน

1. **[TASK_BREAKDOWN.md](./TASK_BREAKDOWN.md)** - รายละเอียดทุก task ที่ต้องทำ
2. **[PROGRESS_TRACKER.md](./PROGRESS_TRACKER.md)** - ติดตามความคืบหน้าของโปรเจกต์
3. **[README.md](../README.md)** - ข้อมูลพื้นฐานของโปรเจกต์

---

## 🎯 ขั้นตอนการเริ่มต้น

### 1. Clone โปรเจกต์

```bash
git clone <repository-url>
cd owner-hotel-services
```

### 2. ติดตั้ง Dependencies

```bash
npm install
```

### 3. ตั้งค่า Environment Variables

```bash
# คัดลอก .env.example
cp .env.api.example .env.local

# แก้ไขค่าตามต้องการ
nano .env.local
```

**ค่า Environment ที่สำคัญ**:
```env
# API
NEXT_PUBLIC_API_URL=http://localhost:9011/api/v1
NODE_ENV=development

# Database (Backend)
DATABASE_URL=postgresql://user:password@localhost:5432/hotel_db

# Email (สำหรับ BE-EMAIL-*)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# PromptPay (สำหรับ BE-PAY-*)
PROMPTPAY_MERCHANT_ID=
PROMPTPAY_API_KEY=
PROMPTPAY_WEBHOOK_SECRET=

# Redis (สำหรับ BE-PERF-*)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT
JWT_SECRET=your-super-secret-key
JWT_EXPIRES_IN=7d

# Line Notify (สำหรับ BE-LINE-*)
LINE_NOTIFY_CLIENT_ID=
LINE_NOTIFY_CLIENT_SECRET=
```

### 4. รัน Development Server

**Frontend**:
```bash
npm run dev
# เปิด http://localhost:9010
```

**Backend** (ถ้ามี):
```bash
cd api
npm run dev
# เปิด http://localhost:9011
```

### 5. ทดสอบ Login

- URL: http://localhost:9010/login
- Test Account: (ดูจาก README.md)

---

## 🛠️ Development Workflow

### 1. รับ Task

1. เปิด [PROGRESS_TRACKER.md](./PROGRESS_TRACKER.md)
2. ดู section **"Kanban Board"** → **"TODO"**
3. เลือก task ที่ assigned ให้คุณ
4. อัพเดทสถานะเป็น **"IN PROGRESS"** ใน PROGRESS_TRACKER.md
5. แจ้งทีมใน standup meeting หรือ Slack

### 2. สร้าง Branch

**Naming Convention**:
```bash
# Backend
git checkout -b feature/BE-EMAIL-001-email-service-setup

# Frontend
git checkout -b feature/FE-PAY-001-promptpay-ui

# Bug fix
git checkout -b fix/login-validation-error

# Hotfix
git checkout -b hotfix/payment-gateway-crash
```

### 3. พัฒนาและ Test

#### Backend Development

**โครงสร้างไฟล์**:
```
api/
├── src/
│   ├── modules/
│   │   ├── email/
│   │   │   ├── email.service.ts      # Business logic
│   │   │   ├── email.controller.ts   # API endpoints
│   │   │   ├── email.module.ts       # Module definition
│   │   │   └── dto/                  # Data transfer objects
│   │   │       ├── send-email.dto.ts
│   │   │       └── email-template.dto.ts
│   │   └── payments/
│   │       └── ...
│   ├── common/
│   │   ├── guards/                   # Auth guards
│   │   ├── interceptors/             # Request/Response interceptors
│   │   └── decorators/               # Custom decorators
│   └── config/                       # Configuration
│       ├── database.config.ts
│       └── email.config.ts
└── test/
    └── e2e/
        └── email.e2e-spec.ts
```

**Code Style**:
```typescript
// email.service.ts
import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class EmailService {
  constructor(private mailerService: MailerService) {}

  async sendBookingConfirmation(booking: Booking): Promise<void> {
    await this.mailerService.sendMail({
      to: booking.guest.email,
      subject: 'Booking Confirmation',
      template: './booking-confirmation',
      context: {
        guestName: booking.guest.name,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
      },
    });
  }
}
```

**Testing**:
```bash
# Run unit tests
npm test

# Run specific test file
npm test -- email.service.spec.ts

# Run with coverage
npm run test:cov

# Run e2e tests
npm run test:e2e
```

---

#### Frontend Development

**โครงสร้างไฟล์**:
```
app/
├── dashboard/
│   ├── payments/
│   │   ├── page.tsx                  # Main page
│   │   ├── [id]/
│   │   │   └── page.tsx             # Detail page
│   │   └── layout.tsx
│   └── ...
components/
├── payments/
│   ├── PromptPayQRCode.tsx          # Component
│   ├── PaymentMethodSelector.tsx
│   └── __tests__/
│       └── PromptPayQRCode.test.tsx # Tests
lib/
├── api/
│   └── client.ts                     # API client
├── stores/
│   └── paymentStore.ts              # Zustand store
└── types/
    └── payment.ts                    # TypeScript types
```

**Code Style (Component)**:
```typescript
// components/payments/PromptPayQRCode.tsx
'use client';

import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '@/lib/api/client';
import type { PaymentQRResponse } from '@/lib/types/payment';

interface PromptPayQRCodeProps {
  bookingId: string;
  amount: number;
}

export default function PromptPayQRCode({
  bookingId,
  amount
}: PromptPayQRCodeProps) {
  const [qrData, setQrData] = useState<PaymentQRResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const generateQR = async () => {
      try {
        const response = await api.payments.promptpay.generateQR({
          bookingId,
          amount,
        });
        setQrData(response);
      } catch (err) {
        setError('Failed to generate QR code');
      } finally {
        setLoading(false);
      }
    };

    generateQR();
  }, [bookingId, amount]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div className="text-red-500">{error}</div>;
  if (!qrData) return null;

  return (
    <div className="flex flex-col items-center gap-4">
      <QRCodeSVG value={qrData.qrString} size={256} />
      <p className="text-sm text-gray-600">
        Scan to pay ฿{amount.toLocaleString()}
      </p>
    </div>
  );
}
```

**Code Style (API Client)**:
```typescript
// lib/api/client.ts
export const api = {
  // ... existing methods ...

  payments: {
    promptpay: {
      generateQR: async (data: GenerateQRRequest): Promise<PaymentQRResponse> => {
        const response = await apiClient.post('/payments/promptpay/generate-qr', data);
        return response.data;
      },

      checkStatus: async (reference: string): Promise<PaymentStatus> => {
        const response = await apiClient.get(`/payments/promptpay/status/${reference}`);
        return response.data;
      },
    },
  },
};
```

**Code Style (Zustand Store)**:
```typescript
// lib/stores/paymentStore.ts
import { create } from 'zustand';
import { api } from '@/lib/api/client';
import type { Payment, PaymentQRResponse } from '@/lib/types/payment';

interface PaymentStore {
  payments: Payment[];
  currentQR: PaymentQRResponse | null;
  loading: boolean;
  error: string | null;

  generateQR: (bookingId: string, amount: number) => Promise<void>;
  checkPaymentStatus: (reference: string) => Promise<void>;
  clearError: () => void;
}

export const usePaymentStore = create<PaymentStore>((set, get) => ({
  payments: [],
  currentQR: null,
  loading: false,
  error: null,

  generateQR: async (bookingId, amount) => {
    set({ loading: true, error: null });
    try {
      const qr = await api.payments.promptpay.generateQR({ bookingId, amount });
      set({ currentQR: qr, loading: false });
    } catch (error) {
      set({ error: 'Failed to generate QR code', loading: false });
    }
  },

  checkPaymentStatus: async (reference) => {
    try {
      const status = await api.payments.promptpay.checkStatus(reference);
      // Update payment status in store
      set({ loading: false });
    } catch (error) {
      set({ error: 'Failed to check payment status', loading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
```

**Testing**:
```bash
# Run all tests
npm test

# Run specific test
npm test -- PromptPayQRCode.test.tsx

# Run with coverage
npm run test:cov

# Run E2E tests
npm run test:e2e
```

---

### 4. Code Review Checklist

#### ก่อน commit ให้ตรวจสอบ:

**General**:
- [ ] Code follows project conventions
- [ ] No console.log() or commented code left behind
- [ ] No hardcoded values (use environment variables)
- [ ] Error handling implemented
- [ ] Loading states handled
- [ ] Edge cases considered

**Backend**:
- [ ] Validation added (DTOs with class-validator)
- [ ] Authentication/Authorization guards applied
- [ ] Database transactions used where needed
- [ ] SQL injection prevention (use parameterized queries)
- [ ] Rate limiting considered
- [ ] API documented (Swagger decorators)
- [ ] Unit tests written (80%+ coverage)
- [ ] Integration tests for endpoints

**Frontend**:
- [ ] TypeScript types defined
- [ ] Accessibility (ARIA labels, keyboard navigation)
- [ ] Responsive design (mobile, tablet, desktop)
- [ ] Loading/Error states
- [ ] Form validation
- [ ] API error handling
- [ ] Component tests written
- [ ] No prop drilling (use stores if needed)

---

### 5. Commit และ Push

**Commit Message Convention**:
```bash
# Format: <type>(<scope>): <subject>

# Types:
# - feat: New feature
# - fix: Bug fix
# - docs: Documentation
# - style: Code style (formatting, no logic change)
# - refactor: Code refactoring
# - test: Adding tests
# - chore: Maintenance

# Examples:
git commit -m "feat(email): implement email service setup (BE-EMAIL-001)"
git commit -m "fix(payment): resolve QR code generation timeout"
git commit -m "test(email): add unit tests for email service"
```

**Push to Remote**:
```bash
git push origin feature/BE-EMAIL-001-email-service-setup
```

---

### 6. สร้าง Pull Request

#### PR Title Format:
```
[BE-EMAIL-001] Email Service Setup
[FE-PAY-001] PromptPay Payment UI
```

#### PR Description Template:
```markdown
## Task ID
BE-EMAIL-001

## Description
Implement email service setup using nodemailer with SendGrid integration.

## Changes Made
- Installed nodemailer and @sendgrid/mail
- Created EmailService class with send functionality
- Added email configuration in config/email.config.ts
- Implemented error handling and retry mechanism
- Added unit tests (85% coverage)

## Testing
- [x] Unit tests pass
- [x] Integration tests pass
- [x] Manual testing completed
- [x] Tested on staging environment

## Screenshots (if applicable)
[Attach screenshots]

## Checklist
- [x] Code follows style guidelines
- [x] Self-review completed
- [x] Comments added to complex logic
- [x] Documentation updated
- [x] No breaking changes
- [x] Tests added/updated
- [x] All tests passing

## Dependencies
- None

## Related PRs
- None
```

---

### 7. รอ Code Review

**ใน Slack แจ้ง**:
```
@team PR ready for review: [BE-EMAIL-001] Email Service Setup
Link: <PR URL>
```

**ถ้ามี feedback**:
1. แก้ไขตาม comments
2. Commit และ push อีกครั้ง
3. Reply ใน PR thread

---

### 8. Merge และ Deploy

**หลัง approve**:
1. Squash and merge to `main`
2. Delete branch
3. อัพเดท [PROGRESS_TRACKER.md](./PROGRESS_TRACKER.md) → ย้าย task ไปที่ **"DONE"**
4. แจ้งทีมใน Slack

---

## 📦 API Client Usage Examples

### การเรียกใช้ API

```typescript
import { api } from '@/lib/api/client';

// Login
const authResponse = await api.auth.login({
  email: 'user@example.com',
  password: 'password123',
});

// Get bookings
const bookings = await api.bookings.list({
  page: 1,
  limit: 10,
  status: 'CONFIRMED',
});

// Create booking
const newBooking = await api.bookings.create({
  guestId: '123',
  roomId: '456',
  checkIn: '2026-04-01',
  checkOut: '2026-04-05',
});

// Generate PromptPay QR (NEW)
const qr = await api.payments.promptpay.generateQR({
  bookingId: '789',
  amount: 3500,
});

// Send email (NEW)
await api.notifications.email.send({
  to: 'guest@example.com',
  template: 'booking-confirmation',
  data: { bookingId: '789' },
});
```

### Error Handling

```typescript
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';

try {
  await api.bookings.create(bookingData);
} catch (error) {
  if (error instanceof ApiError) {
    // API error with status code
    console.error(`API Error: ${error.message} (${error.statusCode})`);

    if (error.statusCode === 401) {
      // Redirect to login
      router.push('/login');
    } else if (error.statusCode === 400) {
      // Show validation errors
      setErrors(error.errors);
    }
  } else {
    // Network or unknown error
    console.error('Unknown error:', error);
  }
}
```

---

## 🧪 Testing Guide

### Unit Testing Example (Backend)

```typescript
// email.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from './email.service';
import { MailerService } from '@nestjs-modules/mailer';

describe('EmailService', () => {
  let service: EmailService;
  let mailerService: MailerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: MailerService,
          useValue: {
            sendMail: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    mailerService = module.get<MailerService>(MailerService);
  });

  it('should send booking confirmation email', async () => {
    const booking = {
      id: '123',
      guest: { email: 'guest@example.com', name: 'John Doe' },
      checkIn: new Date('2026-04-01'),
      checkOut: new Date('2026-04-05'),
    };

    await service.sendBookingConfirmation(booking);

    expect(mailerService.sendMail).toHaveBeenCalledWith({
      to: 'guest@example.com',
      subject: 'Booking Confirmation',
      template: './booking-confirmation',
      context: expect.objectContaining({
        guestName: 'John Doe',
      }),
    });
  });
});
```

### Component Testing Example (Frontend)

```typescript
// PromptPayQRCode.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import PromptPayQRCode from './PromptPayQRCode';
import { api } from '@/lib/api/client';

jest.mock('@/lib/api/client');

describe('PromptPayQRCode', () => {
  it('should display QR code after loading', async () => {
    const mockQRData = {
      qrString: 'promptpay://1234567890',
      reference: 'REF123',
    };

    (api.payments.promptpay.generateQR as jest.Mock).mockResolvedValue(mockQRData);

    render(<PromptPayQRCode bookingId="123" amount={3500} />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Scan to pay ฿3,500')).toBeInTheDocument();
    });
  });

  it('should display error message on failure', async () => {
    (api.payments.promptpay.generateQR as jest.Mock).mockRejectedValue(
      new Error('Network error')
    );

    render(<PromptPayQRCode bookingId="123" amount={3500} />);

    await waitFor(() => {
      expect(screen.getByText('Failed to generate QR code')).toBeInTheDocument();
    });
  });
});
```

---

## 🔍 Debugging Tips

### Backend Debugging

```typescript
// Add logging
import { Logger } from '@nestjs/common';

export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async sendEmail() {
    this.logger.log('Sending email...');
    this.logger.debug('Email data:', emailData);
    this.logger.error('Failed to send email', error.stack);
  }
}
```

### Frontend Debugging

```typescript
// Use React DevTools
// Install: https://chrome.google.com/webstore/detail/react-developer-tools

// Add debugging in components
useEffect(() => {
  console.log('Component mounted');
  console.log('Props:', { bookingId, amount });

  return () => {
    console.log('Component unmounted');
  };
}, []);

// Debug Zustand store
import { devtools } from 'zustand/middleware';

export const usePaymentStore = create<PaymentStore>()(
  devtools(
    (set, get) => ({
      // ... store implementation
    }),
    { name: 'PaymentStore' } // Show in Redux DevTools
  )
);
```

---

## 🆘 Common Issues & Solutions

### Issue: API Connection Failed

**Error**: `Cannot connect to http://localhost:9011`

**Solution**:
1. ตรวจสอบว่า backend server รันอยู่
2. ตรวจสอบ `NEXT_PUBLIC_API_URL` ใน `.env.local`
3. ตรวจสอบ CORS settings ใน backend

---

### Issue: TypeScript Errors

**Error**: `Property 'xyz' does not exist on type`

**Solution**:
1. อัพเดท types ใน `/lib/types/`
2. รัน `npm run type-check`
3. Restart TypeScript server (VS Code: Cmd+Shift+P → "Restart TS Server")

---

### Issue: Tests Failing

**Error**: Tests fail locally

**Solution**:
```bash
# Clear cache
npm run test -- --clearCache

# Update snapshots
npm run test -- -u

# Run specific test
npm run test -- path/to/test.tsx
```

---

## 📞 ติดต่อทีม

- **Slack**: `#hotel-management-dev`
- **Email**: team@hotel-management.com
- **Project Manager**: [Name] - [Email]
- **Tech Lead**: [Name] - [Email]

---

## 🎓 Learning Resources

### NestJS (Backend)
- [Official Docs](https://docs.nestjs.com/)
- [TypeORM](https://typeorm.io/)
- [Nodemailer](https://nodemailer.com/)

### Next.js (Frontend)
- [Official Docs](https://nextjs.org/docs)
- [React Docs](https://react.dev/)
- [Zustand](https://zustand-demo.pmnd.rs/)
- [TailwindCSS](https://tailwindcss.com/)

### Testing
- [Jest](https://jestjs.io/)
- [React Testing Library](https://testing-library.com/react)

---

_Welcome to the team! Happy coding! 🚀_
