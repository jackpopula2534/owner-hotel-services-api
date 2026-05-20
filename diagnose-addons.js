/**
 * Why doesn't HR / Inventory show up in the sidebar for premium.test@email.com?
 * This dumps:
 *   - subscription + plan for the tenant
 *   - plan_addons attached to that plan
 *   - plan_features attached to that plan
 *   - subscription_features attached to that subscription
 * So we can see exactly what /api/v1/addons/status will return.
 *
 * Safe to delete after running.
 */
const { PrismaClient } = require('@prisma/client');

const EMAIL = 'premium.test@email.com';

(async () => {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email: EMAIL } });
    if (!user) return console.log('User not found');
    console.log('Tenant:', user.tenantId);

    const sub = await prisma.subscriptions.findFirst({
      where: { tenant_id: user.tenantId },
      orderBy: { created_at: 'desc' },
    });
    if (!sub) return console.log('No subscription');
    console.log('Subscription:', sub.subscription_code, 'status:', sub.status, 'planId:', sub.plan_id);

    const plan = await prisma.plans.findUnique({ where: { id: sub.plan_id } });
    console.log('Plan:', plan?.code, plan?.name);

    // plan_addons (via plan_id_addon_id unique)
    const planAddons = await prisma.$queryRawUnsafe(
      `SELECT pa.plan_id, pa.addon_id, a.code, a.name, a.is_active
       FROM plan_addons pa
       LEFT JOIN add_ons a ON a.id = pa.addon_id
       WHERE pa.plan_id = ?`,
      sub.plan_id,
    );
    console.log('\n--- plan_addons (count:', planAddons.length, ') ---');
    planAddons.forEach((pa) =>
      console.log(' ', pa.code, '| is_active:', pa.is_active, '| name:', pa.name),
    );

    // plan_features
    const planFeatures = await prisma.$queryRawUnsafe(
      `SELECT pf.plan_id, pf.feature_id, f.code, f.name, f.type, f.is_active
       FROM plan_features pf
       LEFT JOIN features f ON f.id = pf.feature_id
       WHERE pf.plan_id = ?`,
      sub.plan_id,
    );
    console.log('\n--- plan_features (count:', planFeatures.length, ') ---');
    planFeatures.forEach((pf) =>
      console.log(' ', pf.code, '| type:', pf.type, '| is_active:', pf.is_active),
    );

    // subscription_features
    const subFeatures = await prisma.$queryRawUnsafe(
      `SELECT sf.subscription_id, sf.feature_id, sf.is_active AS sf_active, f.code, f.name, f.type, f.is_active AS f_active
       FROM subscription_features sf
       LEFT JOIN features f ON f.id = sf.feature_id
       WHERE sf.subscription_id = ?`,
      sub.id,
    );
    console.log('\n--- subscription_features (count:', subFeatures.length, ') ---');
    subFeatures.forEach((sf) =>
      console.log(
        ' ',
        sf.code,
        '| type:',
        sf.type,
        '| sf_active:',
        sf.sf_active,
        '| f_active:',
        sf.f_active,
      ),
    );

    // What addon.service.ts would return
    console.log('\n--- Effective module addons (what /addons/status returns) ---');
    const merged = new Map();
    planFeatures.forEach((pf) => {
      if (pf.type === 'module' && pf.is_active === 1)
        merged.set(pf.code, { code: pf.code, source: 'plan_features' });
    });
    planAddons.forEach((pa) => {
      if (Number(pa.is_active) === 1 && !merged.has(pa.code))
        merged.set(pa.code, { code: pa.code, source: 'plan_addons' });
    });
    subFeatures.forEach((sf) => {
      if (sf.type === 'module' && sf.f_active === 1 && sf.sf_active === 1 && !merged.has(sf.code))
        merged.set(sf.code, { code: sf.code, source: 'subscription_features' });
    });
    Array.from(merged.values()).forEach((m) => console.log(' ✓', m.code, '←', m.source));
    if (merged.size === 0) console.log('  (none)');

    // The codes the FRONTEND looks for
    const REQUIRED = [
      'HR_MODULE',
      'INVENTORY_MODULE',
      'COST_ACCOUNTING_MODULE',
      'RESTAURANT_MODULE',
      'LOYALTY_MODULE',
      'CHANNEL_MANAGER',
    ];
    console.log('\n--- Frontend gates (sidebar) ---');
    REQUIRED.forEach((code) =>
      console.log(' ', code, merged.has(code) ? '✅ shown' : '❌ HIDDEN'),
    );
  } catch (e) {
    console.error('Error:', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
