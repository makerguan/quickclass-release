import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const phone = '13800138000';
  const password = '123456';
  
  // 检查用户是否存在
  const user = await prisma.user.findUnique({
    where: { phone },
  });
  
  if (!user) {
    console.error(`User with phone ${phone} not found`);
    // 列出所有教师账号
    const teachers = await prisma.user.findMany({ where: { role: 'TEACHER' } });
    console.log('Available teachers:');
    teachers.forEach(t => console.log(`- Phone: ${t.phone}, Name: ${t.name}, Email: ${t.email}`));
    process.exit(1);
  }
  
  const passwordHash = bcrypt.hashSync(password, 10);
  console.log('New password hash:', passwordHash);
  
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { password: passwordHash },
  });
  
  console.log(`Password reset for user: ${updated.name} (${updated.phone})`);
  
  // 验证密码
  const verified = bcrypt.compareSync(password, updated.password!);
  console.log('Password verified:', verified);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
