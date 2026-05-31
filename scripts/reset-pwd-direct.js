const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const phone = '13800138000';
  const password = '123456';
  
  const hash = bcrypt.hashSync(password, 10);
  console.log('Hash:', hash);
  
  const user = await prisma.user.findFirst({ where: { phone } });
  if (!user) { console.error('User not found'); process.exit(1); }
  
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { password: hash },
  });
  
  console.log('Updated:', updated.name);
  console.log('Verified:', bcrypt.compareSync(password, updated.password));
}

main().catch(console.error).finally(() => prisma.$disconnect());
