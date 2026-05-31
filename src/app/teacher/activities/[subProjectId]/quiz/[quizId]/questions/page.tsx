"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { MessagePlugin } from "tdesign-react";
import TeacherLayout from "@/components/layout/TeacherLayout";

interface Question {
  id?: string;
  type: string;
  content: string;
  options: string | Record<string, string>;
  answer: string;
  difficulty: string;
  explanation?: string;
  order?: number;
}

export default function TeacherQuizQuestionsPage() {
  const params = useParams();
  const router = useRouter();
  const subProjectId = params.subProjectId as string;
  const quizId = params.quizId as string;

  const [quiz, setQuiz] = useState<any>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { router.push("/login"); return; }

    fetch(`/api/quiz-activities/${quizId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok) { const text = await r.text(); throw new Error(text || `HTTP ${r.status}`); }
        return r.json();
      })
      .then((data) => {
        if (!data || !data.id) throw new Error("作业不存在");
        setQuiz(data);
        if (data.questions) setQuestions(data.questions);
        setLoading(false);
      })
      .catch((err) => {
        console.error("加载作业失败:", err);
        setLoading(false);
        setError(err.message || "加载失败");
      });
  }, [quizId, router]);

  // 题目验证
  const validateQuestions = (): string | null => {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.content.trim()) return `第 ${i + 1} 题：题目内容不能为空`;
      if (q.type === "TRUE_FALSE") {
        if (!q.answer || (q.answer !== "T" && q.answer !== "F")) return `第 ${i + 1} 题：判断题必须设置答案为 T 或 F`;
      } else if (q.type === "SINGLE_CHOICE") {
        if (!q.answer || !["A","B","C","D"].includes(q.answer)) return `第 ${i + 1} 题：单选题必须设置答案（A/B/C/D）`;
        const opts = typeof q.options === "string" ? JSON.parse(q.options || "{}") : (q.options || {});
        if (!opts.A?.trim() || !opts.B?.trim()) return `第 ${i + 1} 题：至少填写 A、B 两个选项`;
      } else if (q.type === "MULTIPLE_CHOICE") {
        if (!q.answer || q.answer.split(",").filter(Boolean).length === 0) return `第 ${i + 1} 题：多选题至少选择一个答案`;
        const opts = typeof q.options === "string" ? JSON.parse(q.options || "{}") : (q.options || {});
        if (!opts.A?.trim() || !opts.B?.trim()) return `第 ${i + 1} 题：至少填写 A、B 两个选项`;
      }
    }
    return null;
  };

  const handleSaveQuestions = async () => {
    const errMsg = validateQuestions();
    if (errMsg) { MessagePlugin.warning(errMsg); return; }
    // 如果作业已生效，需确认
    if (quiz?.status === "ACTIVE") {
      const confirmed = window.confirm(
        "作业已生效，编辑题目将使其变为失效状态，并清除学生答题记录和报告。\n\n是否继续？"
      );
      if (!confirmed) return;
    }
    setSaving(true);
    const token = localStorage.getItem("token") || "";
    await fetch(`/api/quiz-activities/${quizId}/questions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ questions }),
    });
    setSaving(false);
    MessagePlugin.success("保存成功！作业已变为失效状态。");
    setQuiz((p: any) => ({ ...p, status: "INACTIVE" }));
  };

  const handlePublish = async () => {
    if (questions.length === 0) { MessagePlugin.warning("请先添加题目"); return; }
    const token = localStorage.getItem("token") || "";
    await fetch(`/api/quiz-activities/${quizId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    setQuiz((p: any) => ({ ...p, status: "ACTIVE" }));
    MessagePlugin.success("发布成功！");
    router.push(`/teacher/tasks`);
  };

  // 导出作业为 JSON
  const handleExportQuestions = async () => {
    const token = localStorage.getItem("token") || "";
    // 获取教师姓名
    let teacherName = "教师";
    try {
      const userStr = localStorage.getItem("user");
      if (userStr) {
        const user = JSON.parse(userStr);
        teacherName = user.name || user.nickname || "教师";
      }
    } catch {}
    // 从 quiz.subProject.task 获取课堂标题（课题）、年级、学科
    const taskTitle = quiz?.SubProject?.task?.title || "未知课堂";
    const grade = quiz?.SubProject?.task?.grade || "未知年级";
    const subject = quiz?.SubProject?.task?.subject || "未知学科";
    const quizTitle = quiz?.title || "作业";
    const fileName = `${teacherName}_${grade}_${subject}_${taskTitle}_课堂作业_${quizTitle}.json`;
    const exportData = {
      teacher: teacherName,
      grade,
      subject,
      taskTitle,
      quizTitle,
      description: quiz?.description || "",
      questions: questions.map((q, i) => ({ ...q, order: i }))
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
    MessagePlugin.success("作业已导出");
  };

  // 批量导入题目
  const handleImportQuestions = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        let imported: Question[] = [];
        if (Array.isArray(data)) {
          imported = data;
        } else if (data.questions && Array.isArray(data.questions)) {
          imported = data.questions;
        } else {
          throw new Error("JSON 格式不正确，需包含 questions 数组");
        }
        // 标准化
        const standardized = imported.map((q: any, i: number) => ({
          type: q.type || "SINGLE_CHOICE",
          content: q.content || "",
          options: typeof q.options === "string" ? q.options : JSON.stringify(q.options || {}),
          answer: q.answer || "A",
          difficulty: q.difficulty || "BASIC",
          explanation: q.explanation || "",
          order: i,
        }));
        setQuestions((prev) => [...prev, ...standardized]);
        MessagePlugin.success(`成功导入 ${standardized.length} 道题`);
      } catch (err: any) {
        MessagePlugin.error(err.message || "导入失败");
      } finally {
        setImporting(false);
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  const updateQuestion = (idx: number, field: keyof Question, value: any) => {
    setQuestions((prev) => prev.map((q, i) => i === idx ? { ...q, [field]: value } : q));
  };

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    setQuestions((prev) => { const a = [...prev]; [a[idx-1], a[idx]] = [a[idx], a[idx-1]]; return a; });
  };
  const moveDown = (idx: number) => {
    if (idx === questions.length - 1) return;
    setQuestions((prev) => { const a = [...prev]; [a[idx], a[idx+1]] = [a[idx+1], a[idx]]; return a; });
  };

  if (loading) return <div className="p-6 text-center">加载中...</div>;
  if (error) return (
    <TeacherLayout>
      <div className="p-6 text-center">
        <div className="text-red-500 mb-4">{error}</div>
        <button onClick={() => router.push("/teacher/tasks")} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">返回</button>
      </div>
    </TeacherLayout>
  );
  if (!quiz) return <div className="p-6 text-center">作业不存在</div>;

  return (
    <TeacherLayout>
      <div className="p-6 max-w-6xl mx-auto">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <button onClick={() => router.push("/teacher/tasks")} className="text-sm text-gray-400 hover:text-gray-600 mb-1">← 返回课堂管理</button>
            <h1 className="text-xl font-semibold text-gray-800">{quiz.title} - 题目管理</h1>
            <div className="text-sm text-gray-400">{quiz.description || "无说明"}</div>
          </div>
          <div className="flex gap-2">
            {quiz.status === "INACTIVE" && questions.length > 0 && (
              <button onClick={handlePublish} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
                快速生效
              </button>
            )}
            <button onClick={handleExportQuestions} className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm">
              导出作业
            </button>
            <label className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm cursor-pointer">
              {importing ? "导入中..." : "导入作业"}
              <input type="file" accept=".json" onChange={handleImportQuestions} className="hidden" />
            </label>
          </div>
        </div>

        {/* 状态标签 + 只读提示 */}
        <div className="mb-4 flex items-center gap-3">
          {quiz.status === "INACTIVE" && <span className="px-3 py-1 rounded-full text-sm bg-orange-100 text-orange-700">失效中</span>}
          {quiz.status === "ACTIVE" && <span className="px-3 py-1 rounded-full text-sm bg-green-100 text-green-700">生效中</span>}
          {quiz.status === "ACTIVE" && <span className="text-sm text-gray-400">作业生效中，请先失效再编辑</span>}
          {error && <div className="text-red-500 text-sm">{error}</div>}
        </div>

        {/* 题目列表 */}
        <div className="mb-4 flex justify-between items-center">
          <div className="text-sm text-gray-500">共 {questions.length} 题</div>
          <div className="flex gap-2">
            <button 
              onClick={() => setQuestions((p) => [...p, { type: "SINGLE_CHOICE", content: "", options: { A: "", B: "", C: "", D: "" }, answer: "A", difficulty: "BASIC" }])} 
              disabled={quiz?.status === "ACTIVE"}
              className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              + 添加题目
            </button>
            {questions.length > 0 && (
              <button 
                onClick={handleSaveQuestions} 
                disabled={saving || quiz?.status === "ACTIVE"}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存题目"}
              </button>
            )}
          </div>
        </div>

        {questions.length === 0 ? (
          <div className="text-center py-12 text-gray-400 bg-white rounded-xl border">暂无题目，点击"+ 添加题目"创建</div>
        ) : (
          <div className="space-y-4">
            {questions.map((q, idx) => (
              <QuestionCard
                key={idx}
                q={q}
                idx={idx}
                total={questions.length}
                disabled={quiz?.status === "ACTIVE"}
                onUpdate={(field, value) => updateQuestion(idx, field, value)}
                onDelete={() => setQuestions((p) => p.filter((_, i) => i !== idx))}
                onMoveUp={() => moveUp(idx)}
                onMoveDown={() => moveDown(idx)}
                onPreview={() => setPreviewIdx(idx)}
              />
            ))}
          </div>
        )}

        {/* 预览弹窗 */}
        {previewIdx !== null && (
          <QuestionPreview question={questions[previewIdx]} onClose={() => setPreviewIdx(null)} />
        )}
      </div>
    </TeacherLayout>
  );
}

/* ---- 题目卡片组件 ---- */
function QuestionCard({ q, idx, total, onUpdate, onDelete, onMoveUp, onMoveDown, onPreview, disabled = false }: any) {
  const opts = typeof q.options === "string" ? JSON.parse(q.options || "{}") : (q.options || {});
  return (
    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
      <div className="flex gap-2 mb-3">
        {/* 上下移动按钮 */}
        <div className="flex flex-col gap-0.5">
          <button type="button" onClick={onMoveUp} disabled={disabled || idx === 0} className="w-5 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-xs">▲</button>
          <button type="button" onClick={onMoveDown} disabled={disabled || idx === total - 1} className="w-5 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-xs">▼</button>
        </div>
        <span className="text-xs text-gray-400 mt-1 w-6 text-right">{idx + 1}.</span>
        <select value={q.difficulty} onChange={(e) => onUpdate("difficulty", e.target.value)} disabled={disabled} className="text-xs border rounded px-2 py-1 disabled:bg-gray-100">
          <option value="BASIC">基础</option><option value="INTERMEDIATE">提升</option><option value="ADVANCED">拓展</option>
        </select>
        <select value={q.type || "SINGLE_CHOICE"} onChange={(e) => onUpdate("type", e.target.value)} disabled={disabled} className="text-xs border rounded px-2 py-1 disabled:bg-gray-100">
          <option value="SINGLE_CHOICE">单选</option><option value="MULTIPLE_CHOICE">多选</option><option value="TRUE_FALSE">判断</option>
        </select>
        {/* 答案设置 */}
        {q.type === "TRUE_FALSE" ? (
          <select value={q.answer || "T"} onChange={(e) => onUpdate("answer", e.target.value)} disabled={disabled} className="text-xs border rounded px-2 py-1 disabled:bg-gray-100">
            <option value="T">正确(T)</option><option value="F">错误(F)</option>
          </select>
        ) : q.type === "MULTIPLE_CHOICE" ? (
          <div className="flex gap-2 items-center">
            {["A","B","C","D"].map((opt: string) => {
              const list = (q.answer || "").split(",").map((s: string) => s.trim()).filter(Boolean);
              const checked = list.includes(opt);
              return <label key={opt} className={`flex items-center gap-1 ${disabled ? "cursor-not-allowed" : "cursor-pointer"} text-xs`}>
                <input type="checkbox" checked={checked} onChange={() => {
                  if (disabled) return;
                  const nl = checked ? list.filter((s: string) => s !== opt) : [...list, opt];
                  onUpdate("answer", nl.join(","));
                }} disabled={disabled} /><span>{opt}</span>
              </label>;
            })}
          </div>
        ) : (
          <select value={q.answer || "A"} onChange={(e) => onUpdate("answer", e.target.value)} disabled={disabled} className="text-xs border rounded px-2 py-1 disabled:bg-gray-100">
            <option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option>
          </select>
        )}
        <button onClick={onPreview} disabled={disabled} className="text-xs text-blue-400 hover:text-blue-600 disabled:text-gray-400 disabled:cursor-not-allowed">预览</button>
        <button onClick={onDelete} disabled={disabled} className="ml-auto text-xs text-red-400 hover:text-red-600 disabled:text-gray-400 disabled:cursor-not-allowed">删除</button>
      </div>
      <textarea value={q.content} onChange={(e) => onUpdate("content", e.target.value)} rows={2} disabled={disabled} className="w-full border rounded-lg px-3 py-2 text-sm mb-3 disabled:bg-gray-100" placeholder="题目内容" />
      {q.type !== "TRUE_FALSE" && (
        <div className="grid grid-cols-2 gap-2">
          {["A","B","C","D"].map((k: string) => (
            <div key={k} className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500 w-4">{k}.</span>
              <input 
                value={opts[k] || ""} 
                onChange={(e) => { if (disabled) return; onUpdate("options", { ...opts, [k]: e.target.value }); }} 
                disabled={disabled}
                className="flex-1 border rounded px-2 py-1.5 text-sm disabled:bg-gray-100" 
                placeholder={`选项${k}`} 
              />
            </div>
          ))}
        </div>
      )}
      <textarea value={q.explanation || ""} onChange={(e) => onUpdate("explanation", e.target.value)} rows={1} className="w-full border rounded-lg px-3 py-2 text-sm mt-3" placeholder="答案解析（可选，教师可见）" />
    </div>
  );
}

/* ---- 题目预览组件 ---- */
function QuestionPreview({ question, onClose }: { question: Question; onClose: () => void }) {
  const opts = typeof question.options === "string" ? JSON.parse(question.options || "{}") : (question.options || {});
  const isJudge = question.type === "TRUE_FALSE";
  const isMulti = question.type === "MULTIPLE_CHOICE";
  const choices = isJudge ? ["T","F"] : isMulti ? (question.answer || "").split(",").filter(Boolean) : ["A","B","C","D"];
  
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm text-gray-400">{isJudge ? "判断题" : isMulti ? "多选题" : "单选题"} · {question.difficulty === "BASIC" ? "基础" : question.difficulty === "INTERMEDIATE" ? "提升" : "拓展"}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
        </div>
        <div className="text-base text-gray-800 mb-6 whitespace-pre-line">{question.content}</div>
        {!isJudge && (
          <div className="space-y-3">
            {["A","B","C","D"].map((k) => opts[k] ? (
              <div key={k} className="flex items-center gap-3 p-3 border rounded-lg">
                <span className="w-6 h-6 rounded-full border flex items-center justify-center text-xs font-medium">{k}</span>
                <span className="text-sm text-gray-700">{opts[k]}</span>
              </div>
            ) : null)}
          </div>
        )}
        {isJudge && (
          <div className="flex gap-4">
            <div className="flex-1 p-3 border rounded-lg text-center text-sm">正确(T)</div>
            <div className="flex-1 p-3 border rounded-lg text-center text-sm">错误(F)</div>
          </div>
        )}
        <div className="mt-6 text-xs text-gray-400">— 学生答题预览 —</div>
      </div>
    </div>
  );
}
