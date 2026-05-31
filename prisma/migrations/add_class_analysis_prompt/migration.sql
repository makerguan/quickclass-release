-- 添加 classAnalysisPrompt 字段（用于存储全班学情分析提示词）
-- 由于 LearningTask 表已有数据，设置为可空
ALTER TABLE LearningTask ADD COLUMN classAnalysisPrompt TEXT;