// 图片库（图片组）端到端冒烟测试
// 前置：dev server 已在 localhost:3000 运行
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

// 1x1 红色 PNG
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function main() {
  const teacherToken = await login("13338183337", "123456");
  const studentToken = await login("13800000001", "123456");
  const H = { Authorization: `Bearer ${teacherToken}` };
  let pass = 0, fail = 0;
  const ok = (name, cond, extra = "") => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name} ${extra}`); }
  };

  // 1. 建组
  const gRes = await fetch(`${BASE}/api/image-groups`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "冒烟测试图组", description: "测试用" }),
  });
  const group = await gRes.json();
  ok("创建图片组", gRes.ok && group.id, JSON.stringify(group));
  const groupId = group.id;

  // 2. 上传图片（带手填描述，跳过 VL 生成避免依赖外网模型）
  const form = new FormData();
  form.append("groupId", groupId);
  form.append("file", new File([TINY_PNG], "red.png", { type: "image/png" }));
  form.append("description", "一个红色像素点，测试图");
  const upRes = await fetch(`${BASE}/api/image-groups/images`, { method: "POST", headers: H, body: form });
  const image = await upRes.json();
  ok("上传图片", upRes.ok && image.id, JSON.stringify(image));
  const imageId = image.id;

  // 3. 列表（含引用信息）
  const listRes = await fetch(`${BASE}/api/image-groups`, { headers: H });
  const list = await listRes.json();
  ok("获取组列表", listRes.ok && Array.isArray(list) && list.some((g) => g.id === groupId && g.images.length === 1));
  ok("列表含 referencedBy 字段", list.every((g) => Array.isArray(g.referencedBy)));

  // 4. 读图：学生 token（query 方式）
  const imgRes = await fetch(`${BASE}/api/images/${imageId}?token=${encodeURIComponent(studentToken)}`);
  ok("学生 query token 读图", imgRes.ok && imgRes.headers.get("content-type") === "image/png", `status=${imgRes.status}`);

  // 5. 读图：无 token 拒绝
  const noAuth = await fetch(`${BASE}/api/images/${imageId}`);
  ok("无 token 读图被拒", noAuth.status === 401, `status=${noAuth.status}`);

  // 6. 读图：header 方式
  const hdrRes = await fetch(`${BASE}/api/images/${imageId}`, { headers: { Authorization: `Bearer ${studentToken}` } });
  ok("header token 读图", hdrRes.ok);

  // 7. 改描述
  const patchRes = await fetch(`${BASE}/api/image-groups/images`, {
    method: "PATCH", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ id: imageId, description: "改后的描述" }),
  });
  const patched = await patchRes.json();
  ok("更新描述", patchRes.ok && patched.description === "改后的描述");

  // 8. 课堂引用图片组（找一个课堂）
  const tasksRes = await fetch(`${BASE}/api/tasks`, { headers: H });
  const tasks = await tasksRes.json();
  const task = tasks[0];
  ok("获取课堂列表", tasksRes.ok && task, "无课堂可测");
  if (task) {
    const putRes = await fetch(`${BASE}/api/tasks/${task.id}`, {
      method: "PUT", headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ imageGroupIds: JSON.stringify([groupId]) }),
    });
    ok("课堂引用图片组", putRes.ok, `status=${putRes.status}`);
    const taskAfter = (await (await fetch(`${BASE}/api/tasks`, { headers: H })).json()).find((t) => t.id === task.id);
    ok("imageGroupIds 已持久化", taskAfter.imageGroupIds === JSON.stringify([groupId]), taskAfter.imageGroupIds);
    // 还原
    await fetch(`${BASE}/api/tasks/${task.id}`, {
      method: "PUT", headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ imageGroupIds: null }),
    });
  }

  // 9. 禁用组后读图应 404
  await fetch(`${BASE}/api/image-groups`, {
    method: "PATCH", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ id: groupId, enabled: false }),
  });
  const disabledRes = await fetch(`${BASE}/api/images/${imageId}?token=${encodeURIComponent(studentToken)}`);
  ok("禁用组后读图 404", disabledRes.status === 404, `status=${disabledRes.status}`);
  await fetch(`${BASE}/api/image-groups`, {
    method: "PATCH", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ id: groupId, enabled: true }),
  });

  // 10. 删单图
  const delImg = await fetch(`${BASE}/api/image-groups/images?id=${imageId}`, { method: "DELETE", headers: H });
  ok("删除单图", delImg.ok);
  const gone = await fetch(`${BASE}/api/images/${imageId}?token=${encodeURIComponent(studentToken)}`);
  ok("删后读图 404", gone.status === 404, `status=${gone.status}`);

  // 11. 删组
  const delGroup = await fetch(`${BASE}/api/image-groups?id=${groupId}`, { method: "DELETE", headers: H });
  ok("删除图片组", delGroup.ok);
  const listAfter = await (await fetch(`${BASE}/api/image-groups`, { headers: H })).json();
  ok("组已从列表移除", !listAfter.some((g) => g.id === groupId));

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("测试异常:", e); process.exit(1); });
