import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const restaurants = await prisma.restaurant.findMany();
    console.log('Restaurants count:', restaurants.length);
    if (restaurants.length > 0) {
      console.log('Sample restaurant:', JSON.stringify(restaurants[0], null, 2));
    } else {
      console.log('No restaurants found.');
    }
  } catch (error) {
    console.error('Error fetching restaurants:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
