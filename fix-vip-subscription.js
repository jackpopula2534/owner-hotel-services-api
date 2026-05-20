/**
 * Promote premium.test@email.com's subscription (SUB-002) to a true VIP/Enterprise
 * status — end_date 1 year out, tenant.trial_ends_at far in the past, so the
 * Trial banner stops appearing.
 *
 * Run once after pulling the updated seeder. Safe to delete after.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { email: 'premium.test@email.com' },
    });
    if (!user?.tenantId) return console.log('User or tenant not found');

    const now = new Date();
    const vipEnd = new Date(now);
    vipEnd.setFullYear(vipEnd.getFullYear() + 1);
    const longAgo = new Date(now);
    longAgo.setFullYear(longAgo.getFullYear() - 1);

    // 1. Update subscription end_date → 1 year from now, ensure status=active
    const sub = await prisma.subscriptions.findFirst({
      where: { tenant_id: user.tenantId },
      orderBy: { created_at: 'desc' },
    });
    if (!sub) return console.log('No subscription found');

    await prisma.subscriptions.update({
      where: { id: sub.id },
      data: {
        status: 'active',
        end_date: vipEnd,
        auto_renew: 1, // schema stores as TINYINT (Int), not Boolean
      },
    });
    console.log('✅ Subscription updated:');
    console.log('   id:        ', sub.id);
    console.log('   end_date:  ', vipEnd.toISOString().split('T')[0]);
    console.log('   status:    ', 'active');
    console.log('   auto_renew:', 1);

    // 2. Push tenant.trial_ends_at far into the past so Trial banner / lifecycle
    //    code never treats this tenant as trial-eligible again.
    const tenant = await prisma.tenants.update({
      where: { id: user.tenantId },
      data: {
        status: 'active',
        trial_ends_at: longAgo,
      },
    });
    console.log('\n✅ Tenant updated:');
    console.log('   id:           ', tenant.id);
    console.log('   status:       ', tenant.status);
    console.log('   trial_ends_at:', tenant.trial_ends_at);

    console.log('\nDone. Refresh the dashboard — the Trial banner should disappear');
    console.log('and "Sub Systems" should now appear in the sidebar.');
  } catch (e) {
    console.error('Error:', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
