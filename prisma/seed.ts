import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // 创建默认系统配置
  const config = await prisma.systemConfig.findFirst();
  if (!config) {
    await prisma.systemConfig.create({
      data: {
        aiBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      },
    });
    console.log("✅ Created default system config");
  }

  console.log("ℹ️ 种子数据初始化完成（不创建默认教师账号）");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
