"use client";

import { useState } from "react";
import { Card, Button, Radio, MessagePlugin } from "tdesign-react";
import StudentLayout from "@/components/layout/StudentLayout";

interface Exercise {
  id: string;
  question: string;
  options?: string;
  answer: string;
  type: string;
  explanation?: string;
}

export default function StudentExercisePage() {
  const [exercises] = useState<Exercise[]>([
    {
      id: "1",
      question: "以下哪个是 React 的核心特性？",
      options: JSON.stringify([
        "A. 双向数据绑定",
        "B. 虚拟 DOM",
        "C. 模板引擎",
        "D. 依赖注入",
      ]),
      answer: "B",
      type: "SINGLE_CHOICE",
      explanation: "React 使用虚拟 DOM 来提高渲染性能。",
    },
    {
      id: "2",
      question: "TypeScript 是 JavaScript 的超集吗？",
      options: JSON.stringify(["A. 是", "B. 否"]),
      answer: "A",
      type: "SINGLE_CHOICE",
      explanation: "TypeScript 是 JavaScript 的超集，添加了类型系统。",
    },
  ]);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({});

  const handleAnswer = (exerciseId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [exerciseId]: value }));
  };

  const handleSubmit = (exercise: Exercise) => {
    const userAnswer = answers[exercise.id];
    if (!userAnswer) {
      MessagePlugin.warning("请选择答案");
      return;
    }

    const isCorrect = userAnswer === exercise.answer;
    MessagePlugin.success(isCorrect ? "回答正确！" : "回答错误，继续加油！");
    setSubmitted((prev) => ({ ...prev, [exercise.id]: true }));
  };

  return (
    <StudentLayout>
      <div className="space-y-4">
        <h2 className="text-xl font-semibold mb-4">练习中心</h2>
        {exercises.map((exercise, index) => (
          <Card key={exercise.id} title={`题目 ${index + 1}`}>
            <div className="space-y-4">
              <p className="text-gray-800 font-medium">{exercise.question}</p>

              {exercise.options && (
                <Radio.Group
                  value={answers[exercise.id]}
                  onChange={(v) => handleAnswer(exercise.id, v as string)}
                  disabled={submitted[exercise.id]}
                >
                  <div className="space-y-2">
                    {JSON.parse(exercise.options).map((option: string) => (
                      <Radio key={option} value={option[0]}>
                        {option}
                      </Radio>
                    ))}
                  </div>
                </Radio.Group>
              )}

              {!submitted[exercise.id] && (
                <Button
                  theme="primary"
                  onClick={() => handleSubmit(exercise)}
                  disabled={!answers[exercise.id]}
                >
                  提交答案
                </Button>
              )}

              {submitted[exercise.id] && (
                <div
                  className={`p-3 rounded-lg ${
                    answers[exercise.id] === exercise.answer
                      ? "bg-green-50 text-green-700"
                      : "bg-red-50 text-red-700"
                  }`}
                >
                  <p className="font-medium">
                    {answers[exercise.id] === exercise.answer
                      ? "✓ 回答正确"
                      : `✗ 正确答案：${exercise.answer}`}
                  </p>
                  {exercise.explanation && (
                    <p className="mt-2 text-sm opacity-80">
                      解析：{exercise.explanation}
                    </p>
                  )}
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </StudentLayout>
  );
}
