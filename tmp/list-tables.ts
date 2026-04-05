import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await prisma.$queryRawUnsafe(`SHOW TABLES`);
    console.log('Tables in database:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error listing tables:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
