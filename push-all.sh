#!/usr/bin/env bash
# push-all.sh - Commit & push backend + frontend repos by feature
# Run: bash push-all.sh
set -e

API_DIR="/Users/todsapornsaelow/Documents/GitHub/owner-hotel-services-api"
WEB_DIR="/Users/todsapornsaelow/Documents/GitHub/owner-hotel-services"

GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-Teamdev}"
GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-teamdev@organicscosme.com}"
GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL

say() { printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }

clean_locks() {
  local d="$1"
  say "Cleaning stale .git lock files in $d"
  ( cd "$d/.git" && \
    find . -maxdepth 1 -type f \( -name "*.lock*" -o -name "HEAD._stale_lock*" \) -print -delete 2>/dev/null || true ) || true
}

commit_if_staged() {
  local msg="$1"
  if git diff --cached --quiet; then
    echo "  (nothing staged for: $msg) — skipping"
  else
    git commit -m "$msg"
  fi
}

############################################
# BACKEND
############################################
say "BACKEND repo: $API_DIR"
cd "$API_DIR"
clean_locks "$API_DIR"
git status --short | head -5 || true

# 1. Prisma schema + migrations
say "[1/11] chore: prisma schema + migrations"
git add prisma/schema.prisma \
  prisma/migrations/20260501130000_add_trial_reminder_event_type \
  prisma/migrations/20260501140000_extend_tenant_lifecycle_status \
  prisma/migrations/20260501150000_add_dunning_attempts \
  prisma/migrations/20260501160000_add_subscription_coupons \
  prisma/migrations/20260501170000_add_payment_webhooks \
  prisma/migrations/20260501180000_add_usage_metering \
  prisma/migrations/20260501190000_add_impersonation_sessions \
  prisma/migrations/20260501200000_add_data_exports \
  prisma/migrations/20260501210000_add_status_page \
  prisma/migrations/20260501220000_add_announcements \
  prisma/migrations/20260501230000_add_api_keys \
  prisma/migrations/20260501240000_add_tenant_branding \
  prisma/migrations/20260502000000_features_category 2>/dev/null || true
commit_if_staged "chore: add Prisma schema and migrations for SaaS admin features

- Trial reminder event type
- Tenant lifecycle status extension
- Dunning attempts
- Subscription coupons
- Payment webhooks
- Usage metering
- Impersonation sessions
- Data exports
- Status page
- Announcements
- API keys
- Tenant branding
- Features category"

# 2. Dunning + trial reminder
say "[2/11] feat: dunning + trial reminder"
git add src/dunning \
  src/subscriptions/trial-reminder.service.ts \
  src/subscriptions/trial-reminder.service.spec.ts \
  src/email/templates/dunning-final-notice.en.hbs \
  src/email/templates/dunning-final-notice.th.hbs \
  src/email/templates/dunning-first-warning.en.hbs \
  src/email/templates/dunning-first-warning.th.hbs \
  src/email/templates/dunning-reminder.en.hbs \
  src/email/templates/dunning-reminder.th.hbs \
  src/email/templates/dunning-second-warning.en.hbs \
  src/email/templates/dunning-second-warning.th.hbs \
  src/email/templates/trial-reminder.en.hbs \
  src/email/templates/trial-reminder.th.hbs \
  src/subscriptions/subscriptions.module.ts \
  src/subscriptions/entities/billing-history.entity.ts \
  src/email/dto/send-email.dto.ts 2>/dev/null || true
commit_if_staged "feat: add dunning workflow and trial reminder service

- New dunning module with reminders, warnings, and final-notice flow
- Trial reminder service with bilingual email templates
- Billing history entity updates for dunning attempts"

# 3. Coupons
say "[3/11] feat: coupons module"
git add src/coupons 2>/dev/null || true
commit_if_staged "feat: add subscription coupons module"

# 4. Webhooks
say "[4/11] feat: payment webhooks + reconciliation"
git add src/webhooks 2>/dev/null || true
commit_if_staged "feat: add payment webhooks and reconciliation service

- Webhook signature verification utility
- Payment reconciliation service
- Webhooks controller, service, and tests"

# 5. Usage metering
say "[5/11] feat: usage metering + overage billing"
git add src/usage-metering 2>/dev/null || true
commit_if_staged "feat: add usage metering and overage billing

- Usage metering service with quota guard
- Overage billing service
- Controller, module, and tests"

# 6. Admin analytics
say "[6/11] feat: admin SaaS analytics"
git add src/admin-analytics 2>/dev/null || true
commit_if_staged "feat: add admin SaaS analytics module"

# 7. Impersonation
say "[7/11] feat: tenant impersonation"
git add src/impersonation 2>/dev/null || true
commit_if_staged "feat: add tenant impersonation module"

# 8. Data export
say "[8/11] feat: data export"
git add src/data-export 2>/dev/null || true
commit_if_staged "feat: add data export module"

# 9. Status page + announcements
say "[9/11] feat: status page + announcements"
git add src/status-page src/announcements 2>/dev/null || true
commit_if_staged "feat: add status page and announcements modules"

# 10. API keys + branding + queue monitor
say "[10/11] feat: api-keys + branding + queue-monitor"
git add src/api-keys src/branding src/queue-monitor 2>/dev/null || true
commit_if_staged "feat: add API keys, tenant branding, and queue monitoring modules"

# 11. Tenant lifecycle + remaining shared changes
say "[11/11] feat: tenant lifecycle + shared updates"
git add src/tenants \
  src/admin/admin-features.service.ts \
  src/admin/dto/admin-features.dto.ts \
  src/app.module.ts \
  src/common/guards/jwt-auth.guard.ts \
  src/common/guards/jwt-auth.guard.spec.ts \
  src/features/dto/create-feature.dto.ts \
  src/features/entities/feature.entity.ts \
  src/features/features.service.ts \
  src/modules/addons/addon.service.ts \
  src/seeder/seeder.module.ts \
  src/seeder/seeder.service.ts \
  src/subscription/subscription.controller.ts \
  src/subscription/subscription.module.ts \
  src/subscription/self-service-plan.service.ts \
  src/subscription/self-service-plan.service.spec.ts 2>/dev/null || true
commit_if_staged "feat: add tenant lifecycle service and wire SaaS admin modules

- Tenant lifecycle service with guards and tests
- Hotel detail/management service updates
- Self-service plan service for subscriptions
- Auth guard hardening with spec
- Wire new modules into app.module
- Features and seeder updates for new categories"

# Backend push
say "Pushing backend to origin/dev"
git push origin dev

############################################
# FRONTEND
############################################
say "FRONTEND repo: $WEB_DIR"
cd "$WEB_DIR"
clean_locks "$WEB_DIR"

# 12. Pricing + auth gate + coupons UI
say "[1/4] feat: pricing wizard + auth gate + coupons UI"
git add components/pricing/PricingWizard.tsx \
  components/pricing/AuthGateModal.tsx \
  components/pricing/CheckoutSummary.tsx \
  components/pricing/CouponInput.tsx \
  components/pricing/FeaturedCouponBanner.tsx \
  components/pricing/AddonSelector.tsx \
  lib/utils/pendingCheckout.ts \
  lib/constants/addonMockPool.ts \
  lib/constants/couponMockPool.ts \
  lib/constants/featureMockPool.ts \
  app/pricing/page.tsx \
  __tests__/components/AuthGateModal.test.tsx \
  __tests__/components/CouponInput.test.tsx \
  __tests__/components/FeaturedCouponBanner.test.tsx \
  __tests__/lib/pendingCheckout.test.ts 2>/dev/null || true
commit_if_staged "feat: add pricing wizard with auth gate and coupon support"

# 13. Admin pages
say "[2/4] feat: admin pages (analytics, audit, coupons, dunning, email-templates, queues, refunds)"
git add app/admin/analytics \
  app/admin/audit-logs \
  app/admin/coupons \
  app/admin/dunning \
  app/admin/email-templates \
  app/admin/queues \
  app/admin/refunds \
  app/admin/addons/page.tsx \
  app/admin/features/page.tsx \
  app/admin/page.tsx \
  __tests__/pages/admin-analytics.test.tsx \
  __tests__/pages/admin-coupons.test.tsx \
  __tests__/pages/admin-dunning.test.tsx \
  __tests__/pages/tenant-billing-portal.test.tsx 2>/dev/null || true
commit_if_staged "feat: add admin pages for SaaS operations

- Analytics, audit logs, coupons, dunning
- Email templates, queues, refunds
- Update existing addons/features admin pages"

# 14. Dashboard + banners + status page
say "[3/4] feat: dashboard usage meters + banners + status page"
git add components/dashboard/UsageMeters.tsx \
  components/layout/ImpersonationBanner.tsx \
  components/layout/LifecycleBanner.tsx \
  app/status \
  app/dashboard/page.tsx \
  app/dashboard/billing/page.tsx \
  __tests__/components/UsageMeters.test.tsx \
  __tests__/components/ImpersonationBanner.test.tsx \
  __tests__/components/LifecycleBanner.test.tsx \
  __tests__/pages/status-page.test.tsx 2>/dev/null || true
commit_if_staged "feat: add dashboard usage meters, lifecycle/impersonation banners, status page"

# 15. Remaining tweaks
say "[4/4] chore: remaining tweaks"
git add lib/api/client.ts \
  lib/stores/addonCatalogStore.ts \
  lib/stores/userManagementStore.ts \
  components/layout/AdminLayoutClient.tsx \
  components/layout/UserLayout.tsx \
  app/billing/page.tsx 2>/dev/null || true
commit_if_staged "chore: wire new SaaS endpoints, banners, and store updates"

# Catch any leftovers
say "Catch-all for leftover changes"
git add -A
commit_if_staged "chore: misc updates" || true

# Frontend push
say "Pushing frontend to origin/dev"
git push origin dev

say "ALL DONE"
