
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const user = await prisma.user.findUnique({
    where: { email: 'premium.test@email.com' },
    include: { tenant: true },
  });

  if (!user) {
    console.log('User premium.test@email.com not found');
    return;
  }

  console.log('User:', user.email, 'Role:', user.role, 'TenantID:', user.tenantId);

  const subscription = await prisma.subscriptions.findFirst({
    where: { tenant_id: user.tenantId },
    orderBy: { created_at: 'desc' },
  });

  if (!subscription) {
    console.log('No subscription found for tenant', user.tenantId);
  } else {
    console.log('Subscription Status:', subscription.status);
  }

  const addons = await prisma.subscription_features.findMany({
    where: { 
      subscriptions: { tenant_id: user.tenantId },
      is_active: 1
    },
    include: { features: true },
  });

  console.log('Active Addons:', addons.map(a => a.features.code));

  await prisma.$disconnect();
}

main();
