import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// GET: 获取单个课堂详情
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { taskId } = await params;
    const task = await prisma.learningTask.findUnique({
      where: { id: taskId },
      include: {
        studentInsightTemplate: { select: { id: true, name: true, type: true } },
        classInsightTemplate: { select: { id: true, name: true, type: true } },
        subProjects: {
          include: {
            studentInsightTemplate: { select: { id: true, name: true, type: true } },
            classInsightTemplate: { select: { id: true, name: true, type: true } },
            PresetConversation: {
              select: { id: true, title: true, description: true, systemPrompt: true, analysisPrompt: true, classAnalysisPrompt: true, sortOrder: true, enabled: true, studentInsightTemplateId: true, classInsightTemplateId: true },
              orderBy: [{ enabled: "desc" }, { sortOrder: "asc" }],
            },
            QuizActivity: { select: { id: true, title: true, description: true, status: true, sortOrder: true, Question: { orderBy: { order: "asc" } } }, orderBy: [{ status: "desc" }, { sortOrder: "asc" }] },
            ExplorationActivity: { select: { id: true, title: true, description: true, sortOrder: true, enabled: true }, orderBy: [{ enabled: "desc" }, { sortOrder: "asc" }] },
          },
          orderBy: { sortOrder: "asc" },
        },
        assignments: { include: { class: { select: { id: true, name: true } } } },
      },
    });

    if (!task) return NextResponse.json({ error: "课堂不存在" }, { status: 404 });

    // 学生只能看分配给本班的任务
    if (payload.role === "STUDENT") {
      const user = await prisma.user.findUnique({ where: { id: String(payload.userId) } });
      if (!user?.classId) return NextResponse.json({ error: "无权限" }, { status: 403 });
      const assigned = task.assignments.some((a) => a.classId === user.classId);
      if (!assigned) return NextResponse.json({ error: "无权限" }, { status: 403 });
    } else if (task.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    // 映射字段名以匹配前端期望
    const mapSubProject = (sp: Record<string, unknown>) => {
      const { PresetConversation, QuizActivity, ExplorationActivity, ...rest } = sp;
      return {
        ...rest,
        presetConversations: PresetConversation,
        quizActivities: (QuizActivity as Array<Record<string, unknown>>)?.map((qa) => {
          const { Question, ...qaRest } = qa;
          return { ...qaRest, questions: Question };
        }),
        explorations: ExplorationActivity,
      };
    };
    return NextResponse.json({ ...task, subProjects: task.subProjects.map(mapSubProject) });
  } catch (error) {
    console.error("Get task error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

// PUT: 更新课堂
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER")
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { taskId } = await params;
    const existing = await prisma.learningTask.findUnique({ where: { id: taskId } });
    if (!existing || existing.teacherId !== String(payload.userId))
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    const body = await req.json();
    const { title, description, grade, subject, objectives, requirements, knowledgeBase, analysisPrompt, knowledgeBaseIds, subProjects, classIds, studentInsightTemplateId, classInsightTemplateId, classAnalysisPrompt } = body;

    // 调试日志：打印 classIds
    console.log("[PUT /api/tasks/:taskId] classIds=", classIds, "'classIds' in body:", 'classIds' in body);

    // subProjects 更新逻辑：仅当请求体中显式包含 subProjects 时才重建子项目
    let shouldUpdateSubProjects = 'subProjects' in body;

    console.log("[PUT /api/tasks/:taskId] knowledgeBase='", knowledgeBase, "', knowledgeBaseIds=", knowledgeBaseIds);
    console.log("[PUT /api/tasks/:taskId] shouldUpdateSubProjects=", shouldUpdateSubProjects, "body.subProjects in body:", 'subProjects' in body);
    if (body.subProjects) {
      console.log("[PUT /api/tasks/:taskId] subProjects count:", body.subProjects.length);
      body.subProjects.forEach((sp: Record<string, unknown>, i: number) => {
        console.log(`[PUT] sp[${i}] title="${sp.title}" presetConversations count=${Array.isArray(sp.presetConversations) ? sp.presetConversations.length : 0}`);
        if (Array.isArray(sp.presetConversations)) {
          (sp.presetConversations as Record<string, unknown>[]).forEach((pc: Record<string, unknown>, j: number) => {
            console.log(`[PUT] sp[${i}].pc[${j}] title="${pc.title}" studentInsightTemplateId="${pc.studentInsightTemplateId}" classInsightTemplateId="${pc.classInsightTemplateId}"`);
          });
        }
      });
    }

    // 确保至少有一个默认学习活动（作为容器）
    let safeSubProjects = subProjects || [];
    if (!Array.isArray(safeSubProjects) || safeSubProjects.length === 0) {
      safeSubProjects = [{ title: "默认活动", description: "", objectives: "", requirements: "", knowledgeBase: "", analysisPrompt: "", presetConversations: [], taskId: taskId }];
    }

    // 过滤掉学习活动中的 id 字段（更新时不需要），只保留创建需要的字段
    // 注意：presetConversations 中的 id 要保留，用于更新现有记录
    const cleanSubProjects = safeSubProjects.map((sp: Record<string, unknown>) => {
      const spStudentTplId = (sp.studentInsightTemplateId as string) || undefined;
      const spClassTplId = (sp.classInsightTemplateId as string) || undefined;
      const result: Record<string, unknown> = {
        title: (sp.title as string) || "默认活动",
        description: (sp.description as string) || "",
        objectives: (sp.objectives as string) || "",
        requirements: (sp.requirements as string) || "",
        knowledgeBase: (sp.knowledgeBase as string) || "",
        analysisPrompt: (sp.analysisPrompt as string) || "",
        sortOrder: (sp.sortOrder as number) ?? 0,
        taskId: taskId,
      };
      if (spStudentTplId) result.studentInsightTemplateId = spStudentTplId;
      if (spClassTplId) result.classInsightTemplateId = spClassTplId;
      // 保留 presetConversations 中的 id（更新现有或创建新的）
      result.PresetConversation = ((sp.presetConversations as Record<string, unknown>[]) || []).map((pc) => {
        const pcStudentTplId = (pc.studentInsightTemplateId as string) || undefined;
        const pcClassTplId = (pc.classInsightTemplateId as string) || undefined;
        const pcResult: Record<string, unknown> = {
          // 保留 id（如果有则是更新，没有则是创建）
          ...(pc.id ? { id: pc.id } : {}),
          title: (pc.title as string) || "",
          description: (pc.description as string) || undefined,
          systemPrompt: (pc.systemPrompt as string) || undefined,
          analysisPrompt: (pc.analysisPrompt as string) || undefined,
          classAnalysisPrompt: (pc.classAnalysisPrompt as string) || undefined,
          sortOrder: (pc.sortOrder as number) ?? 0,
        };
        if (pcStudentTplId) pcResult.studentInsightTemplateId = pcStudentTplId;
        if (pcClassTplId) pcResult.classInsightTemplateId = pcClassTplId;
        return pcResult;
      });
      return result;
    });

    // 删除旧的学习活动和分配，重建
    // 注意：quizActivities 独立于 subProject 删除，这里先保存以便重建后恢复
    const oldSubProjects = await prisma.subProject.findMany({ where: { taskId } });
    // 保存每个 sp 的 quizActivities（含 questions 和 attempts）
    const oldQuizActivitiesMap: Record<string, any[]> = {};
    const oldQuizAttemptsMap: Record<string, any[]> = {};
    for (const sp of oldSubProjects) {
      const qas = await prisma.quizActivity.findMany({
        where: { subProjectId: sp.id },
        include: { Question: true },
      });
      if (qas.length > 0) oldQuizActivitiesMap[sp.id] = qas;
      for (const qa of qas) {
        const attempts = await prisma.quizAttempt.findMany({
          where: { quizActivityId: qa.id },
          include: { QuestionAttempt: true },
        });
        if (attempts.length > 0) oldQuizAttemptsMap[qa.id] = attempts;
      }
    }
    // 保存每个 sp 的 explorations（含 submissions 和 actionLogs）
    const oldExplorationsMap: Record<string, any[]> = {};
    const oldSubmissionsMap: Record<string, any[]> = {};
    const oldActionLogsMap: Record<string, any[]> = {};
    for (const sp of oldSubProjects) {
      const expls = await prisma.explorationActivity.findMany({
        where: { subProjectId: sp.id },
      });
      if (expls.length > 0) oldExplorationsMap[sp.id] = expls;
      // 保存 submissions 和 actionLogs
      for (const exp of expls) {
        const subs = await prisma.explorationSubmission.findMany({
          where: { explorationId: exp.id },
        });
        if (subs.length > 0) oldSubmissionsMap[exp.id] = subs;
        for (const sub of subs) {
          const logs = await prisma.explorationActionLog.findMany({
            where: { submissionId: sub.id },
          });
          if (logs.length > 0) oldActionLogsMap[sub.id] = logs;
        }
      }
    }
    // 保存每个 PresetConversation 关联的 Conversation（用于重建后恢复关联）
    const oldConversationsMap: Record<string, string[]> = {};
    for (const sp of oldSubProjects) {
      const pcs = await prisma.presetConversation.findMany({
        where: { subProjectId: sp.id },
        select: { id: true },
      });
      for (const pc of pcs) {
        const convs = await prisma.conversation.findMany({
          where: { presetConversationId: pc.id },
          select: { id: true },
        });
        if (convs.length > 0) {
          oldConversationsMap[pc.id] = convs.map(c => c.id);
        }
      }
    }

    // 收集表单中提交的预设对话 ID（用于对比哪些被移除了）
    const incomingPcIds = new Set<string>();
    for (const sp of safeSubProjects) {
      const pcs = sp.presetConversations as Record<string, unknown>[] | undefined;
      if (pcs) {
        for (const pc of pcs) {
          if (pc.id) incomingPcIds.add(pc.id as string);
        }
      }
    }

    if (!shouldUpdateSubProjects) {
      // 不更新子项目时，只更新课堂基本信息和班级分配
      await prisma.$transaction(async (tx) => {
        await tx.learningTask.update({
          where: { id: taskId },
          data: {
            title,
            description,
            grade,
            subject,
            objectives,
            requirements,
            knowledgeBase,
            analysisPrompt,
            classAnalysisPrompt,
            knowledgeBaseIds,
            updatedAt: new Date(),
          },
        });
        // 只有当请求体中显式包含 classIds 时才更新班级分配
        if ('classIds' in body) {
          await tx.taskAssignment.deleteMany({ where: { taskId } });
          if (classIds && classIds.length > 0) {
            await tx.taskAssignment.createMany({
              data: classIds.map((classId: string) => ({ taskId, classId })),
            });
          }
        }
      });
    } else {
      await prisma.$transaction(async (tx) => {
      // 删除旧数据
      for (const sp of oldSubProjects) {
        // 找出此 subProject 下被移除的预设对话（旧数据中有但表单中没有的）
        const oldPcs = await tx.presetConversation.findMany({
          where: { subProjectId: sp.id },
          select: { id: true },
        });
        const removedPcIds = oldPcs
          .filter((p) => !incomingPcIds.has(p.id))
          .map((p) => p.id);
        if (removedPcIds.length > 0) {
          // 级联删除：删除被移除对话活动的所有学生对话记录、消息、AI 学情分析结果
          // 与 QuizActivity/QuizAttempt 的级联清理保持一致
          // 1. 找出受影响的 Conversation ID 集合
          const affectedConversations = await tx.conversation.findMany({
            where: { presetConversationId: { in: removedPcIds } },
            select: { id: true },
          });
          const affectedConvIds = affectedConversations.map((c) => c.id);
          // 2. 先删 Messages（避免孤儿消息）
          if (affectedConvIds.length > 0) {
            await tx.message.deleteMany({
              where: { conversationId: { in: affectedConvIds } },
            });
            // 3. 再删 Conversations
            await tx.conversation.deleteMany({
              where: { id: { in: affectedConvIds } },
            });
          }
          // 4. 删 AI 学情分析结果（按 presetConversationId 关联的）
          await tx.aIInsight.deleteMany({
            where: { presetConversationId: { in: removedPcIds } },
          });
          // 5. 最后删 PresetConversation 本身
          await tx.presetConversation.deleteMany({ where: { id: { in: removedPcIds } } });
        }

        // 清理作业相关的题目和学生答题记录（deleteMany 不触发级联）
        const qas = await tx.quizActivity.findMany({
          where: { subProjectId: sp.id },
          select: { id: true },
        });
        const qaIds = qas.map((q) => q.id);
        if (qaIds.length > 0) {
          const questions = await tx.question.findMany({
            where: { quizActivityId: { in: qaIds } },
            select: { id: true },
          });
          const qIds = questions.map((q) => q.id);
          if (qIds.length > 0) {
            await tx.questionAttempt.deleteMany({ where: { questionId: { in: qIds } } });
          }
          const attempts = await tx.quizAttempt.findMany({
            where: { quizActivityId: { in: qaIds } },
            select: { id: true },
          });
          const atIds = attempts.map((a) => a.id);
          if (atIds.length > 0) {
            await tx.questionAttempt.deleteMany({ where: { quizAttemptId: { in: atIds } } });
          }
          await tx.question.deleteMany({ where: { quizActivityId: { in: qaIds } } });
          await tx.quizAttempt.deleteMany({ where: { quizActivityId: { in: qaIds } } });
        }
        await tx.quizActivity.deleteMany({ where: { subProjectId: sp.id } });

        // 清理互动探究的学生提交和操作日志（deleteMany 不触发级联）
        const expls = await tx.explorationActivity.findMany({
          where: { subProjectId: sp.id },
          select: { id: true },
        });
        const expIds = expls.map((e) => e.id);
        if (expIds.length > 0) {
          const subs = await tx.explorationSubmission.findMany({
            where: { explorationId: { in: expIds } },
            select: { id: true },
          });
          const subIds = subs.map((s) => s.id);
          if (subIds.length > 0) {
            await tx.explorationActionLog.deleteMany({ where: { submissionId: { in: subIds } } });
            await tx.explorationSubmission.deleteMany({ where: { explorationId: { in: expIds } } });
          }
        }
        await tx.explorationActivity.deleteMany({ where: { subProjectId: sp.id } });
      }
      await tx.subProject.deleteMany({ where: { taskId } });
      
      // 只有当请求体中显式包含 classIds 时才更新班级分配
      if ('classIds' in body) {
        await tx.taskAssignment.deleteMany({ where: { taskId } });
        if (classIds && classIds.length > 0) {
          await tx.taskAssignment.createMany({
            data: classIds.map((classId: string) => ({ taskId, classId })),
          });
        }
      }

      // 重建 subProjects
      console.log("[PUT] cleanSubProjects count:", cleanSubProjects.length);
      cleanSubProjects.forEach((sp: any, i: number) => {
        console.log(`[PUT] sp[${i}] PresetConversation count:`, sp.PresetConversation?.length || 0);
        if (sp.PresetConversation?.length > 0) {
          (sp.PresetConversation as any[]).forEach((pc: any, j: number) => {
            console.log(`[PUT] sp[${i}].pc[${j}] id="${pc.id}" title="${pc.title}" enabled=${pc.enabled}`);
          });
        }
      });
      const newSubProjects = await Promise.all(
        cleanSubProjects.map((sp: Record<string, unknown>, spIndex: number) => {
          const spData: Record<string, unknown> = {
            title: sp.title as string,
            description: sp.description as string | undefined,
            objectives: sp.objectives as string,
            requirements: sp.requirements as string,
            knowledgeBase: sp.knowledgeBase as string | undefined,
            analysisPrompt: sp.analysisPrompt as string | undefined,
            sortOrder: spIndex,
            taskId: sp.taskId as string,
          };
          if (sp.studentInsightTemplateId) spData.studentInsightTemplateId = sp.studentInsightTemplateId;
          if (sp.classInsightTemplateId) spData.classInsightTemplateId = sp.classInsightTemplateId;
          spData.PresetConversation = {
            create: ((sp.PresetConversation || []) as Record<string, unknown>[]).map((pc: Record<string, unknown>, pcIndex: number) => {
              const pcData: Record<string, unknown> = {
                // 保留 id（如果有则是更新，没有则是创建）
                ...(pc.id ? { id: pc.id } : {}),
                title: pc.title as string,
                description: pc.description as string | undefined,
                systemPrompt: pc.systemPrompt as string | undefined,
                analysisPrompt: pc.analysisPrompt as string | undefined,
                classAnalysisPrompt: pc.classAnalysisPrompt as string | undefined,
                sortOrder: pcIndex,
                enabled: (pc.enabled as boolean) ?? true,
              };
              if (pc.studentInsightTemplateId) pcData.studentInsightTemplateId = pc.studentInsightTemplateId;
              if (pc.classInsightTemplateId) pcData.classInsightTemplateId = pc.classInsightTemplateId;
              return pcData;
            }),
          };
          return tx.subProject.create({ data: spData as any });
        })
      );

      // 恢复 Conversation 与 PresetConversation 的关联
      for (const [pcId, convIds] of Object.entries(oldConversationsMap)) {
        // 只有当该 PresetConversation 仍然保留（在 incomingPcIds 中）时才恢复关联
        if (incomingPcIds.has(pcId)) {
          await tx.conversation.updateMany({
            where: { id: { in: convIds } },
            data: { presetConversationId: pcId },
          });
        }
      }

      // 恢复 quizActivities 及其题目和答题记录
      for (let i = 0; i < newSubProjects.length; i++) {
        const oldSp = oldSubProjects[i];
        if (oldSp && oldQuizActivitiesMap[oldSp.id]) {
          for (const qa of oldQuizActivitiesMap[oldSp.id]) {
            const newQa = await tx.quizActivity.create({
              data: {
                subProjectId: newSubProjects[i].id,
                title: qa.title,
                description: qa.description,
                quizDesignTemplateId: qa.quizDesignTemplateId,
                status: qa.status,
                sortOrder: qa.sortOrder,
                createdAt: qa.createdAt,
                updatedAt: new Date(),
              },
            });
            // 创建题目并记录新旧 ID 映射
            const questionIdMap: Record<string, string> = {};
            const questions = qa.Question || qa.questions || [];
            for (const oldQ of questions) {
              const newQ = await tx.question.create({
                data: {
                  quizActivityId: newQa.id,
                  type: oldQ.type,
                  content: oldQ.content,
                  options: oldQ.options,
                  answer: oldQ.answer,
                  score: oldQ.score,
                  difficulty: oldQ.difficulty,
                  explanation: oldQ.explanation,
                  order: oldQ.order,
                },
              });
              questionIdMap[oldQ.id] = newQ.id;
            }
            // 恢复答题记录（quizAttempts + questionAttempts）
            const oldAttempts = oldQuizAttemptsMap[qa.id] || [];
            for (const at of oldAttempts) {
              await tx.quizAttempt.create({
                data: {
                  quizActivityId: newQa.id,
                  userId: at.userId,
                  score: at.score,
                  totalQuestions: at.totalQuestions,
                  correctCount: at.correctCount,
                  totalScore: at.totalScore,
                  maxTotalScore: at.maxTotalScore,
                  startedAt: at.startedAt,
                  submittedAt: at.submittedAt,
                  QuestionAttempt: {
                    create: ((at.QuestionAttempt || at.answers || []) as any[]).map((ans: any) => ({
                      questionId: questionIdMap[ans.questionId] || ans.questionId,
                      selectedAnswer: ans.selectedAnswer,
                      isCorrect: ans.isCorrect,
                      score: ans.score,
                      maxScore: ans.maxScore,
                      comment: ans.comment,
                      gradedBy: ans.gradedBy,
                    })),
                  },
                },
              });
            }
          }
        }
      }

      // 恢复 explorations（含 submissions 和 actionLogs）
      for (let i = 0; i < newSubProjects.length; i++) {
        const oldSp = oldSubProjects[i];
        if (oldSp && oldExplorationsMap[oldSp.id]?.length > 0) {
          for (const exp of oldExplorationsMap[oldSp.id]) {
            const newExp = await tx.explorationActivity.create({
              data: {
                subProjectId: newSubProjects[i].id,
                title: exp.title,
                description: exp.description,
                htmlContent: exp.htmlContent,
                sortOrder: exp.sortOrder,
                enabled: exp.enabled,
                enableSubmission: exp.enableSubmission,
                questionsJson: exp.questionsJson,
                teachingAdvice: exp.teachingAdvice,
                createdAt: exp.createdAt,
              },
            });
            // 恢复 submissions 和 actionLogs
            const oldSubs = oldSubmissionsMap[exp.id] || [];
            for (const os of oldSubs) {
              const newSub = await tx.explorationSubmission.create({
                data: {
                  explorationId: newExp.id,
                  studentId: os.studentId,
                  score: os.score,
                  totalScore: os.totalScore,
                  status: os.status,
                  answers: os.answers,
                  submittedAt: os.submittedAt,
                  gradedAt: os.gradedAt,
                },
              });
              const oldLogs = oldActionLogsMap[os.id] || [];
              for (const log of oldLogs) {
                await tx.explorationActionLog.create({
                  data: {
                    submissionId: newSub.id,
                    type: log.type,
                    target: log.target,
                    value: log.value,
                    timestamp: log.timestamp,
                  },
                });
              }
            }
          }
        }
      }

      // 保存对话活动时，不修改课堂基本信息，只更新 updatedAt
      if (title !== undefined || description !== undefined || grade !== undefined || subject !== undefined ||
          objectives !== undefined || requirements !== undefined || knowledgeBase !== undefined ||
          analysisPrompt !== undefined || classAnalysisPrompt !== undefined || knowledgeBaseIds !== undefined) {
        await tx.learningTask.update({
          where: { id: taskId },
          data: {
            ...(title !== undefined && { title }),
            ...(description !== undefined && { description }),
            ...(grade !== undefined && { grade }),
            ...(subject !== undefined && { subject }),
            ...(objectives !== undefined && { objectives }),
            ...(requirements !== undefined && { requirements }),
            ...(knowledgeBase !== undefined && { knowledgeBase }),
            ...(analysisPrompt !== undefined && { analysisPrompt }),
            ...(classAnalysisPrompt !== undefined && { classAnalysisPrompt }),
            ...(knowledgeBaseIds !== undefined && { knowledgeBaseIds }),
            updatedAt: new Date(),
          },
        });
      } else {
        // 如果基本信息没有变化，只更新 updatedAt 时间戳
        await tx.learningTask.update({
          where: { id: taskId },
          data: { updatedAt: new Date() },
        });
      }
      });
    }

    const updated = await prisma.learningTask.findUnique({
      where: { id: taskId },
      include: {
        studentInsightTemplate: { select: { id: true, name: true, type: true } },
        classInsightTemplate: { select: { id: true, name: true, type: true } },
        subProjects: {
          include: {
            studentInsightTemplate: { select: { id: true, name: true, type: true } },
            classInsightTemplate: { select: { id: true, name: true, type: true } },
            PresetConversation: { select: { id: true, title: true, description: true, systemPrompt: true, analysisPrompt: true, classAnalysisPrompt: true, sortOrder: true, enabled: true, studentInsightTemplateId: true, classInsightTemplateId: true }, orderBy: [{ enabled: "desc" }, { sortOrder: "asc" }] },
            QuizActivity: { select: { id: true, title: true, description: true, status: true, sortOrder: true, Question: { orderBy: { order: "asc" } } }, orderBy: [{ status: "desc" }, { sortOrder: "asc" }] },
            ExplorationActivity: { select: { id: true, title: true, description: true, sortOrder: true, enabled: true }, orderBy: [{ enabled: "desc" }, { sortOrder: "asc" }] },
          },
        },
        assignments: { include: { class: { select: { id: true, name: true } } } },
      },
    });

    const mapSub = (sp: Record<string, unknown>) => {
      const { PresetConversation, QuizActivity, ExplorationActivity, ...r } = sp;
      return { ...r, presetConversations: PresetConversation, quizActivities: (QuizActivity as Array<Record<string, unknown>>)?.map((qa) => { const { Question, ...qr } = qa; return { ...qr, questions: Question }; }), explorations: ExplorationActivity };
    };
    if (!updated) return NextResponse.json({ error: "更新失败" }, { status: 500 });
    return NextResponse.json({ ...updated, subProjects: updated.subProjects.map(mapSub) });
  } catch (error) {
    console.error("Update task error:", error);
    const message = error instanceof Error ? error.message : "服务器错误";
    // 返回更详细的错误信息帮助调试
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "服务器错误", detail }, { status: 500 });
  }
}

// PATCH: 更新课堂状态
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER")
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { taskId } = await params;
    const existing = await prisma.learningTask.findUnique({ where: { id: taskId } });
    if (!existing || existing.teacherId !== String(payload.userId))
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    const body = await req.json();
    const { status } = body;

    if (!["DISABLED", "ENABLED", "ENDED"].includes(status)) {
      return NextResponse.json({ error: "无效的状态值" }, { status: 400 });
    }

    const updated = await prisma.learningTask.update({
      where: { id: taskId },
      data: { status },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update task status error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

// DELETE: 删除课堂（包含所有关联数据）
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER")
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { taskId } = await params;
    const existing = await prisma.learningTask.findUnique({
      where: { id: taskId },
      include: { assignments: { select: { classId: true } } },
    });
    if (!existing || existing.teacherId !== String(payload.userId))
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    const classIds = existing.assignments.map((a) => a.classId);

    // 在事务中删除所有关联数据
    await prisma.$transaction(async (tx) => {
      // 1. 获取任务下所有预设对话ID
      const presetConversations = await tx.presetConversation.findMany({
        where: { SubProject: { taskId } },
        select: { id: true },
      });
      const presetIds = presetConversations.map((pc) => pc.id);

      // 2. 删除对话和消息（只删除关联了任务预设对话的对话）
      if (presetIds.length > 0 && classIds.length > 0) {
        const conversations = await tx.conversation.findMany({
          where: { classId: { in: classIds }, presetConversationId: { in: presetIds } },
          select: { id: true },
        });
        const conversationIds = conversations.map((c) => c.id);
        if (conversationIds.length > 0) {
          await tx.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
          await tx.conversation.deleteMany({ where: { id: { in: conversationIds } } });
        }
      }

      // 3. 删除作业答题记录（quizAttempts -> questionAttempts）
      const quizActivities = await tx.quizActivity.findMany({
        where: { SubProject: { taskId } },
        select: { id: true },
      });
      const quizActivityIds = quizActivities.map((qa) => qa.id);
      if (quizActivityIds.length > 0 && classIds.length > 0) {
        // 获取这些班级的学生ID
        const students = await tx.user.findMany({
          where: { classId: { in: classIds }, role: "STUDENT" },
          select: { id: true },
        });
        const studentIds = students.map((s) => s.id);
        if (studentIds.length > 0) {
          const attempts = await tx.quizAttempt.findMany({
            where: { quizActivityId: { in: quizActivityIds }, userId: { in: studentIds } },
            select: { id: true },
          });
          const attemptIds = attempts.map((a) => a.id);
          if (attemptIds.length > 0) {
            await tx.questionAttempt.deleteMany({ where: { quizAttemptId: { in: attemptIds } } });
          }
          await tx.quizAttempt.deleteMany({
            where: { quizActivityId: { in: quizActivityIds }, userId: { in: studentIds } },
          });
        }
      }

      // 4. 删除互动探究提交记录（explorationSubmissions -> explorationActionLogs）
      const explorations = await tx.explorationActivity.findMany({
        where: { SubProject: { taskId } },
        select: { id: true },
      });
      const explorationIds = explorations.map((e) => e.id);
      if (explorationIds.length > 0 && classIds.length > 0) {
        const students = await tx.user.findMany({
          where: { classId: { in: classIds }, role: "STUDENT" },
          select: { id: true },
        });
        const studentIds = students.map((s) => s.id);
        if (studentIds.length > 0) {
          const submissions = await tx.explorationSubmission.findMany({
            where: { explorationId: { in: explorationIds }, studentId: { in: studentIds } },
            select: { id: true },
          });
          const submissionIds = submissions.map((s) => s.id);
          if (submissionIds.length > 0) {
            await tx.explorationActionLog.deleteMany({ where: { submissionId: { in: submissionIds } } });
          }
          await tx.explorationSubmission.deleteMany({
            where: { explorationId: { in: explorationIds }, studentId: { in: studentIds } },
          });
        }
      }

      // 5. 删除 AI 学情分析结果（按班级删除）
      // task 级别的分析 scopeId 存 taskId
      await tx.aIInsight.deleteMany({
        where: { classId: { in: classIds }, scopeId: taskId },
      });
      // subProject 级别的分析 scopeId 存 subProjectId
      const subProjects = await tx.subProject.findMany({
        where: { taskId },
        select: { id: true },
      });
      const subProjectIds = subProjects.map((sp) => sp.id);
      if (subProjectIds.length > 0) {
        await tx.aIInsight.deleteMany({
          where: { classId: { in: classIds }, scopeId: { in: subProjectIds } },
        });
      }
      // 预设对话级别的分析 scopeId 存 presetConversationId
      if (presetIds.length > 0) {
        await tx.aIInsight.deleteMany({
          where: { classId: { in: classIds }, scopeId: { in: presetIds } },
        });
      }
      // 作业级别的分析 type="quiz_class"，scopeId 存 quizActivityId
      if (quizActivityIds.length > 0) {
        await tx.aIInsight.deleteMany({
          where: { classId: { in: classIds }, scopeId: { in: quizActivityIds }, type: "quiz_class" },
        });
        // 作业学生分析 type="quiz_student"，scopeId 也存 quizActivityId
        await tx.aIInsight.deleteMany({
          where: { classId: { in: classIds }, scopeId: { in: quizActivityIds }, type: "quiz_student" },
        });
      }
      // 互动探究分析 type 以 "exploration_" 开头，scopeId 存 explorationId
      if (explorationIds.length > 0) {
        await tx.aIInsight.deleteMany({
          where: { classId: { in: classIds }, scopeId: { in: explorationIds }, type: { startsWith: "exploration_" } },
        });
      }

      // 6. 删除课堂本身（级联删除 subProjects, presetConversations, quizActivities, explorations, taskAssignments）
      await tx.learningTask.delete({ where: { id: taskId } });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete task error:", error);
    const message = error instanceof Error ? error.message : "服务器错误";
    return NextResponse.json({ error: "服务器错误", detail: message }, { status: 500 });
  }
}
