"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button, MessagePlugin } from "tdesign-react";
import { CheckCircleIcon, ErrorCircleIcon } from "tdesign-icons-react";

interface Question {
  id: string;
  type: string;
  content: string;
  options: string | Record<string, string>;
  answer: string;
  difficulty: string;
  order: number;
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
  const [result, setResult] = useState<{ score: number; totalQuestions: number; correctCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const currentQuizId = quizId; // 捕获当前 quizId，防止旧请求覆盖
    setSubmitted(false);
    setAnswers({});
    setResult(null);
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
        // 兼容新旧 API 格式：attemptData.answers（新格式）或 attemptData.QuestionAttempt（旧格式）
        const answersData = attemptData?.answers || attemptData?.QuestionAttempt || [];
        if (answersData.length > 0) {
          setSubmitted(true);
          const correct = answersData.filter((a: any) => a.isCorrect).length;
          setResult({ 
            score: attemptData.score || 0, 
            totalQuestions: attemptData.totalQuestions || 0, 
            correctCount: correct 
          });
          const ansMap: Record<string, string> = {};
          answersData.forEach((a: any) => { ansMap[a.questionId] = a.selectedAnswer; });
          setAnswers(ansMap);
          
          // 如果已提交但 questions 为空（从缓存恢复的情况），强制刷新题目数据以显示答案
          if (answersData.length > 0 && (!quizData.questions || quizData.questions.length === 0)) {
            // 重新获取题目以显示答案
            fetch(`/api/quiz-activities/${quizId}`, { headers: { Authorization: `Bearer ${token}` } })
              .then(r => r.json())
              .then(qData => {
                if (qData.questions) setQuestions(qData.questions);
              });
          }
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
        setResult({ score: data.score, totalQuestions: data.totalQuestions, correctCount: data.correctCount });
        MessagePlugin.success(`提交成功！得分：${data.score}分`);
        onSubmit();
      } else {
        MessagePlugin.error(data.error || "提交失败");
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
    const opts = parseOptions(q?.options || {});
    if (Object.keys(opts).length === 0 && q?.type === "TRUE_FALSE") {
      return { T: "正确", F: "错误" };
    }
    return opts;
  };

  const currentQ = questions[currentIndex];
  const opts = getOptions(currentQ);

  // 已提交：渲染全部题目卡片
  const renderSubmittedAll = () => (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {questions.map((q, idx) => {
        const qOpts = getOptions(q);
        const userAns = answers[q.id];
        const isRight = q.answer === userAns;
        return (
          <div key={q.id} className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
            {/* 题号和题目 */}
            <div className="flex items-start gap-3 mb-4">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                isRight ? "bg-green-100 text-green-600" : "bg-red-100 text-red-500"
              }`}>
                {isRight ? "✓" : "✗"}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-[#63666F] mb-1">第 {idx + 1} 题</div>
                <div className="text-base font-medium text-[#1A1A1A]">{q.content}</div>
              </div>
            </div>
            {/* 选项 */}
            <div className="space-y-2 ml-11">
              {Object.entries(qOpts).map(([k, v]) => {
                const userList = (userAns || "").split(",").filter(Boolean);
                const correctList = (q.answer || "").split(",").map(s => s.trim()).filter(Boolean);
                const isMultiCheck = q.type === "MULTIPLE_CHOICE";
                const isSelected = isMultiCheck ? userList.includes(k) : userAns === k;
                const isCorrect = isMultiCheck ? correctList.includes(k) : q.answer === k;
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
                    }`}>{v}</span>
                    {isSelected && !isCorrect && <span className="ml-auto text-xs text-red-400">你的答案</span>}
                    {isCorrect && <span className="ml-auto text-xs text-green-500">正确答案</span>}
                  </div>
                );
              })}
            </div>
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
            <div className="flex-1">
              <div className="text-base font-medium text-[#1A1A1A]">{currentQ.content}</div>
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
                  <span className={`text-sm flex-1 ${isSelected ? "text-[#0052D9]" : "text-gray-700"}`}>{v}</span>
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
            </div>
          )}
        </div>
        {submitted && (
          <div className="mt-2 text-xs text-green-600 flex items-center gap-1">
            <CheckCircleIcon size="14px" />
            已提交
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
