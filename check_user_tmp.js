const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

(async () => {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { email: 'premium.test@email.com' },
      include: { tenant: true },
    });

    if (!user) {
      console.log('❌ User NOT FOUND in database');
      return;
    }

    console.log('✅ User found:');
    console.log('  id:', user.id);
    console.log('  email:', user.email);
    console.log('  role:', user.role);
    console.log('  status:', user.status);
    console.log('  tenantId:', user.tenantId);
    console.log('  tenant:', user.tenant?.name);
    console.log('  expiresAt:', user.expiresAt);
    console.log('  allowedSystems:', user.allowedSystems);
    console.log('  password hash:', user.password?.substring(0, 20) + '...');

    // Test password
    const testPasswords = ['SeedDev@2026!', 'password', 'admin123', 'Test@2026!'];
    for (const pw of testPasswords) {
      const ok = await bcrypt.compare(pw, user.password);
      console.log(`  Password "${pw}":`, ok ? '✅ MATCH' : '❌ no match');
    }

    // Check subscription
    const subs = await prisma.subscription.findMany({
      where: { tenantId: user.tenantId },
    });
    console.log('\n📦 Subscriptions:', subs.length);
    subs.forEach(s => console.log('  -', s.subscriptionCode, s.status, 'plan:', s.planId));

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
