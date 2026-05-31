import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const pc = await prisma.presetConversation.findFirst({ where: { title: '理解方程' } });
  if (!pc) { console.log('未找到'); return; }

  console.log('=== analysisPrompt (个人分析提示词) ===');
  console.log(pc.analysisPrompt?.substring(0, 200) || '(空)');
  console.log('\n=== classAnalysisPrompt (全班分析提示词) ===');
  console.log(pc.classAnalysisPrompt || '(空)');

  await prisma.$disconnect();
}

main().catch(console.error);