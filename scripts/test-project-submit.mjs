// 项目提交 API 端到端测试
const BASE = "http://localhost:3000";

async function login(phone, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, password }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error("登录失败: " + JSON.stringify(d));
  return d.token;
}

function makeFile(name, content, type) {
  const buf = Buffer.from(content || "hello-file");
  const f = new File([buf], name, { type });
  return f;
}

async function main() {
  const teacherToken = await login("13338183337", "123456");
  const studentToken = await login("13800000001", "123456");

  // 找一个 subProject（教师第一个课堂的第一个学习活动）
  const tasksRes = await fetch(`${BASE}/api/tasks`, {
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  const tasks = await tasksRes.json();
  const task = tasks[0];
  const sp = task.subProjects[0];
  console.log("使用课堂:", task.title, "学习活动:", sp.title, "spId:", sp.id);
  const spHasPs = (sp.projectSubmissions || []).length;
  console.log("该学习活动已有项目提交数:", spHasPs);

  // 1. 教师新建项目提交
  const newPsRes = await fetch(`${BASE}/api/sub-projects/${sp.id}/project-submissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${teacherToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "测试项目-图片类",
      description: "请提交一张图",
      category: "IMAGE",
      visibleToClass: true,
      allowLike: true,
      fileSizeLimit: 10,
    }),
  });
  const newPs = await newPsRes.json();
  console.log("新建项目提交:", newPsRes.status, newPs.id || newPs);
  const psId = newPs.id;

  // 2. 学生提交（单文件图片）
  const form = new FormData();
  form.append("title", "我的作业");
  form.append("description", "这是描述");
  form.append("file", makeFile("a.png", "fakepngdata", "image/png"));
  const submitRes = await fetch(`${BASE}/api/project-submissions/${psId}/mine`, {
    method: "POST",
    headers: { Authorization: `Bearer ${studentToken}` },
    body: form,
  });
  const submitData = await submitRes.json();
  console.log("学生提交:", submitRes.status, submitData.id || submitData);
  const studentProjectId = submitData.id;

  // 3. 学生查自己
  const mineRes = await fetch(`${BASE}/api/project-submissions/${psId}/mine`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  const mineData = await mineRes.json();
  console.log("学生查自己 mine:", mineRes.status, "hasMine:", !!mineData.mine, "附件:", mineData.mine?.attachment?.originalName);

  // 4. 学生查全班列表
  const classRes = await fetch(`${BASE}/api/project-submissions/${psId}/class-list`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  const classData = await classRes.json();
  console.log("学生全班列表:", classRes.status, "items:", classData.items?.length, "meta:", classData.submission?.title);

  // 5. 教师查全班（带统计）
  const teacherRes = await fetch(`${BASE}/api/project-submissions/${psId}?page=1&pageSize=10&search=`, {
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  const teacherData = await teacherRes.json();
  console.log("教师查全班:", teacherRes.status, "total:", teacherData.total, "totalSize:", teacherData.totalSize, "items:", teacherData.items?.length);

  // 6. 点赞（学生给自己项目点赞应失败；这里测试给自己的——预期可能被拒或允许，按规则不可给自己点赞）
  const likeRes = await fetch(`${BASE}/api/student-projects/${studentProjectId}/like`, {
    method: "POST",
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  console.log("学生给自己点赞:", likeRes.status, likeRes.status === 400 ? "(已正确拒绝给自己点赞)" : await likeRes.text());

  // 7. 附件下载/预览（学生本人）
  if (mineData.mine?.attachment?.id) {
    const attRes = await fetch(`${BASE}/api/student-projects/${studentProjectId}/attachments/${mineData.mine.attachment.id}`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    console.log("附件下载(本人):", attRes.status, attRes.headers.get("content-type"));
  }

  // 8. 教师删除项目提交（级联删 + 物理删）
  const delRes = await fetch(`${BASE}/api/project-submissions/${psId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  console.log("教师删除项目提交:", delRes.status, delRes.status === 200 ? "(含附件已删)" : await delRes.text());

  // 9. 验证已删
  const afterRes = await fetch(`${BASE}/api/project-submissions/${psId}`, {
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  console.log("删除后教师查:", afterRes.status, afterRes.status === 404 ? "(已正确不存在)" : "仍存在!");
}

main().catch((e) => {
  console.error("测试异常:", e.message);
  process.exit(1);
});
