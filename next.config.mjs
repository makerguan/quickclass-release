/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["tdesign-react", "tdesign-icons-react"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
    // 这几条依赖链必须保持「不打包、运行时从 node_modules 加载」：
    // /api/tts 用的 msedge-tts 依赖 ws，而 ws 会尝试加载原生加速模块
    // bufferutil / utf-8-validate。一旦被 webpack 打进 bundle，
    // 这些 native 模块会变成空对象，运行时报 "t.mask is not a function"
    // 且请求会一直挂住不返回。
    serverComponentsExternalPackages: ["msedge-tts", "ws", "bufferutil", "utf-8-validate"],
  },
  webpack: (config, { isServer }) => {
    // 客户端（浏览器）bundle 不允许 Node 内置模块。来源：src/lib/prompts/ai-companion.ts
    // 顶层 `import * as fs from "fs"` / `import * as path from "path"`（读取 katex 资源），
    // 而该模块经 src/lib/exploration/render.ts 被教师前端 page.tsx import（本地预览注入）。
    // ⛔ DO NOT REVERT：不加这个 fallback，webpack 会因 "Can't resolve 'fs'" 编译失败，
    //    整个 dev server 所有路由 500。
    // 客户端降级后 loadKatexAssets 走 try-catch 返回空，教师预览的伴学公式降级为纯文本（无害）；
    // 服务端（isServer）保持 fs/path 正常，学生读取路径仍注入完整 katex。
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    return config;
  },
};

export default nextConfig;
