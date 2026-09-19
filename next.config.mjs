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
};

export default nextConfig;
