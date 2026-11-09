/**
 * One-off script to reset test user passwords to `password123`.
 * Usage:  node reset-test-password.js
 * Safe to delete after running.
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const TARGET_EMAILS = [
  'premium.test@email.com',
  'somchai@email.com',
  'seaside@email.com',
  'garden@email.com',
];
const NEW_PASSWORD = 'password123';

(async () => {
  const prisma = new PrismaClient();
  try {
    const hash = await bcrypt.hash(NEW_PASSWORD, 10);
    for (const email of TARGET_EMAILS) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        console.log(`  ❌ NOT FOUND: ${email}`);
        continue;
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { password: hash, status: 'active' },
      });
      console.log(`  ✅ Updated: ${email}  (role=${user.role}, tenantId=${user.tenantId})`);
    }
    console.log('\nDone. New password for all listed users: ' + NEW_PASSWORD);
  } catch (e) {
    console.error('Error:', e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
