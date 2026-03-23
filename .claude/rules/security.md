# Security Guidelines — Owner Hotel Services API

## Mandatory Security Checks

Before ANY commit:
- [ ] No hardcoded secrets (API keys, passwords, tokens, DB credentials)
- [ ] All inputs validated via class-validator DTOs
- [ ] SQL injection prevention (Prisma parameterized queries)
- [ ] Authentication verified via JWT Guards
- [ ] Authorization checked (role-based access)
- [ ] Rate limiting enabled on public endpoints
- [ ] Error messages don't leak sensitive data (no stack traces)
- [ ] Audit logging for sensitive operations

## Secret Management

- NEVER hardcode secrets in source code
- ALWAYS use ConfigModule + .env files
- Validate required env vars at startup via ConfigModule validation
- ห้าม commit .env files — ใช้ .env.example เป็น template

## Authentication & Authorization

- JWT tokens via Passport.js
- 2FA support via Speakeasy
- Password hashing via bcrypt (min 10 rounds)
- Token expiration and refresh strategy
- Rate limit login attempts

## Database Security

- ใช้ Prisma parameterized queries เสมอ (ป้องกัน SQL injection)
- ห้าม raw SQL queries ถ้าไม่จำเป็น — ถ้าใช้ต้อง parameterize
- Validate and sanitize all query parameters
- ใช้ Prisma middleware สำหรับ soft delete / tenant isolation

## Security Response Protocol

If security issue found:
1. STOP immediately
2. Fix CRITICAL issues before continuing
3. Rotate any exposed secrets
4. Review entire codebase for similar issues
5. Update audit log
