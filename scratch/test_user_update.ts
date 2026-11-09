
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function testUpdateBehavior() {
  const email = 'procurement.manager@mountainviewresort.test';
  
  // 1. Get current user
  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user) {
    console.error('User not found');
    return;
  }

  const originalHash = user.password;
  console.log('Original hash:', originalHash);

  // 2. Simulate update WITHOUT password (e.g. updating name)
  // This mimics what happens in the service if dto.password is undefined
  console.log('Updating firstName only...');
  await prisma.user.update({
    where: { id: user.id },
    data: { firstName: 'Updated Name' }
  });

  const afterNameUpdate = await prisma.user.findUnique({ where: { id: user.id } });
  console.log('Hash after name update:', afterNameUpdate?.password);
  console.log('Did hash change?', originalHash !== afterNameUpdate?.password);

  // 3. Simulate update WITH empty password (if frontend sends "")
  console.log('Updating with empty password string...');
  const dtoPassword = "";
  const data: any = { lastName: 'Updated Lastname' };
  if (dtoPassword) {
    data.password = await bcrypt.hash(dtoPassword, 10);
  }
  
  await prisma.user.update({
    where: { id: user.id },
    data
  });

  const afterEmptyPassUpdate = await prisma.user.findUnique({ where: { id: user.id } });
  console.log('Hash after empty password update:', afterEmptyPassUpdate?.password);
  console.log('Did hash change?', originalHash !== afterEmptyPassUpdate?.password);

  // 4. Simulate ACTUAL password update
  console.log('Updating with NEW password "procure123"...');
  const newPass = "procure123";
  const hashedNew = await bcrypt.hash(newPass, 10);
  
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedNew }
  });

  const finalUser = await prisma.user.findUnique({ where: { id: user.id } });
  console.log('Final hash:', finalUser?.password);
  
  const isMatch = await bcrypt.compare('procure123', finalUser?.password || '');
  console.log('Does "procure123" match final hash?', isMatch);

  await prisma.$disconnect();
}

testUpdateBehavior().catch(console.error);
