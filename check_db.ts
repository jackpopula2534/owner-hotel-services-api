import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const employees = await prisma.employee.findMany();
  console.log('Employees array:', employees.map(e => ({ id: e.id, email: e.email, propertyId: (e as any).propertyId, tenantId: e.tenantId })));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect()
  })
