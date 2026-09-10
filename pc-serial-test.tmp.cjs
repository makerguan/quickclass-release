// pc insights dbWrite 串行化测试：同学生并发3次 + 5学生各1次，验证版本号不重复、无锁错误
const { PrismaClient } = require("@prisma/client");
const { SignJWT } = require("jose");
const fs = require("fs");
const prisma = new PrismaClient();

function loadEnv() {
  try {
    const env = {};
    for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      let v = line.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      env[line.slice(0, i).trim()] = v;
    }
    return env;
  } catch { return {}; }
}

const PC_ID = "cmsigamxs000x17a76p8hc3co";

async function main() {
  const task = await prisma.learningTask.findFirst({ where: { subProjects: { some: { PresetConversation: { some: {} } } } } });
  const assignment = await prisma.taskAssignment.findFirst({ where: { taskId: task.id } });
  const classId = assignment.classId;
  const students = await prisma.user.findMany({
    where: { classId, name: { startsWith: "模拟学生" } },
    orderBy: { studentNo: "asc" }, take: 6,
  });

  // 基线：每人当前最大版本
  const baseline = {};
  for (const s of students) {
    const last = await prisma.aIInsight.findFirst({
      where: { classId, type: "pc_student", scopeId: PC_ID, userId: s.id },
      orderBy: { version: "desc" },
    });
    baseline[s.id] = last?.version || 0;
  }
  console.log("基线版本:", Object.fromEntries(students.map(s => [s.name, baseline[s.id]])));

  const env = loadEnv();
  const secret = new TextEncoder().encode(env.NEXTAUTH_SECRET || "quickclass-secret-key-2026");
  const token = await new SignJWT({ userId: task.teacherId, role: "TEACHER" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(secret);

  const url = `http://localhost:3000/api/preset-conversations/${PC_ID}/insights`;
  const call = async (sid, tag) => {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ classId, type: "student", studentId: sid }),
      });
      const body = await res.json().catch(() => ({}));
      return { tag, ok: res.ok, status: res.status, version: body.version, err: body.error, ms: Date.now() - t0 };
    } catch (e) {
      return { tag, ok: false, status: "EXC", version: null, err: e.message, ms: Date.now() - t0 };
    }
  };

  // 并发 8 个：学生1×3 + 学生2..6×1
  const jobs = [
    call(students[0].id, `${students[0].name}#a`),
    call(students[0].id, `${students[0].name}#b`),
    call(students[0].id, `${students[0].name}#c`),
    ...students.slice(1).map((s) => call(s.id, s.name)),
  ];
  console.log(`\n发射 ${jobs.length} 个并发 POST（${students[0].name} 占 3 个）...`);
  const T0 = Date.now();
  const results = await Promise.all(jobs);

  console.log("\n--- 响应明细 ---");
  for (const r of results) {
    console.log(`${r.tag.padEnd(12)} ${r.ok ? "OK" : "FAIL"} status=${r.status} version=${r.version} ${(r.ms / 1000).toFixed(1)}s${r.err ? " err=" + r.err : ""}`);
  }

  // 判定
  const fails = results.filter(r => !r.ok);
  const lockErrors = results.filter(r => r.err && /SQLITE|database is locked|busy/i.test(String(r.err)));
  const s0 = results.filter(r => r.tag.startsWith(students[0].name));
  const s0Versions = s0.map(r => r.version).filter(v => v != null).sort((a, b) => a - b);
  const expectedS0 = [baseline[students[0].id] + 1, baseline[students[0].id] + 2, baseline[students[0].id] + 3];
  const othersOk = results.filter(r => !r.tag.startsWith(students[0].name)).every(r => r.ok && r.version === baseline[students.find(s => r.tag.startsWith(s.name)).id] + 1);

  // DB 实际写入核对（同学生三行版本应连续不重复）
  const dbRows = await prisma.aIInsight.findMany({
    where: { classId, type: "pc_student", scopeId: PC_ID, userId: students[0].id },
    orderBy: { version: "asc" }, select: { version: true },
  });
  const dbVersions = dbRows.map(r => r.version);
  const dupInDb = dbVersions.length !== new Set(dbVersions).size;

  console.log("\n--- 判定 ---");
  console.log(`1. 无失败请求:          ${fails.length === 0 ? "PASS" : "FAIL (" + fails.length + " 个)"}`);
  console.log(`2. 无 SQLite 锁错误:    ${lockErrors.length === 0 ? "PASS" : "FAIL: " + lockErrors.map(e => e.err).join("; ")}`);
  console.log(`3. 同学生3并发版本:     返回=${JSON.stringify(s0Versions)} 期望=${JSON.stringify(expectedS0)} → ${JSON.stringify(s0Versions) === JSON.stringify(expectedS0) ? "PASS" : "FAIL"}`);
  console.log(`4. DB中版本无重复:      ${dupInDb ? "FAIL: " + JSON.stringify(dbVersions) : "PASS (" + dbVersions.join(",") + ")"}`);
  console.log(`5. 其余5学生版本=基线+1: ${othersOk ? "PASS" : "FAIL"}`);
  console.log(`\n总耗时 ${((Date.now() - T0) / 1000).toFixed(1)}s`);
}
main().catch(e => { console.error("ERR:", e.message); process.exit(1); }).finally(() => prisma.$disconnect());
