import type { Metadata } from "next";
import "tdesign-react/es/style/index.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuickClass - AI 智能体学习平台",
  description: "基于 AI 智能体的项目化学习平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
