import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const phone = process.argv[2];
  const password = process.argv[3];

  if (!phone || !password) {
    console.error('Usage: npx tsx scripts/reset-password.ts <phone> <password>');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  
  const user = await prisma.user.update({
    where: { phone },
    data: { password: passwordHash },
  });

  console.log(`Password reset for user: ${user.name} (${user.phone})`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
