import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 读取"理解方程"的 analysisPrompt
  const pc = await prisma.presetConversation.findFirst({
    where: { title: '理解方程' },
  });
  if (!pc) { console.log('未找到理解方程'); return; }

  console.log('=== analysisPrompt 内容 ===');
  console.log(pc.analysisPrompt);
  console.log('\n=== analysisPrompt 中引用的变量 ===');
  const vars = pc.analysisPrompt?.match(/\{(\w+)\}/g) || [];
  console.log(vars.length > 0 ? vars.join(', ') : '无变量引用');

  // 可用的变量列表
  const availableVars = [
    '{pcTitle}', '{pcDescription}', '{spTitle}',
    '{spObjectives}', '{spRequirements}',
    '{activeCount}', '{totalStudents}',
    '{personalDialogContents}',
  ];
  console.log('\n=== 可用变量 ===');
  console.log(availableVars.join(', '));
  console.log('\n=== 不匹配的变量（写了但系统不识别） ===');
  for (const v of vars) {
    if (!availableVars.includes(v)) {
      console.log(`❌ ${v} - 此变量系统不存在！`);
    } else {
      console.log(`✅ ${v}`);
    }
  }
  
  await prisma.$disconnect();
}

main().catch(console.error);