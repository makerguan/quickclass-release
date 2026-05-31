-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SystemConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "aiBaseUrl" TEXT NOT NULL DEFAULT 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    "aiApiKey" TEXT,
    "aiModel" TEXT NOT NULL DEFAULT 'qwen-turbo',
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SystemConfig" ("aiApiKey", "aiBaseUrl", "id", "updatedAt") SELECT "aiApiKey", "aiBaseUrl", "id", "updatedAt" FROM "SystemConfig";
DROP TABLE "SystemConfig";
ALTER TABLE "new_SystemConfig" RENAME TO "SystemConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
