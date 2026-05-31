import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const pc = await prisma.presetConversation.findFirst({ where: { title: '理解方程' } });
  if (!pc) { console.log('未找到'); return; }

  console.log('=== 当前 analysisPrompt ===\n');
  console.log(pc.analysisPrompt);
  console.log('\n=== 是否包含HTML指令 ===');
  console.log(pc.analysisPrompt?.includes('html') ? '✅ 包含' : '❌ 不包含');
  console.log(pc.analysisPrompt?.includes('HTML') ? '✅ 包含' : '❌ 不包含');
  console.log(pc.analysisPrompt?.includes('<!DOCTYPE') ? '✅ 包含' : '❌ 不包含');

  await prisma.$disconnect();
}

main().catch(console.error);