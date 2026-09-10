// 验证 in-flight 生成合并：并发 2 个同学生分析请求
// 预期：都成功、版本/内容一致、DB 只新增 1 个版本
const { PrismaClient } = require("@prisma/client");
const { SignJWT } = require("jose");
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const prisma = new PrismaClient();

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[line.slice(0, i).trim()] = v;
  }
  return env;
}

function post(urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        host: "localhost", port: 3000, path: urlPath, method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Content-Length": Buffer.byteLength(data) },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode, body: buf }));
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const task = await prisma.learningTask.findFirst({
    where: { subProjects: { some: { PresetConversation: { some: {} } } } },
  });
  const assignment = await prisma.taskAssignment.findFirst({ where: { taskId: task.id } });
  const student = await prisma.user.findFirst({ where: { classId: assignment.classId, name: "模拟学生01" } });

  const env = loadEnv();
  const secret = new TextEncoder().encode(env.NEXTAUTH_SECRET || "quickclass-secret-key-2026");
  const token = await new SignJWT({ userId: task.teacherId, role: "TEACHER" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(secret);

  const where = { classId: assignment.classId, type: "task_student", userId: student.id, scopeId: task.id };
  const before = await prisma.aIInsight.findFirst({ where, orderBy: { version: "desc" } });
  console.log(`学生: ${student.name} | 生成前最新版本: v${before?.version || 0}`);

  const t0 = Date.now();
  const body = { classId: assignment.classId, type: "student", studentId: student.id };
  const [r1, r2] = await Promise.all([
    post(`/api/tasks/${task.id}/insights`, token, body),
    post(`/api/tasks/${task.id}/insights`, token, body),
  ]);
  const sec = ((Date.now() - t0) / 1000).toFixed(1);

  const sum = (r) => {
    if (r.status !== 200) return `HTTP ${r.status}: ${r.body.slice(0, 120)}`;
    const d = JSON.parse(r.body);
    return `v${d.version} ${d.content.length}字 hash=${crypto.createHash("md5").update(d.content).digest("hex").slice(0, 8)} id=${d.id}`;
  };
  console.log(`总耗时 ${sec}s`);
  console.log("请求1:", sum(r1));
  console.log("请求2:", sum(r2));

  const after = await prisma.aIInsight.findMany({ where, orderBy: { version: "desc" }, take: 3, select: { version: true, content: true } });
  console.log(`生成后新增版本数: ${after.length - (before ? Math.min(after.length, 1) : 0) >= 0 ? after.filter(a => a.version > (before?.version || 0)).length : "?"} | 最新: v${after[0]?.version}`);
  const dup = after.filter(a => a.version > (before?.version || 0));
  console.log(dup.length === 1 ? "✅ 验证通过：只产生 1 个新版本，无重复" : `❌ 产生了 ${dup.length} 个新版本`);
}

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); }).finally(() => prisma.$disconnect());
