// 单个学生补测：绕过 undici 300s headersTimeout，用原生 http
const { PrismaClient } = require("@prisma/client");
const { SignJWT } = require("jose");
const http = require("http");
const fs = require("fs");
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
    req.setTimeout(0);
    req.write(data);
    req.end();
  });
}

async function main() {
  const name = process.argv[2] || "模拟学生09";
  const task = await prisma.learningTask.findFirst({
    where: { subProjects: { some: { PresetConversation: { some: {} } } } },
  });
  const assignment = await prisma.taskAssignment.findFirst({ where: { taskId: task.id } });
  const student = await prisma.user.findFirst({ where: { classId: assignment.classId, name } });
  if (!student) throw new Error(`找不到 ${name}`);

  const env = loadEnv();
  const secret = new TextEncoder().encode(env.NEXTAUTH_SECRET || "quickclass-secret-key-2026");
  const token = await new SignJWT({ userId: task.teacherId, role: "TEACHER" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(secret);

  console.log(`补测 ${name} ...`);
  const t0 = Date.now();
  try {
    const res = await post(`/api/tasks/${task.id}/insights`, token, {
      classId: assignment.classId, type: "student", studentId: student.id,
    });
    const ms = ((Date.now() - t0) / 1000).toFixed(1);
    if (res.status === 200) {
      const parsed = JSON.parse(res.body);
      console.log(`OK ${ms}s 版本v${parsed.version} 内容${parsed.content.length}字`);
    } else {
      console.log(`FAIL ${ms}s HTTP ${res.status}: ${res.body.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`FAIL ${((Date.now() - t0) / 1000).toFixed(1)}s ${e.message}`);
  }
}

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); }).finally(() => prisma.$disconnect());
