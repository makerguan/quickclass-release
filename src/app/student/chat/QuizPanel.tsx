"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button, MessagePlugin } from "tdesign-react";
import { CheckCircleIcon, ErrorCircleIcon } from "tdesign-icons-react";
import { normalizeQuestionType } from "@/lib/question-type";
import Markdown from "@/components/Markdown";

interface Question {
  id: string;
  type: string;
  content: string;
  options: string | Record<string, string>;
  answer: string;
  difficulty: string;
  explanation?: string | null;
  order: number;
}

/** 后端返回的每题判定结果（前端一律以此为准，不再自行判定对错） */
interface AnswerResult {
  isCorrect: boolean;
  score?: number | null;
  maxScore?: number | null;
  comment?: string | null;
  gradedBy?: string | null;
}

interface QuizPanelProps {
  quizId: string;
  initialQuizData?: { id: string; title: string; description?: string; status: string };
  initialQuestions?: Question[];
  onSubmit: () => void;
  locked?: boolean;
}

export default function QuizPanel({ quizId, initialQuizData, initialQuestions = [], onSubmit, locked = false }: QuizPanelProps) {
  const [quiz, setQuiz] = useState<{ id: string; title: string; description?: string; status: string } | null>(initialQuizData || null);
  const [questions, setQuestions] = useState<Question[]>(initialQuestions);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<{ score: number; totalQuestions: number; correctCount: number; passScore?: number } | null>(null);
  // 每题的后端判定结果：key = questionId
  const [answerResults, setAnswerResults] = useState<Record<string, AnswerResult>>({});
  // 解题思路展开状态：key = questionId（记录用户点击；未记录时错题默认展开、对题默认折叠）
  const [expandedExplanations, setExpandedExplanations] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // 上次提交记录不完整（记录数 < 题目数，多为 2026-09-08 前旧版本遗留）：不锁定，提示重新作答
  const [incompleteSubmit, setIncompleteSubmit] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const currentQuizId = quizId; // 捕获当前 quizId，防止旧请求覆盖
    setSubmitted(false);
    setIncompleteSubmit(false);
    setAnswers({});
    setResult(null);
    setAnswerResults({});
    setExpandedExplanations({});
    setCurrentIndex(0);
    setLoading(true);

    // 每次切换作业都从 API 获取最新数据
    Promise.all([
      fetch(`/api/quiz-activities/${quizId}`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`/api/quiz-activities/${quizId}/attempts`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(([quizRes, attemptRes]) =>
        Promise.all([quizRes.json(), attemptRes.ok ? attemptRes.json() : null])
      )
      .then(([quizData, attemptData]) => {
        // 检查是否已切换到其他作业，防止旧请求覆盖新数据
        if (currentQuizId !== quizId) return;
        setQuiz(quizData);
        if (quizData.questions) setQuestions(quizData.questions);
        // ⛔ DO NOT REVERT：已提交锁定判定与后端口径一致（report/attempts）——记录数 == 题目数才算“已提交”。
        // 历史版本（2026-09-08 前无事务提交）可能留下“记录数 < 题目数”的不完整 attempt：
        // 此时不锁定，标记 incompleteSubmit 提示重新作答；重交一次 POST 会清旧记录写全量，自动修复。
        // 兼容新旧 API 格式：attemptData.answers（新格式）或 attemptData.QuestionAttempt（旧格式）
        const answersData = attemptData?.answers || attemptData?.QuestionAttempt || [];
        const totalQuestions = (quizData.questions && quizData.questions.length > 0)
          ? quizData.questions.length
          : questions.length;
        const isPartialSubmit = answersData.length > 0 && answersData.length < totalQuestions;
        if (answersData.length > 0 && !isPartialSubmit) {
          setSubmitted(true);
          const correct = answersData.filter((a: any) => a.isCorrect).length;
          setResult({ 
            score: attemptData.score || 0, 
            totalQuestions: attemptData.totalQuestions || 0, 
            correctCount: correct 
          });
          const ansMap: Record<string, string> = {};
          const resultMap: Record<string, AnswerResult> = {};
          answersData.forEach((a: any) => {
            ansMap[a.questionId] = a.selectedAnswer;
            resultMap[a.questionId] = {
              isCorrect: !!a.isCorrect,
              score: a.score,
              maxScore: a.maxScore,
              comment: a.comment,
              gradedBy: a.gradedBy,
            };
          });
          setAnswers(ansMap);
          setAnswerResults(resultMap);
          
          // 如果已提交但 questions 为空（从缓存恢复的情况），强制刷新题目数据以显示答案
          if (!quizData.questions || quizData.questions.length === 0) {
            // 重新获取题目以显示答案
            fetch(`/api/quiz-activities/${quizId}`, { headers: { Authorization: `Bearer ${token}` } })
              .then(r => r.json())
              .then(qData => {
                if (qData.questions) setQuestions(qData.questions);
              });
          }
        } else if (isPartialSubmit) {
          // 记录不齐：不锁定，提示重新作答（重新提交会覆盖旧的不完整记录）
          setIncompleteSubmit(true);
        }
        setLoading(false);
      })
      .catch(() => {
        if (currentQuizId !== quizId) return;
        setLoading(false);
      });
  }, [quizId]);

  const parseOptions = (opts: string | Record<string, string>): Record<string, string> => {
    if (!opts) return {};
    if (typeof opts === "string") {
      try { return JSON.parse(opts); } catch { return {}; }
    }
    return opts;
  };

  const handleSubmit = async () => {
    if (Object.keys(answers).length < questions.length) {
      MessagePlugin.warning("请完成所有题目后再提交");
      return;
    }
    setSubmitting(true);
    try {
      const token = localStorage.getItem("token") || "";
      // 转换为 API 期望的数组格式 [{ questionId, selectedAnswer }]
      const answersArray = Object.entries(answers).map(([questionId, selectedAnswer]) => ({
        questionId,
        selectedAnswer,
      }));
      const res = await fetch(`/api/quiz-activities/${quizId}/attempts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ answers: answersArray }),
      });
      const data = await res.json();
      if (res.ok) {
        setSubmitted(true);
        setIncompleteSubmit(false);
        setResult({ score: data.score, totalQuestions: data.totalQuestions, correctCount: data.correctCount, passScore: data.passScore });
        // 以服务端判定为准
        const resultMap: Record<string, AnswerResult> = {};
        (data.results || []).forEach((r: any) => {
          resultMap[r.questionId] = {
            isCorrect: !!r.isCorrect,
            score: r.score,
            maxScore: r.maxScore,
            comment: r.comment,
          };
        });
        setAnswerResults(resultMap);
        if (data.ungradedCount > 0) {
          MessagePlugin.warning(`已提交，但有 ${data.ungradedCount} 道题未能自动批改，请联系老师`);
        } else {
          MessagePlugin.success(`提交成功！得分：${data.score}分`);
        }
        onSubmit();
      } else {
        // 如果是"已提交"错误（403），说明后端已有完整记录，锁定界面
        if (res.status === 403) {
          setSubmitted(true);
          MessagePlugin.warning("作业已提交过，无需重复提交");
        } else {
          MessagePlugin.error(data.error || "提交失败");
        }
      }
    } catch {
      MessagePlugin.error("提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-400">加载题目中...</div>
      </div>
    );
  }

  const getOptions = (q: any): Record<string, string> => {
    const t = normalizeQuestionType(q?.type);
    if (t === "TRUE_FALSE" || t === "JUDGEMENT") {
      return { T: "正确", F: "错误" };
    }
    const opts = parseOptions(q?.options || {});
    return opts;
  };

  const currentQ = questions[currentIndex];
  const opts = getOptions(currentQ);

  // 回退判定：仅在后端未返回该题结果时使用，规则与后端 ai-grading 保持一致
  // （trim + 大写；多选题按集合比较，顺序无关），避免前后端口径不一
  const isChoiceCorrect = (q: Question, userAns?: string) => {
    const norm = (s?: string | null) => (s || "").trim().toUpperCase();
    const correct = norm(q.answer);
    const selected = norm(userAns);
    if (!selected) return false;
    if (normalizeQuestionType(q.type) === "MULTIPLE_CHOICE") {
      const asSet = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean).sort().join(",");
      return asSet(correct) === asSet(selected);
    }
    return correct === selected;
  };

  // 已提交：渲染全部题目卡片
  const renderSubmittedAll = () => (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {questions.map((q, idx) => {
        const qOpts = getOptions(q);
        const userAns = answers[q.id];
        // 一律以后端判定为准，前端不再自行判定对错
        const backend = answerResults[q.id];
        const isRight = backend ? backend.isCorrect : isChoiceCorrect(q, userAns);
        const ungraded = !!backend && backend.gradedBy === "pending";
        // 解题思路展开：用户点过以其为准，否则错题默认展开、对题默认折叠
        const explanationOpen = q.id in expandedExplanations ? expandedExplanations[q.id] : !isRight;
        return (
          <div key={q.id} className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
            {/* 题号和题目 */}
            <div className="flex items-start gap-3 mb-4">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                ungraded ? "bg-orange-100 text-orange-500" : isRight ? "bg-green-100 text-green-600" : "bg-red-100 text-red-500"
              }`}>
                {ungraded ? "?" : isRight ? "✓" : "✗"}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-[#63666F] mb-1 flex items-center gap-2">
                  <span>第 {idx + 1} 题</span>
                  {ungraded && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-600">未批改</span>
                  )}
                  {!ungraded && backend?.maxScore ? (
                    <span className="text-xs text-[#8B8F99]">{backend.score ?? 0} / {backend.maxScore} 分</span>
                  ) : null}
                </div>
                <div className="text-base font-medium text-[#1A1A1A]"><Markdown breaks>{q.content}</Markdown></div>
                {backend?.comment && !ungraded && (
                  <div className="text-xs text-[#8B8F99] mt-1">评语：<Markdown inline>{backend.comment}</Markdown></div>
                )}
              </div>
            </div>
            {/* 选项 */}
            <div className="space-y-2 ml-11">
              {Object.entries(qOpts).map(([k, v]) => {
                // 与后端一致：统一大写 + trim，避免大小写/空格导致判定偏差
                const key = String(k).trim().toUpperCase();
                const userList = (userAns || "").toUpperCase().split(",").map(s => s.trim()).filter(Boolean);
                const correctList = (q.answer || "").toUpperCase().split(",").map(s => s.trim()).filter(Boolean);
                const isMultiCheck = normalizeQuestionType(q.type) === "MULTIPLE_CHOICE";
                const isSelected = isMultiCheck ? userList.includes(key) : userList.join(",") === key;
                const isCorrect = isMultiCheck ? correctList.includes(key) : correctList.join(",") === key;
                let bgClass = "bg-gray-50";
                if (isCorrect) bgClass = "bg-green-50 border border-green-200";
                else if (isSelected && !isCorrect) bgClass = "bg-red-50 border border-red-200";
                return (
                  <div key={k} className={`flex items-center gap-3 p-3 rounded-lg transition-all ${bgClass}`}>
                    <span className={`text-sm font-medium w-6 ${
                      isCorrect ? "text-green-600" : isSelected ? "text-red-500" : "text-gray-400"
                    }`}>{k}.</span>
                    <span className={`text-sm ${
                      isCorrect ? "text-green-700" : isSelected ? "text-red-700" : "text-gray-600"
                    }`}><Markdown inline>{String(v)}</Markdown></span>
                    {isSelected && !isCorrect && <span className="ml-auto text-xs text-red-400">你的答案</span>}
                    {isCorrect && <span className="ml-auto text-xs text-green-500">正确答案</span>}
                  </div>
                );
              })}
            </div>
            {/* 解题思路：错题默认展开，对题折叠，点击可切换 */}
            {q.explanation && (
              <div className="mt-3 ml-11">
                {explanationOpen ? (
                  <div className="rounded-lg bg-blue-50 border border-blue-100 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-[#0052D9]">解题思路</span>
                      <span
                        className="text-xs text-[#8B8F99] cursor-pointer hover:text-[#0052D9]"
                        onClick={() => setExpandedExplanations((prev) => ({ ...prev, [q.id]: false }))}
                      >
                        收起
                      </span>
                    </div>
                    <div className="text-sm text-[#4A4A4A]"><Markdown>{q.explanation}</Markdown></div>
                  </div>
                ) : (
                  <div
                    className="text-xs text-[#0052D9] cursor-pointer hover:underline w-fit"
                    onClick={() => setExpandedExplanations((prev) => ({ ...prev, [q.id]: true }))}
                  >
                    查看解题思路
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  // 未提交：渲染单题导航
  const renderUnsubmitted = () => (
    <div className="flex-1 overflow-y-auto p-4">
      {!currentQ ? (
        <div className="text-center text-gray-400 py-10">暂无题目</div>
      ) : (
        <div
          key={currentQ.id}
          className={`bg-white rounded-xl shadow-sm p-6 border-2 transition-all ${
            "border-[#0052D9] shadow-md"
          }`}
        >
          {/* 题号和题目内容 */}
          <div className="flex items-start gap-3 mb-4">
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold bg-[#0052D9] text-white">
              {currentIndex + 1}
            </div>
            {currentQ.type === "MULTIPLE_CHOICE" && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium mt-1.5">[多选]</span>
            )}
            <div className="flex-1">
              <div className="text-base font-medium text-[#1A1A1A]"><Markdown breaks>{currentQ.content}</Markdown></div>
            </div>
          </div>

          {/* 选项列表 */}
          <div className="space-y-3 ml-11">
            {Object.entries(opts).map(([k, v]) => {
              const isMulti = currentQ.type === "MULTIPLE_CHOICE";
              const selectedList = answers[currentQ.id] ? answers[currentQ.id].split(",") : [];
              const isSelected = isMulti ? selectedList.includes(k) : answers[currentQ.id] === k;
              let bgClass = "bg-gray-50 hover:bg-gray-100";
              if (isSelected) {
                bgClass = "bg-[#E8F0FE] border border-[#0052D9]";
              }
              return (
                <div
                  key={k}
                  className={`flex items-center gap-3 p-4 rounded-lg cursor-pointer transition-all ${bgClass}`}
                  onClick={() => {
                    if (isMulti) {
                      const cur = answers[currentQ.id] ? answers[currentQ.id].split(",").filter(Boolean) : [];
                      const next = cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k];
                      setAnswers((prev) => ({ ...prev, [currentQ.id]: next.join(",") }));
                    } else {
                      setAnswers((prev) => ({ ...prev, [currentQ.id]: k }));
                    }
                  }}
                >
                  <span className={`inline-flex w-5 h-5 items-center justify-center rounded-full text-xs font-bold border mr-1 ${
                    isSelected ? "bg-[#0052D9] text-white border-[#0052D9]" : "border-gray-300 text-transparent"
                  }`}>
                    {isSelected ? (isMulti ? "✓" : "●") : ""}
                  </span>
                  <span className={`text-sm flex-1 ${isSelected ? "text-[#0052D9]" : "text-gray-700"}`}><Markdown inline>{String(v)}</Markdown></span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 顶部标题 */}
      <div className="px-4 py-3 border-b border-gray-200 bg-[#FAFBFC]">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-[#1A1A1A]">{quiz?.title}</h3>
            {quiz?.description && <p className="text-xs text-[#63666F] mt-0.5">{quiz.description}</p>}
          </div>
          {submitted && result && (
            <div className="text-right">
              <div className="text-xl font-bold text-[#0052D9]">{result.score}分</div>
              <div className="text-xs text-[#63666F]">答对 {result.correctCount}/{result.totalQuestions} 题</div>
              {(result.passScore ?? 60) > 0 && (
                <div className={`text-xs mt-0.5 ${result.score >= (result.passScore ?? 60) ? "text-green-600" : "text-red-500"}`}>
                  {result.score >= (result.passScore ?? 60) ? "已合格" : `未合格（合格线${result.passScore ?? 60}分）`}
                </div>
              )}
            </div>
          )}
        </div>
        {submitted && (
          <div className="mt-2 text-xs text-green-600 flex items-center gap-1">
            <CheckCircleIcon size="14px" />
            已提交
          </div>
        )}
        {incompleteSubmit && !submitted && (
          <div className="mt-2 text-xs text-orange-600 flex items-center gap-1">
            <ErrorCircleIcon size="14px" />
            上次提交不完整，请重新作答后提交（将覆盖原记录）
          </div>
        )}
      </div>

      {/* 题目内容 */}
      {submitted ? renderSubmittedAll() : renderUnsubmitted()}

      {/* 底部操作栏 */}
      {!submitted ? (
        <div className="border-t border-gray-200 px-4 py-3 flex items-center justify-between">
          <div className="text-sm text-gray-400">
            {Object.keys(answers).length} / {questions.length} 已答
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="large"
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
              disabled={currentIndex === 0}
            >
              上一题
            </Button>
            <Button
              theme="primary"
              size="large"
              loading={submitting}
              onClick={handleSubmit}
              disabled={Object.keys(answers).length < questions.length}
            >
              提交作业
            </Button>
            <Button
              variant="outline"
              size="large"
              onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
              disabled={currentIndex === questions.length - 1}
            >
              下一题
            </Button>
          </div>
        </div>
      ) : (
        <div className="border-t border-gray-200 px-4 py-3 flex items-center justify-center">
          <div className="text-sm text-gray-400">作业已提交</div>
        </div>
      )}
    </div>
  );
}
