import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 查询所有教师
  const teachers = await prisma.user.findMany({ 
    where: { role: 'TEACHER' },
    select: { id: true, phone: true, name: true, email: true, password: true }
  });
  
  console.log('All teachers:');
  console.log(JSON.stringify(teachers, null, 2));
  
  // 尝试查找手机号
  const user = await prisma.user.findFirst({
    where: { phone: '13800138000' },
  });
  
  console.log('\nFind by phone 13800138000:', user ? `Found: ${user.name}` : 'NOT FOUND');
  
  // 如果找到，重置密码
  if (user) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('123456', 10);
    console.log('\nNew password hash:', hash);
    
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { password: hash },
    });
    
    console.log('Password updated for:', updated.name);
    
    // 验证
    const verified = bcrypt.compareSync('123456', updated.password!);
    console.log('Password verified:', verified);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
