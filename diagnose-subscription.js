/**
 * Dump subscription + plan for premium.test@email.com to see what /api/v1/subscriptions returns.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email: 'premium.test@email.com' } });
    if (!user) return console.log('User not found');

    const sub = await prisma.subscriptions.findFirst({
      where: { tenant_id: user.tenantId },
      orderBy: { created_at: 'desc' },
    });
    console.log('--- SUBSCRIPTION ---');
    console.log('id:               ', sub?.id);
    console.log('subscription_code:', sub?.subscription_code);
    console.log('status:           ', sub?.status);
    console.log('plan_id:          ', sub?.plan_id);
    console.log('previous_plan_id: ', sub?.previous_plan_id);
    console.log('start_date:       ', sub?.start_date);
    console.log('end_date:         ', sub?.end_date);
    console.log('auto_renew:       ', sub?.auto_renew);

    if (sub) {
      const plan = await prisma.plans.findUnique({ where: { id: sub.plan_id } });
      console.log('\n--- PLAN ---');
      console.log('code:        ', plan?.code);
      console.log('name:        ', plan?.name);
      console.log('monthly_price:', plan?.monthly_price);
      console.log('max_rooms:   ', plan?.max_rooms);
      console.log('max_users:   ', plan?.max_users);
    }

    // What subscription.plan.code looks like (front-end check)
    console.log('\n--- FRONT-END SIDEBAR CHECK ---');
    const plan = sub ? await prisma.plans.findUnique({ where: { id: sub.plan_id } }) : null;
    const planCode = (plan?.code || 'FREE').toUpperCase();
    console.log('planCode:     ', planCode);
    console.log('is FREE?:     ', planCode === 'FREE');
    console.log('Sub Systems shown?', planCode !== 'FREE' ? '✅ YES' : '❌ NO (hidden)');
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
})();
