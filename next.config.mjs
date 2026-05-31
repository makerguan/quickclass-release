/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["tdesign-react", "tdesign-icons-react"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // 允许局域网访问（配合启动脚本的 -H 0.0.0.0）
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
