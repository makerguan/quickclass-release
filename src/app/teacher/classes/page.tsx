"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Table,
  Dialog,
  Form,
  Input,
  MessagePlugin,
  Checkbox,
  Select,
  Switch,
  Tooltip,
} from "tdesign-react";
import { AddIcon, ShareIcon, CopyIcon, DeleteIcon, CheckCircleIcon, UserIcon, UploadIcon, FileIcon } from "tdesign-icons-react";
import TeacherLayout from "@/components/layout/TeacherLayout";
import * as XLSX from "xlsx";

interface ClassItem {
  id: string;
  name: string;
  inviteCode: string;
  _count: { students: number };
  createdAt: string;
  isCurrent: boolean;
  openInviteCode: boolean;
}

export default function TeacherClassesPage() {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [visible, setVisible] = useState(false);
  const [shareVisible, setShareVisible] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleteClass, setDeleteClass] = useState<ClassItem | null>(null);
  const [shareClass, setShareClass] = useState<ClassItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [formIsCurrent, setFormIsCurrent] = useState(false);
  const [formOpenInviteCode, setFormOpenInviteCode] = useState(false);
  const [importVisible, setImportVisible] = useState(false);
  const [importClassId, setImportClassId] = useState("");
  const [importText, setImportText] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [editOpenInviteCode, setEditOpenInviteCode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchClasses();
  }, []);

  const fetchClasses = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/classes", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setClasses(data);
      }
    } catch {
      console.error("获取班级失败");
    }
  };

  const handleCreate = async (context: { fields?: Record<string, string> }) => {
    const values = context.fields || {};
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/classes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...values, isCurrent: formIsCurrent, openInviteCode: formOpenInviteCode }),
      });

      if (res.ok) {
        MessagePlugin.success("创建成功");
        setVisible(false);
        setFormIsCurrent(false);
        
        fetchClasses();
      } else {
        const data = await res.json();
        MessagePlugin.error(data.error || "创建失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setLoading(false);
    }
  };

  const handleShare = (cls: ClassItem) => {
    setShareClass(cls);
    setShareVisible(true);
  };

  const handleCopyShareText = async () => {
    if (!shareClass) return;
    const hostname = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? '【请改成您的IP地址】'
      : window.location.hostname;
    const port = window.location.port;
    const baseUrl = hostname === 'localhost' || hostname === '127.0.0.1'
      ? hostname + ':' + port
      : window.location.origin;
    let text = `【${shareClass.name}】AI学习助手\n\n请点击链接进入：${baseUrl}/student\n邀请码：${shareClass.inviteCode}\n\n`;
    if (shareClass.openInviteCode) {
      text += `输入姓名和邀请码即可开始与AI对话学习！`;
    } else {
      text += `输入姓名/学号和密码（或姓名+邀请码）即可开始与AI对话学习！`;
    }
    try {
      await navigator.clipboard.writeText(text);
      MessagePlugin.success("已复制到剪贴板");
    } catch {
      MessagePlugin.error("复制失败，请手动复制");
    }
  };

  const handleDeleteClass = async () => {
    if (!deleteClass) return;
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/classes/${deleteClass.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        MessagePlugin.success("班级已删除");
        setDeleteVisible(false);
        setDeleteClass(null);
        fetchClasses();
      } else {
        const data = await res.json();
        MessagePlugin.error(data.error || "删除失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setLoading(false);
    }
  };

  const handleSetCurrent = async (classId: string) => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/classes/current", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ classId }),
      });
      if (res.ok) {
        MessagePlugin.success("已设置为当前班级");
        fetchClasses();
      } else {
        const data = await res.json();
        MessagePlugin.error(data.error || "设置失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    }
  };

  const handleToggleOpenInviteCode = async (cls: ClassItem) => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/classes/${cls.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ openInviteCode: !cls.openInviteCode }),
      });
      if (res.ok) {
        MessagePlugin.success(cls.openInviteCode ? "已关闭开放邀请码" : "已开启开放邀请码");
        fetchClasses();
      } else {
        const data = await res.json();
        MessagePlugin.error(data.error || "设置失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    }
  };

  const parseExcelFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as string[][];

        // Skip header row, parse data rows
        const students: { name: string; studentNo: string | null; password: string | null }[] = [];
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (row && row.length > 0 && row[0]) {
            const name = String(row[0]).trim().replace(/\s+/g, "");
            const studentNo = row.length > 1 && row[1] ? String(row[1]).trim() : null;
            const password = row.length > 2 && row[2] ? String(row[2]).trim() : null;
            if (name) {
              students.push({ name, studentNo, password });
            }
          }
        }

        if (students.length > 0) {
          // Convert to text format for display
          const text = students.map(s => `${s.name},${s.studentNo || ""},${s.password || ""}`).join("\n");
          setImportText(text);
          MessagePlugin.success(`成功解析 ${students.length} 条学生数据`);
        } else {
          MessagePlugin.warning("未解析到学生数据");
        }
      } catch (error) {
        console.error("Parse Excel error:", error);
        MessagePlugin.error("解析文件失败");
      }
    };
    reader.readAsBinaryString(file);
  };

  const parseImportText = (text: string): { name: string; studentNo: string | null; password: string | null }[] => {
    const lines = text.trim().split("\n").filter((line) => line.trim());
    return lines.map((line) => {
      const parts = line.split(/[,\t]/).map((p) => p.trim());
      const name = parts[0]?.trim() || "";
      const studentNo = parts[1]?.trim() || null;
      const password = parts[2]?.trim() || null;
      return { name, studentNo, password };
    }).filter((s) => s.name);
  };

  const downloadTemplate = () => {
    const template = `姓名,学号,密码
张三,2026001,123456
李四,2026002,
王五,2026003,password123`;
    const blob = new Blob([template], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "学生导入模板.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    if (!importClassId) {
      MessagePlugin.warning("请先选择一个班级");
      return;
    }

    const parsed = parseImportText(importText);
    if (parsed.length === 0) {
      MessagePlugin.warning("请输入学生信息");
      return;
    }

    setImportLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/teachers/students/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          classId: importClassId,
          students: parsed,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.warnings && data.warnings.length > 0) {
          MessagePlugin.warning(data.message + "\n" + data.warnings.join("\n"));
        } else {
          MessagePlugin.success(data.message);
        }
        setImportVisible(false);
        setImportText("");
        fetchClasses();
      } else {
        const data = await res.json();
        MessagePlugin.error(data.error || "导入失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setImportLoading(false);
    }
  };

  const openImport = (classId: string) => {
    setImportClassId(classId);
    setImportVisible(true);
  };

  const columns = [
    {
      colKey: "name",
      title: "班级名称",
      cell: ({ row }: { row: ClassItem }) => (
        <div className="flex items-center gap-2">
          <span>{row.name}</span>
          {row.isCurrent && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#0052D9]/10 text-[#0052D9] text-xs font-medium">
              <CheckCircleIcon size="14px" />
            </span>
          )}
        </div>
      ),
    },
    { colKey: "inviteCode", title: "邀请码" },
    {
      colKey: "openInviteCode",
      title: "开放邀请码登陆",
      cell: ({ row }: { row: ClassItem }) => (
        <Switch
          value={row.openInviteCode}
          onChange={() => handleToggleOpenInviteCode(row)}
          size="small"
        />
      ),
    },
    {
      colKey: "students",
      title: "学生数",
      cell: ({ row }: { row: ClassItem }) => row._count?.students ?? 0,
    },
    {
      colKey: "action",
      width: 420,
      title: "操作",
      cell: ({ row }: { row: ClassItem }) => (
        <div className="flex gap-2">
          <Tooltip content="从Excel文件导入学生">
            <Button
              theme="primary"
              variant="outline"
              size="small"
              icon={<UserIcon />}
              onClick={() => openImport(row.id)}
            >
              导入学生
            </Button>
          </Tooltip>
          {!row.isCurrent && (
            <Tooltip content="设置后，分析学情时默认使用此班级">
              <Button
                theme="warning"
                variant="text"
                size="small"
                onClick={() => handleSetCurrent(row.id)}
              >
                设为当前
              </Button>
            </Tooltip>
          )}
          <Tooltip content="查看班级详情、学生列表">
            <Button
              theme="primary"
              variant="text"
              size="small"
              onClick={() => router.push(`/teacher/classes/${row.id}`)}
            >
              详情
            </Button>
          </Tooltip>
          <Tooltip content="复制分享信息给学生">
            <Button
              theme="success"
              variant="text"
              size="small"
              icon={<ShareIcon />}
              onClick={() => handleShare(row)}
            >
              分享
            </Button>
          </Tooltip>
          <Tooltip content="删除班级及所有相关数据（不可恢复）">
            <Button
              theme="danger"
              variant="text"
              size="small"
              icon={<DeleteIcon />}
              onClick={() => {
                setDeleteClass(row);
                setDeleteVisible(true);
              }}
            >
              删除
            </Button>
          </Tooltip>
        </div>
      ),
    },
  ];

  return (
    <TeacherLayout>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">班级管理</h2>
        <Button theme="primary" icon={<AddIcon />} onClick={() => setVisible(true)}>
          创建班级
        </Button>
      </div>

      <Card>
        {classes.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-lg mb-2">🏫</p>
            <p>暂无班级</p>
            <p className="text-sm mt-2">点击「创建班级」开始添加</p>
          </div>
        ) : (
          <Table data={classes} columns={columns} rowKey="id" style={{ minWidth: "800px" }} />
        )}
      </Card>

      <Dialog
        header="创建班级"
        visible={visible}
        onClose={() => { setVisible(false); setFormIsCurrent(false); setFormOpenInviteCode(false); }}
        footer={null}
      >
        <Form onSubmit={handleCreate}>
          <Form.FormItem
            name="name"
            rules={[{ required: true, message: "请输入班级名称" }]}
          >
            <Input placeholder="班级名称" />
          </Form.FormItem>
          <Form.FormItem
            name="inviteCode"
            rules={[{ required: true, message: "请设置邀请码" }]}
          >
            <Input placeholder="邀请码（学生用此码加入）" />
          </Form.FormItem>
          <Form.FormItem name="description">
            <Input placeholder="班级描述（可选）" />
          </Form.FormItem>
          <Form.FormItem>
            <Checkbox checked={formIsCurrent} onChange={(val) => setFormIsCurrent(val as boolean)}>
              设为当前班级（分析学情时默认使用此班级）
            </Checkbox>
          </Form.FormItem>
          <Form.FormItem>
            <Checkbox checked={formOpenInviteCode} onChange={(val) => setFormOpenInviteCode(val as boolean)}>
              开放邀请码登陆（开启后，任何人可使用姓名+邀请码登录，无需预先导入）
            </Checkbox>
          </Form.FormItem>
          <div className="flex gap-2 justify-end">
            <Button onClick={() => { setVisible(false); setFormIsCurrent(false); setFormOpenInviteCode(false); }}>取消</Button>
            <Button theme="primary" type="submit" loading={loading}>
              创建
            </Button>
          </div>
        </Form>
      </Dialog>

      <Dialog
        header="分享学生入口"
        visible={shareVisible}
        onClose={() => setShareVisible(false)}
        footer={null}
        width={480}
      >
        {shareClass && (
          <div className="space-y-4">
            <p className="text-gray-500 text-sm">将以下信息发给学生，学生即可通过邀请码加入班级并开始AI对话学习。</p>
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">班级名称</span>
                <span className="font-medium">{shareClass.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">学生入口</span>
                <span className="font-medium text-[#0052D9]">{window.location.origin}/student</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">邀请码</span>
                <span className="font-mono text-lg font-bold tracking-widest text-[#00A870]">{shareClass.inviteCode}</span>
              </div>
              {shareClass.openInviteCode && (
                <div className="mt-2 p-2 bg-green-50 rounded text-xs text-green-700">
                  ✓ 已开启开放邀请码，学生可直接使用姓名+邀请码登录
                </div>
              )}
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
              <p className="font-medium mb-1">学生操作步骤：</p>
              <ol className="list-decimal list-inside space-y-0.5 text-blue-600">
                <li>打开浏览器，访问上方链接</li>
                {shareClass.openInviteCode ? (
                  <>
                    <li>输入姓名和邀请码</li>
                    <li>点击「进入学习」即可开始</li>
                  </>
                ) : (
                  <>
                    <li>输入姓名/学号和密码（或姓名+邀请码）</li>
                    <li>点击「进入学习」即可开始</li>
                  </>
                )}
              </ol>
            </div>
            <Button
              theme="primary"
              block
              icon={<CopyIcon />}
              onClick={handleCopyShareText}
            >
              复制分享文本
            </Button>
          </div>
        )}
      </Dialog>

      <Dialog
        header="删除班级"
        visible={deleteVisible}
        onClose={() => { setDeleteVisible(false); setDeleteClass(null); }}
        footer={null}
      >
        {deleteClass && (
          <div className="space-y-4">
            <p className="text-gray-700">
              确定要删除班级 <strong>{deleteClass.name}</strong> 吗？
            </p>
            <div className="bg-red-50 rounded-lg p-3 text-sm text-red-700">
              <p className="font-medium mb-1">此操作将同时删除：</p>
              <ul className="list-disc list-inside space-y-0.5 text-red-600">
                <li>该班级的所有学生账号</li>
                <li>所有对话记录和消息</li>
                <li>所有学习材料和评价标准</li>
                <li>所有 AI 分析结果</li>
              </ul>
              <p className="mt-2 font-medium">此操作不可撤销！</p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button onClick={() => { setDeleteVisible(false); setDeleteClass(null); }}>取消</Button>
              <Button theme="danger" loading={loading} onClick={handleDeleteClass}>
                确认删除
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        header="导入学生"
        visible={importVisible}
        onClose={() => setImportVisible(false)}
        footer={null}
        width="600px"
      >
        <div className="space-y-4">
          <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
            <div className="flex items-center justify-between mb-2">
              <p className="font-medium">导入说明：</p>
              <Button size="small" variant="outline" onClick={downloadTemplate}>
                下载模板
              </Button>
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-blue-600">
              <li>支持上传 Excel/CSV 文件（.xlsx, .xls, .csv）</li>
              <li>姓名中的空格会自动去除</li>
              <li>姓名在本次导入中不能重复</li>
              <li>已存在的学生（同名+同班级）将跳过</li>
              <li>密码留空默认为 <strong>123456</strong></li>
              <li>学生可使用姓名/学号+密码登录，或姓名+邀请码（无密码时）</li>
            </ul>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              当前班级
            </label>
            <Select
              value={importClassId}
              onChange={(val) => setImportClassId(val as string)}
              options={classes.map((c) => ({ label: c.name, value: c.id }))}
              placeholder="请选择班级"
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              上传文件
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  parseExcelFile(file);
                  e.target.value = "";
                }
              }}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                icon={<UploadIcon />}
                onClick={() => fileInputRef.current?.click()}
              >
                选择 Excel/CSV 文件
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const template = `姓名,学号,密码\n张三,2026001,123456\n李四,2026002,\n王五,2026003,password123`;
                  const blob = new Blob([template], { type: "text/csv;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "学生导入模板.csv";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                下载 CSV 模板
              </Button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              或粘贴学生信息
            </label>
            <Input
              value={importText}
              onChange={(val) => setImportText(val)}
              placeholder="每行一个学生，格式：姓名,学号,密码&#10;例如：&#10;张三,2026001,123456&#10;李四,2026002,&#10;王五,2026003,password123"
              style={{ width: "100%" }}
              status="default"
            />
            <p className="text-xs text-gray-500 mt-1">
              每行一个学生，格式：姓名,学号,密码（学号和密码可选，密码留空则默认123456）
            </p>
          </div>

          <div className="flex gap-2 justify-end">
            <Button onClick={() => setImportVisible(false)}>取消</Button>
            <Button theme="primary" loading={importLoading} onClick={handleImport}>
              开始导入
            </Button>
          </div>
        </div>
      </Dialog>
    </TeacherLayout>
  );
}
