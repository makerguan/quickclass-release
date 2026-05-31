import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const pc = await prisma.presetConversation.findFirst({
    where: { title: '理解方程' },
  });
  if (!pc || !pc.analysisPrompt) {
    console.log('未找到"理解方程"或 analysisPrompt 为空');
    return;
  }

  const updated = pc.analysisPrompt.replace(/\{dialogContent\}/g, '{personalDialogContents}');

  if (updated === pc.analysisPrompt) {
    console.log('无需更新，未找到 {dialogContent}');
    return;
  }

  await prisma.presetConversation.update({
    where: { id: pc.id },
    data: { analysisPrompt: updated },
  });

  console.log('✅ 已更新变量名: {dialogContent} → {personalDialogContents}');
  console.log('\n原内容:');
  console.log(pc.analysisPrompt);
  console.log('\n新内容:');
  console.log(updated);

  await prisma.$disconnect();
}

main().catch(console.error);