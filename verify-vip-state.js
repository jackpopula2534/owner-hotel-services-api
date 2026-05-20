/**
 * Verify ALL fields that could trigger the Trial banner / Free-plan gate
 * for premium.test@email.com. Run this AFTER fix-vip-subscription.js.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { email: 'premium.test@email.com' },
    });
    if (!user?.tenantId) return console.log('User/tenant not found');

    const tenant = await prisma.tenants.findUnique({ where: { id: user.tenantId } });
    console.log('--- TENANT ---');
    console.log('  status:        ', tenant.status);
    console.log('  trial_ends_at: ', tenant.trial_ends_at);

    const subs = await prisma.subscriptions.findMany({
      where: { tenant_id: user.tenantId },
      orderBy: { created_at: 'desc' },
    });
    console.log('\n--- SUBSCRIPTIONS (count:', subs.length, ') ---');
    for (const s of subs) {
      const plan = await prisma.plans.findUnique({ where: { id: s.plan_id } });
      const daysLeft = Math.ceil((new Date(s.end_date) - new Date()) / 86400000);
      console.log(`  ${s.subscription_code}`);
      console.log(`    id:         ${s.id}`);
      console.log(`    plan code:  ${plan?.code} (${plan?.name})`);
      console.log(`    status:     ${s.status}`);
      console.log(`    start:      ${new Date(s.start_date).toISOString().split('T')[0]}`);
      console.log(`    end:        ${new Date(s.end_date).toISOString().split('T')[0]}`);
      console.log(`    days left:  ${daysLeft}`);
      console.log(`    auto_renew: ${s.auto_renew}`);
    }

    console.log('\n--- FRONTEND TRIAL BADGE CHECK ---');
    const active = subs.find((s) => s.status === 'active');
    if (!active) {
      console.log('  ❌ No active subscription → TrialBadge will show (no hasSubscription)');
    } else {
      const daysLeft = Math.ceil((new Date(active.end_date) - new Date()) / 86400000);
      const plan = await prisma.plans.findUnique({ where: { id: active.plan_id } });
      const planCode = (plan?.code || 'FREE').toUpperCase();
      console.log(`  status:      ${active.status}`);
      console.log(`  planCode:    ${planCode}`);
      console.log(`  daysLeft:    ${daysLeft}`);
      console.log(`  isFreePlan?  ${planCode === 'FREE' ? '❌ YES' : '✅ NO'}`);
      console.log(`  TrialBadge?  ${daysLeft > 30 && active.status === 'active' ? '✅ HIDDEN' : '⚠️  WILL SHOW (daysLeft<=30 or status!=active)'}`);
      console.log(`  Sub Systems? ${planCode !== 'FREE' && active.status ? '✅ SHOULD APPEAR' : '❌ HIDDEN'}`);
    }
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
})();
