"use client";

import { Dialog, Loading } from "tdesign-react";

interface Props {
  loading: boolean;
  content: string;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  onConfirm: () => void;
  /** 自定义内容渲染函数 */
  renderContent?: (content: string) => React.ReactNode;
}

export default function PromptPreviewDialog({
  loading,
  content,
  visible,
  onVisibleChange,
  onConfirm,
  renderContent,
}: Props) {
  return (
    <Dialog
      header="提示词预览"
      visible={visible}
      onClose={() => onVisibleChange(false)}
      onConfirm={onConfirm}
      confirmBtn="确认执行"
      cancelBtn="取消"
      width="720px"
    >
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loading />
          <span className="ml-2 text-gray-500">正在生成预览...</span>
        </div>
      ) : renderContent ? (
        renderContent(content)
      ) : (
        <div className="max-h-[60vh] overflow-y-auto">
          <pre className="whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 p-4 rounded-lg border border-gray-200 font-mono">
            {content || "（无内容）"}
          </pre>
        </div>
      )}
    </Dialog>
  );
}