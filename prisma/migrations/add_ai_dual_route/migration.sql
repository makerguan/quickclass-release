-- 添加双线路主备配置字段（2026-10-15）
-- 图文线路备用模型（主线复用 aiBaseUrl/aiApiKey/aiModel，均为可空，未填则保持单模型行为）
ALTER TABLE SystemConfig ADD COLUMN aiTextBackupBaseUrl TEXT;
ALTER TABLE SystemConfig ADD COLUMN aiTextBackupApiKey TEXT;
ALTER TABLE SystemConfig ADD COLUMN aiTextBackupModel TEXT;
-- 全媒体线路（语音/图片/视频分析，主模型如 qwen3.8-omni-flash）
ALTER TABLE SystemConfig ADD COLUMN aiOmniBaseUrl TEXT;
ALTER TABLE SystemConfig ADD COLUMN aiOmniApiKey TEXT;
ALTER TABLE SystemConfig ADD COLUMN aiOmniModel TEXT;
ALTER TABLE SystemConfig ADD COLUMN aiOmniBackupBaseUrl TEXT;
ALTER TABLE SystemConfig ADD COLUMN aiOmniBackupApiKey TEXT;
ALTER TABLE SystemConfig ADD COLUMN aiOmniBackupModel TEXT;
