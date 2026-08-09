"use client";

import { Button } from "tdesign-react";

interface ViewFrameProps {
  src: string;
  title?: string;
  onBack: () => void;
}

export default function ViewFrame({ src, title, onBack }: ViewFrameProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 mb-3">
        <Button theme="default" variant="outline" onClick={onBack}>
          ← 返回
        </Button>
        {title && <h2 className="text-base font-medium text-[#1A1A1A]">{title}</h2>}
      </div>
      <iframe
        src={src}
        className="flex-1 w-full border rounded-lg"
        style={{ minHeight: "calc(100vh - 180px)" }}
        title={title || "内容视图"}
      />
    </div>
  );
}
