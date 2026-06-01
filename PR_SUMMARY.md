# PR: Sales & Legal compliance hardening (StaySync API)

แก้ไขประเด็นด้านการขาย/การเงิน และด้านกฎหมาย (PDPA + ภาษีไทย) จากผล audit รวม **11 ประเด็น** จัดเป็น 3 phase — ครบทุกข้อ พร้อม unit tests และ migration

## Summary

| # | ID | Severity | สิ่งที่แก้ |
|---|----|----------|-----------|
| 1 | SALES-01 | Critical | PromptPay webhook: ตรวจ HMAC-SHA256 signature + atomic claim กัน double-process |
| 2 | SALES-02 | Critical | TrueMoney/2C2P callback: ตรวจลายเซ็น JWT (HS256) ก่อนเชื่อ respCode |
| 3 | LEGAL-01 | Critical | PDPA erasure: anonymize PII ที่ denormalize ใน `Booking` + `TableReservation` |
| 4 | SALES-03 | High | Stripe webhook idempotency: กัน payment ซ้ำเมื่อ retry |
| 5 | SALES-04 | High | `approvePayment` idempotency + atomic payment/invoice update กันต่ออายุ subscription ซ้ำ |
| 6 | LEGAL-02 | High | ใบแจ้งหนี้ SaaS: เพิ่ม VAT breakdown (subtotal/vat_rate/vat_amount) คำนวณ 7% |
| 7 | LEGAL-03 | High | AR invoice: บังคับ seller/buyer tax ID ตอน issue + endpoint ตรวจเลขรันขาด/ซ้ำ |
| 8 | SALES-05 | Medium | Coupon redeem: ย้ายเช็ค cap เข้า transaction กัน TOCTOU race |
| 9 | LEGAL-04 | Medium | เก็บ consent IP address ตอนสร้าง guest |
| 10 | LEGAL-05 | Medium | Audit log: cron ลบตาม retention (3y) + content-hash tamper-evidence + `verifyIntegrity()` |

## Post-review hardening

An independent adversarial review of the diff surfaced and fixed:

- **H1 — coupon per-tenant race:** redeem now acquires the coupon row lock (global increment) *before* counting per-tenant usage, serializing concurrent redeems of the same coupon (`coupons.service.ts`).
- **H2 — payment activation stuck-state:** subscription activation now runs *inside* the approval `$transaction` (`activateSubscriptionForInvoice(invoiceId, tx)`), so a failure rolls back the whole approval and a retry reconciles cleanly — no "paid but never activated" state, no double-extension (`payments.service.ts`).
- **M2 — VAT over-stamping:** the VAT breakdown is now written only for subscription invoices or explicit opt-in (`subtotal`/`vatRate`), never auto-applied to booking/folio invoices (`invoices.service.ts`).
- **M3 — silent prod misconfig:** PromptPay logs a loud startup error when `PROMPTPAY_WEBHOOK_SECRET` is missing in production (`promptpay.service.ts`).

Test-suite fixes after running the full suite:

- **coupons.service.spec.ts** — updated the `$transaction` mock to expose `findUnique`/`count` now that `redeem()` re-validates caps in-transaction (the only existing test my changes broke).
- **PrismaModule** now imports the global `TenantModule` so `PrismaService` can always resolve its `TenantContextService` dependency — fixes `Nest can't resolve dependencies of the PrismaService` DI errors in integration TestingModules that import a feature module without bootstrapping the whole app. No circular dependency (TenantModule has no Prisma dependency) and no production impact.

Known/accepted limitations (follow-up): audit `entry_hash` is a keyless SHA-256 content hash (detects content edits; upgrade to HMAC/chaining for defense against an actor with DB+code access). Pre-existing lint warnings (unused imports in `promptpay`/`stripe`/`data-retention`) are not introduced by this PR.

## Changes by area

### Payments / webhooks (security)
- `promptpay.service.ts` / `promptpay.controller.ts` — verify `x-promptpay-signature` (HMAC-SHA256, fail-closed in prod) via raw body; flip pending→paid with `updateMany` status-guard.
- `truemoney.service.ts` / `truemoney.controller.ts` / `dto/truemoney.dto.ts` — verify 2C2P signed JWT payload, use only verified claims, reject forged/unsigned callbacks in prod; `@Public()` on callback route.
- `stripe.service.ts` — `onPaymentIntentSucceeded` checks for an existing payment before create (idempotent on webhook redelivery).
- `payments.service.ts` — idempotent `approvePayment` (already-approved → no-op), atomic conditional claim + invoice "paid" in one `$transaction`; removed dead `updateInvoiceStatusToPaid`.

### Billing / tax
- `invoices/*` + migration `20260531000000_add_invoice_vat` — `subtotal`/`vat_rate`/`vat_amount` columns; VAT computed in satang (guarantees subtotal+vat=total); default 7%, supports 0% exempt and VAT-inclusive back-calc.
- `ar-invoices.service.ts` / `ar-invoices.controller.ts` — `issue()` requires seller `DocumentSettings.taxId` and buyer `companyTaxId` for CITY_LEDGER; new `GET /accounting/ar-invoices/sequence-audit` (gap/duplicate detection).
- `coupons.service.ts` — in-transaction cap re-check; global cap via atomic conditional increment.

### PDPA / compliance
- `data-export.processor.ts` — erasure now anonymizes `Booking` + `TableReservation` PII.
- `guests.service.ts` / `guests.controller.ts` — capture request IP into `consentIpAddress` (`@Ip()`).
- `audit-log.service.ts` + migration `20260531010000_add_audit_log_entry_hash` — SHA-256 content hash per row at write time + `verifyIntegrity()`.
- `anonymize.service.ts` / `data-retention.service.ts` — `purgeExpiredAuditLogs()` + monthly cron + included in `runFullPurgeNow()`.
- `config/env.validation.ts` / `.env.example` — `PROMPTPAY_WEBHOOK_SECRET`.

## Database migrations

Two additive migrations add the new columns:

- `20260531000000_add_invoice_vat` — adds `invoices.subtotal`, `vat_rate`, `vat_amount` (all NULLable, backward compatible).
- `20260531010000_add_audit_log_entry_hash` — adds `audit_logs.entry_hash` (NULLable; historical rows simply have no hash to verify).

Both are ordered after the initial schema migration, so the target tables already exist when the `ALTER`s run. Apply with whichever fits the environment:

| Environment | Command | Effect |
|---|---|---|
| **Local / dev (reset + seed)** | `npm run db:refresh` ⚠️ | Drops ALL tables, runs `prisma migrate deploy` (applies these migrations), regenerates the client, syncs TypeORM, and re-seeds demo data. **Destroys all data** — local only. |
| **Staging / production** | `npm run prisma:migrate:deploy` | Applies pending migrations only. **No data loss.** |
| **Quick column-add (no migration history change)** | `npx prisma db push` | Syncs schema → DB. Use if the working tree has un-migrated WIP models and `migrate dev`/`deploy` reports drift. |

> Note: if `npm run prisma:migrate` (`prisma migrate dev`) reports drift because of un-migrated WIP models, it will refuse to apply and offer a reset — that is why the missing `invoices.subtotal` column appeared at runtime. Use `db:refresh` (local) or `prisma:migrate:deploy` / `db push` to apply the columns without a dev-reset prompt. The seeder is unaffected: it creates subscription invoices whose gross `amount` is preserved (VAT breakdown is added, totals unchanged).

## Environment variables

- **`PROMPTPAY_WEBHOOK_SECRET`** (new) — REQUIRED in production; PromptPay webhooks are rejected without it (fail-closed).
- `TWO_C2P_SECRET_KEY` (existing) — now also used to verify TrueMoney callbacks.
- `RETENTION_AUDIT_LOG_YEARS` (optional, default 3).

## Test plan

New/updated unit specs (10 suites / 53 tests, all green; `tsc --noEmit` exit 0):

- `promptpay.service.spec.ts` — invalid signature → 401, prod-without-secret → 401, valid signature claims atomically, race count=0 no-op.
- `truemoney.service.spec.ts` — wrong-key JWT rejected, unsigned in prod rejected, valid payload marks completed.
- `stripe.service.spec.ts` — first delivery records once; redelivery creates no duplicate.
- `payments.service.spec.ts` — atomic claim w/ status guard, already-approved no-op, race count=0 no-op, cascades.
- `data-export-erasure.spec.ts` — Booking + TableReservation PII redacted; counts reported.
- `invoices-vat.spec.ts` — subtotal-given, inclusive back-calc, 0% exempt, subtotal+vat=total invariant.
- `ar-invoices-legal.spec.ts` — seller tax-ID gate, CITY_LEDGER buyer tax-ID gate, gap/duplicate detection.
- `coupons-redeem-race.spec.ts` — in-tx per-tenant + global cap enforcement.
- `guests-consent-ip.spec.ts` — consent IP persisted when consent given, omitted otherwise.
- `audit-log-integrity.spec.ts` — deterministic hash (key-order independent), tamper/unhashed detection.

Before merge, on an environment with DB/Redis:

```bash
npm run db:refresh   # local: reset + apply migrations (incl. VAT/entry_hash) + seed
npm run lint
npm test            # full unit + integration
npm run test:e2e
```

## Risk / rollback notes

- Both migrations are additive NULLable columns — safe to roll back by dropping the columns; no data backfill required.
- Webhook fail-closed behavior: PromptPay/TrueMoney will reject in production until secrets are set — verify secrets are configured before cutover.
- Audit hash is a SHA-256 content hash (detects after-the-fact content edits). For stronger guarantees against an actor with DB+code access, upgrade to HMAC (server secret) or a hash chain in a follow-up.
- `tsconfig.build.tsbuildinfo` appears in the diff — build artifact; consider gitignoring.
