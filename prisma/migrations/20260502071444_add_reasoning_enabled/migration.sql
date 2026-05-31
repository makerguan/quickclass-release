/*
  Warnings:

  - You are about to drop the column `subject` on the `Class` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "DocumentChunk" ADD COLUMN "embedding" TEXT;

-- CreateTable
CREATE TABLE "AIInsight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "classId" TEXT NOT NULL,
    "scopeId" TEXT,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AIInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AIInsight_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LearningTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "grade" TEXT,
    "subject" TEXT,
    "objectives" TEXT NOT NULL,
    "requirements" TEXT NOT NULL,
    "knowledgeBase" TEXT,
    "knowledgeBaseIds" TEXT,
    "analysisPrompt" TEXT,
    "studentInsightTemplateId" TEXT,
    "classInsightTemplateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISABLED',
    "teacherId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LearningTask_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearningTask_studentInsightTemplateId_fkey" FOREIGN KEY ("studentInsightTemplateId") REFERENCES "AnalysisTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LearningTask_classInsightTemplateId_fkey" FOREIGN KEY ("classInsightTemplateId") REFERENCES "AnalysisTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SubProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "objectives" TEXT NOT NULL,
    "requirements" TEXT NOT NULL,
    "knowledgeBase" TEXT,
    "analysisPrompt" TEXT,
    "studentInsightTemplateId" TEXT,
    "classInsightTemplateId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubProject_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "LearningTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubProject_studentInsightTemplateId_fkey" FOREIGN KEY ("studentInsightTemplateId") REFERENCES "AnalysisTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SubProject_classInsightTemplateId_fkey" FOREIGN KEY ("classInsightTemplateId") REFERENCES "AnalysisTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuizActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subProjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "quizDesignTemplateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuizActivity_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuizActivity_quizDesignTemplateId_fkey" FOREIGN KEY ("quizDesignTemplateId") REFERENCES "AnalysisTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quizActivityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "options" TEXT,
    "answer" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "explanation" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Question_quizActivityId_fkey" FOREIGN KEY ("quizActivityId") REFERENCES "QuizActivity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuizAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "quizActivityId" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "totalQuestions" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    CONSTRAINT "QuizAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuizAttempt_quizActivityId_fkey" FOREIGN KEY ("quizActivityId") REFERENCES "QuizActivity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quizAttemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedAnswer" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "answeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestionAttempt_quizAttemptId_fkey" FOREIGN KEY ("quizAttemptId") REFERENCES "QuizAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionAttempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PresetConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subProjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "systemPrompt" TEXT,
    "analysisPrompt" TEXT,
    "studentInsightTemplateId" TEXT,
    "classInsightTemplateId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PresetConversation_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PresetConversation_studentInsightTemplateId_fkey" FOREIGN KEY ("studentInsightTemplateId") REFERENCES "AnalysisTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PresetConversation_classInsightTemplateId_fkey" FOREIGN KEY ("classInsightTemplateId") REFERENCES "AnalysisTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "LearningTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskAssignment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnalysisTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teacherId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "KnowledgeBase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teacherId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filename" TEXT,
    "fileSize" INTEGER,
    "content" TEXT NOT NULL,
    "vectorData" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RAW',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Class" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "teacherId" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "aiPromptStrategy" TEXT NOT NULL DEFAULT 'PRIORITY_MATERIAL',
    "customSystemPrompt" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Class_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Class" ("aiPromptStrategy", "createdAt", "customSystemPrompt", "description", "id", "inviteCode", "name", "status", "teacherId") SELECT "aiPromptStrategy", "createdAt", "customSystemPrompt", "description", "id", "inviteCode", "name", "status", "teacherId" FROM "Class";
DROP TABLE "Class";
ALTER TABLE "new_Class" RENAME TO "Class";
CREATE UNIQUE INDEX "Class_inviteCode_key" ON "Class"("inviteCode");
CREATE TABLE "new_Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "presetConversationId" TEXT,
    "title" TEXT NOT NULL DEFAULT '新对话',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Conversation_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Conversation_presetConversationId_fkey" FOREIGN KEY ("presetConversationId") REFERENCES "PresetConversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Conversation" ("classId", "createdAt", "id", "title", "updatedAt", "userId") SELECT "classId", "createdAt", "id", "title", "updatedAt", "userId" FROM "Conversation";
DROP TABLE "Conversation";
ALTER TABLE "new_Conversation" RENAME TO "Conversation";
CREATE TABLE "new_Evaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "feedback" TEXT,
    "evidence" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Evaluation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Evaluation_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Evaluation" ("classId", "createdAt", "dimension", "evidence", "feedback", "id", "score", "userId") SELECT "classId", "createdAt", "dimension", "evidence", "feedback", "id", "score", "userId" FROM "Evaluation";
DROP TABLE "Evaluation";
ALTER TABLE "new_Evaluation" RENAME TO "Evaluation";
CREATE TABLE "new_Exercise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classId" TEXT NOT NULL,
    "materialId" TEXT,
    "question" TEXT NOT NULL,
    "options" TEXT,
    "answer" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL DEFAULT 'MEDIUM',
    "sourceContent" TEXT,
    "explanation" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Exercise_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Exercise_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Exercise" ("answer", "classId", "createdAt", "difficulty", "explanation", "id", "materialId", "options", "question", "sourceContent", "type") SELECT "answer", "classId", "createdAt", "difficulty", "explanation", "id", "materialId", "options", "question", "sourceContent", "type" FROM "Exercise";
DROP TABLE "Exercise";
ALTER TABLE "new_Exercise" RENAME TO "Exercise";
CREATE TABLE "new_LearningProgress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "knowledgePoint" TEXT NOT NULL,
    "masteryLevel" INTEGER NOT NULL DEFAULT 0,
    "lastStudiedAt" DATETIME NOT NULL,
    CONSTRAINT "LearningProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LearningProgress_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_LearningProgress" ("classId", "id", "knowledgePoint", "lastStudiedAt", "masteryLevel", "userId") SELECT "classId", "id", "knowledgePoint", "lastStudiedAt", "masteryLevel", "userId" FROM "LearningProgress";
DROP TABLE "LearningProgress";
ALTER TABLE "new_LearningProgress" RENAME TO "LearningProgress";
CREATE TABLE "new_Material" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "content" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Material_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Material" ("classId", "content", "createdAt", "fileSize", "fileType", "filename", "id", "originalName", "status", "teacherId", "type") SELECT "classId", "content", "createdAt", "fileSize", "fileType", "filename", "id", "originalName", "status", "teacherId", "type" FROM "Material";
DROP TABLE "Material";
ALTER TABLE "new_Material" RENAME TO "Material";
CREATE TABLE "new_Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Message" ("content", "conversationId", "createdAt", "id", "role") SELECT "content", "conversationId", "createdAt", "id", "role" FROM "Message";
DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";
CREATE TABLE "new_SystemConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "aiBaseUrl" TEXT NOT NULL DEFAULT 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    "aiApiKey" TEXT,
    "aiModel" TEXT NOT NULL DEFAULT 'qwen-turbo',
    "reasoningEnabled" BOOLEAN NOT NULL DEFAULT false,
    "insightLevel" TEXT NOT NULL DEFAULT 'STANDARD',
    "insightDataSource" TEXT NOT NULL DEFAULT 'CONVERSATIONS',
    "studentWordLimit" INTEGER NOT NULL DEFAULT 100,
    "classWordLimit" INTEGER NOT NULL DEFAULT 300,
    "starCount" INTEGER NOT NULL DEFAULT 10,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SystemConfig" ("aiApiKey", "aiBaseUrl", "aiModel", "id", "updatedAt") SELECT "aiApiKey", "aiBaseUrl", "aiModel", "id", "updatedAt" FROM "SystemConfig";
DROP TABLE "SystemConfig";
ALTER TABLE "new_SystemConfig" RENAME TO "SystemConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignment_taskId_classId_key" ON "TaskAssignment"("taskId", "classId");
