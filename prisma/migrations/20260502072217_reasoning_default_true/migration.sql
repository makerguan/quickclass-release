-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SystemConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "aiBaseUrl" TEXT NOT NULL DEFAULT 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    "aiApiKey" TEXT,
    "aiModel" TEXT NOT NULL DEFAULT 'qwen-turbo',
    "reasoningEnabled" BOOLEAN NOT NULL DEFAULT true,
    "insightLevel" TEXT NOT NULL DEFAULT 'STANDARD',
    "insightDataSource" TEXT NOT NULL DEFAULT 'CONVERSATIONS',
    "studentWordLimit" INTEGER NOT NULL DEFAULT 100,
    "classWordLimit" INTEGER NOT NULL DEFAULT 300,
    "starCount" INTEGER NOT NULL DEFAULT 10,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SystemConfig" ("aiApiKey", "aiBaseUrl", "aiModel", "classWordLimit", "id", "insightDataSource", "insightLevel", "reasoningEnabled", "starCount", "studentWordLimit", "updatedAt") SELECT "aiApiKey", "aiBaseUrl", "aiModel", "classWordLimit", "id", "insightDataSource", "insightLevel", "reasoningEnabled", "starCount", "studentWordLimit", "updatedAt" FROM "SystemConfig";
DROP TABLE "SystemConfig";
ALTER TABLE "new_SystemConfig" RENAME TO "SystemConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
