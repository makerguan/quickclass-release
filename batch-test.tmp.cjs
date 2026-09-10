// 批量分析效果测试：node batch-test.tmp.cjs parallel|serial
const { PrismaClient } = require("@prisma/client");
const { SignJWT } = require("jose");
const fs = require("fs");
const prisma = new PrismaClient();
const MODE = process.argv[2] === "serial" ? "serial" : "parallel";
const BATCH = 6;

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

async function main() {
  const task = await prisma.learningTask.findFirst({
    where: { subProjects: { some: { PresetConversation: { some: {} } } } },
    include: { subProjects: { include: { PresetConversation: true } } },
  });
  const assignment = await prisma.taskAssignment.findFirst({ where: { taskId: task.id } });
  const allStudents = await prisma.user.findMany({
    where: { classId: assignment.classId, name: { startsWith: "模拟学生" } },
    orderBy: { studentNo: "asc" },
  });
  const students = process.env.STUDENTS
    ? allStudents.filter((s) => process.env.STUDENTS.split(",").some((n) => s.name.includes(n)))
    : process.env.LIMIT ? allStudents.slice(0, Number(process.env.LIMIT)) : allStudents;
  console.log(`模式=${MODE} 并发批大小=${MODE === "parallel" ? BATCH : 1} 学生数=${students.length}`);

  const env = loadEnv();
  const secret = new TextEncoder().encode(env.NEXTAUTH_SECRET || "quickclass-secret-key-2026");
  const token = await new SignJWT({ userId: task.teacherId, role: "TEACHER" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(secret);

  const url = `http://localhost:3000/api/tasks/${task.id}/insights`;
  const call = async (sid) => {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ classId: assignment.classId, type: "student", studentId: sid }),
      });
      return { ok: res.ok, ms: Date.now() - t0, status: res.status };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, status: e.message };
    }
  };

  const T0 = Date.now();
  let ok = 0, fail = 0;
  const slow = [];
  if (MODE === "parallel") {
    for (let i = 0; i < students.length; i += BATCH) {
      const batch = students.slice(i, i + BATCH);
      const t0 = Date.now();
      const rs = await Promise.all(batch.map((s) => call(s.id)));
      const bOk = rs.filter((r) => r.ok).length;
      ok += bOk; fail += rs.length - bOk;
      rs.forEach((r, j) => { if (r.ms > 30000) slow.push(`${batch[j].name}:${(r.ms / 1000).toFixed(1)}s`); });
      console.log(`批 ${String(i / BATCH + 1).padStart(2)} [${batch[0].name}..${batch[batch.length - 1].name}] 成功${bOk}/${rs.length} 批耗时${((Date.now() - t0) / 1000).toFixed(1)}s 单个:${rs.map((r) => (r.ms / 1000).toFixed(0) + "s").join(",")}`);
    }
  } else {
    for (const s of students) {
      const r = await call(s.id);
      if (r.ok) ok++; else fail++;
      console.log(`${s.name} ${r.ok ? "OK" : "FAIL(" + r.status + ")"} ${ (r.ms / 1000).toFixed(1)}s`);
    }
  }
  const total = (Date.now() - T0) / 1000;
  console.log(`\n===== ${MODE} 结果：成功${ok} 失败${fail} 总耗时${total.toFixed(1)}s 人均${(total / students.length).toFixed(1)}s =====`);
  if (slow.length) console.log("超30s的调用:", slow.join(", "));
}

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); }).finally(() => prisma.$disconnect());
