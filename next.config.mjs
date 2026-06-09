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
  },
};

export default nextConfig;
