import { prisma } from "./prisma";

type QueueItem = {
  id: string;
  execute: () => Promise<void>;
};

class AIRequestQueue {
  private queue: QueueItem[] = [];
  private running = 0;
  private delayMs = 300;
  private maxConcurrent = 20; // 默认值，会被配置覆盖
  private configLoaded = false;

  // 从数据库加载配置
  private async loadConfig() {
    if (this.configLoaded) return;
    
    try {
      const config = await prisma.systemConfig.findFirst();
      if (config?.aiMaxConcurrent) {
        this.maxConcurrent = config.aiMaxConcurrent;
        console.log(`[AI Queue] 并发数已设置为: ${this.maxConcurrent}`);
      }
      this.configLoaded = true;
    } catch (error) {
      console.error("[AI Queue] 加载并发配置失败，使用默认值:", error);
    }
  }

  async enqueue<T>(execute: () => Promise<T>): Promise<T> {
    // 首次使用时加载配置
    await this.loadConfig();
    
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).substring(7);
      const item: QueueItem = {
        id,
        execute: async () => {
          try {
            const result = await execute();
            resolve(result);
          } catch (error) {
            reject(error);
          }
        },
      };
      this.queue.push(item);
      this.process();
    });
  }

  // 手动重载配置（教师修改设置后调用）
  async reloadConfig() {
    this.configLoaded = false;
    await this.loadConfig();
  }

  private async process() {
    // 达到并发上限时等待
    while (this.running >= this.maxConcurrent && this.queue.length > 0) {
      await new Promise((r) => setTimeout(r, 200));
    }

    if (this.queue.length === 0) return;

    const item = this.queue.shift();
    if (!item) return;

    this.running++;
    item.execute()
      .catch((error) => console.error("AI queue item failed:", error))
      .finally(() => {
        this.running--;
        if (this.queue.length > 0) {
          this.process();
        }
      });
  }
}

export const aiQueue = new AIRequestQueue();
