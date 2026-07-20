// 测试 sortReferencesByCitation 行为
function extractCitationOrder(sections) {
  const seen = new Set();
  const order = [];
  const re = /\[(\d+)\]/g;
  for (const sec of sections) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(sec.content)) !== null) {
      const num = parseInt(m[1], 10);
      if (num >= 1 && num <= 999 && !seen.has(num)) {
        seen.add(num);
        order.push(num);
      }
    }
  }
  return order;
}

function sortReferencesByCitation(references, sections) {
  const refMap = new Map();
  for (const r of references) {
    const m = r.match(/^\[(\d+)\]\s*([\s\S]*)$/);
    if (m) refMap.set(parseInt(m[1], 10), m[2].trim());
  }
  const order = extractCitationOrder(sections);
  const orderSet = new Set(order);
  const citedOldNums = order.filter(n => refMap.has(n));
  const uncitedOldNums = Array.from(refMap.keys()).filter(n => !orderSet.has(n)).sort((a, b) => a - b);

  const oldToNew = new Map();
  const reorderedRefs = [];
  let newNum = 1;
  for (const oldNum of citedOldNums) {
    oldToNew.set(oldNum, newNum);
    reorderedRefs.push(`[${newNum}] ${refMap.get(oldNum)}`);
    newNum++;
  }
  for (const oldNum of uncitedOldNums) {
    oldToNew.set(oldNum, newNum);
    reorderedRefs.push(`[${newNum}] ${refMap.get(oldNum)}`);
    newNum++;
  }

  const replaceInText = (s) => {
    if (oldToNew.size === 0) return s;
    return s.replace(/\[(\d+)\]/g, (m, n) => {
      const oldNum = parseInt(n, 10);
      const mapped = oldToNew.get(oldNum);
      return mapped !== undefined ? `[${mapped}]` : m;
    });
  };

  const newSections = sections.map(s => ({
    title: replaceInText(s.title),
    content: replaceInText(s.content),
  }));

  return { reorderedRefs, newSections, oldToNew };
}

// ── 测试 1：典型场景 ──
console.log("=== 测试 1：典型场景 ===");
const sections1 = [
  { title: "（一）研究缘起", content: "本课题聚焦数据驱动的教育评价改革[3]，并结合新课程标准[1]展开研究。已有研究[5]表明该方向具有重要价值。" },
  { title: "（三）文献综述", content: "国际研究[7]和国内研究[2]均对此进行了探讨，另有学者[5]补充了实证证据。" },
];
const refs1 = [
  "[1] 张三. 新课标解读[J]. 期刊A, 2020.",
  "[2] 李四. 国内研究综述[J]. 期刊B, 2021.",
  "[3] 王五. 数据驱动教育评价[J]. 期刊C, 2022.",
  "[5] 赵六. 实证研究[J]. 期刊D, 2023.",
  "[7] Smith. International Study[J]. 期刊E, 2019.",
  "[9] 未被引用的文献[J]. 期刊F, 2018.",  // 这个编号 [9] 没在正文中出现
];
const r1 = sortReferencesByCitation(refs1, sections1);
console.log("oldToNew:", Array.from(r1.oldToNew.entries()).sort((a,b)=>a[1]-b[1]).map(([o,n])=>`${o}→${n}`).join(", "));
console.log("重排后 references:");
r1.reorderedRefs.forEach((r, i) => console.log(`  ${r}`));
console.log("新 sections[0].content 前 80 字:", r1.newSections[0].content.slice(0, 80));
console.log("新 sections[1].content 前 80 字:", r1.newSections[1].content.slice(0, 80));

// ── 测试 2：完全按引用顺序 ──
console.log("\n=== 测试 2：只引用了部分 ===");
const sections2 = [
  { title: "正文", content: "先引[5]，再引[2]，最后引[1]。" },
];
const refs2 = ["[1] A", "[2] B", "[3] C", "[4] D", "[5] E"];
const r2 = sortReferencesByCitation(refs2, sections2);
console.log("重排后:", r2.reorderedRefs);
console.log("期望: [1]E [2]B [3]A [4]C [5]D  （[5]E 第一个引→[1]，[2]B→[2]，[1]A→[3]，[3][4] 未引→末尾）");
console.log("oldToNew:", Array.from(r2.oldToNew.entries()).sort((a,b)=>a[1]-b[1]).map(([o,n])=>`${o}→${n}`).join(", "));
console.log("新 content:", r2.newSections[0].content);

// ── 测试 3：空 references ──
console.log("\n=== 测试 3：空 references ===");
const r3 = sortReferencesByCitation([], sections1);
console.log("reorderedRefs:", r3.reorderedRefs);
console.log("newSections[0].content 不变:", r3.newSections[0].content === sections1[0].content);

// ── 断言 ──
const fail = (m) => { console.error("❌", m); process.exit(1); };
const pass = (m) => console.log("✅", m);

// 测试 1 断言
if (r1.reorderedRefs[0] !== "[1] 王五. 数据驱动教育评价[J]. 期刊C, 2022.") fail("Test1 首位应是 [1]王五（[3]→[1]）");
if (r1.reorderedRefs[5] !== "[6] 未被引用的文献[J]. 期刊F, 2018.") fail("Test1 末位应是 [6]未被引用的");
if (r1.oldToNew.get(3) !== 1) fail("Test1 oldToNew: 3→1");
if (r1.oldToNew.get(1) !== 2) fail("Test1 oldToNew: 1→2");
if (r1.oldToNew.get(5) !== 3) fail("Test1 oldToNew: 5→3");
if (r1.oldToNew.get(9) !== 6) fail("Test1 oldToNew: 9→6（未引用的最后）");
if (!r1.newSections[0].content.includes("数据驱动的教育评价改革[1]")) fail("Test1 正文 [3]→[1] 替换未生效");
if (!r1.newSections[0].content.includes("新课程标准[2]")) fail("Test1 正文 [1]→[2] 替换未生效");
if (!r1.newSections[0].content.includes("已有研究[3]")) fail("Test1 正文 [5]→[3] 替换未生效");

// 测试 2 断言
if (r2.reorderedRefs[0] !== "[1] E") fail("Test2 首位应是 E");
if (r2.reorderedRefs[4] !== "[5] D") fail("Test2 末位应是 D");
if (!r2.newSections[0].content.includes("[1]") || !r2.newSections[0].content.includes("[2]") || !r2.newSections[0].content.includes("[3]")) {
  fail("Test2 正文 [N] 替换未生效");
}

pass("全部测试通过");
