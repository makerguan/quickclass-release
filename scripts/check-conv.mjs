import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const convs = await prisma.conversation.findMany({});
  console.log("Conversations:", convs.length);
  convs.forEach(c => {
    console.log("ID:", c.id, "userId:", c.userId, "pcId:", c.presetConversationId);
  });
  const msgs = await prisma.message.findMany({ take: 10 });
  console.log("Messages:", msgs.length);
  msgs.forEach(m => {
    console.log("  id:", m.id, "convId:", m.conversationId, "role:", m.role);
  });
}
main().finally(() => prisma.$disconnect());
