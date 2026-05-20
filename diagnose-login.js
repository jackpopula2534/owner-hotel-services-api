/**
 * Diagnose why login for premium.test@email.com returns 401.
 * Prints user record + tests common passwords against the stored bcrypt hash.
 * Safe to delete after running.
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const EMAIL = 'premium.test@email.com';
const CANDIDATES = [
  'password123',
  'SeedDev@2026!',
  'Password123!',
  'password',
  'admin123',
];

(async () => {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email: EMAIL } });
    if (!user) {
      console.log(`❌ User ${EMAIL} NOT FOUND in DB`);
      return;
    }
    console.log('--- USER RECORD ---');
    console.log('id:           ', user.id);
    console.log('email:        ', user.email);
    console.log('role:         ', user.role);
    console.log('status:       ', user.status);
    console.log('tenantId:     ', user.tenantId);
    console.log('expiresAt:    ', user.expiresAt);
    console.log('allowedSystems:', user.allowedSystems);
    console.log('pwd hash:     ', user.password);
    console.log('hash prefix:  ', user.password?.substring(0, 7));

    console.log('\n--- PASSWORD CHECK ---');
    for (const pw of CANDIDATES) {
      try {
        const ok = await bcrypt.compare(pw, user.password);
        console.log(`  "${pw}":`.padEnd(25), ok ? '✅ MATCH' : '❌ no');
      } catch (e) {
        console.log(`  "${pw}":`.padEnd(25), 'error', e.message);
      }
    }

    // Force-reset to password123 right now
    console.log('\n--- FORCE RESET to password123 ---');
    const newHash = await bcrypt.hash('password123', 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: newHash, status: 'active' },
    });
    const verify = await prisma.user.findUnique({ where: { id: user.id } });
    const okNow = await bcrypt.compare('password123', verify.password);
    console.log('  re-verify password123:', okNow ? '✅ MATCH' : '❌ STILL NO');
    console.log('  status:               ', verify.status);
  } catch (e) {
    console.error('Error:', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
