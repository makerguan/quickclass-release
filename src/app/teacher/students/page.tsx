"use client";

import { useEffect, useState } from "react";
import { Card, Table, Button, Dialog, MessagePlugin, Input, Select } from "tdesign-react";
import TeacherLayout from "@/components/layout/TeacherLayout";

interface Student {
  id: string;
  name: string;
  studentNo: string | null;
  classId: string;
  className: string;
  hasPassword?: boolean;
}

interface ClassOption {
  label: string;
  value: string;
}

export default function TeacherStudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [resetVisible, setResetVisible] = useState(false);
  const [resetStudent, setResetStudent] = useState<Student | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [importVisible, setImportVisible] = useState(false);
  const [importClassId, setImportClassId] = useState("");
  const [importText, setImportText] = useState("");
  const [importLoading, setImportLoading] = useState(false);

  useEffect(() => {
    fetchStudents();
    fetchClasses();
  }, []);

  const fetchStudents = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/teachers/students", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setStudents(data as Student[]);
      }
    } catch {
      console.error("获取学生列表失败");
    }
  };

  const fetchClasses = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/classes", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setClasses(data.map((c: { id: string; name: string }) => ({
          label: c.name,
          value: c.id,
        })));
      }
    } catch {
      console.error("获取班级列表失败");
    }
  };

  const handleResetPassword = async () => {
    if (!resetStudent) return;
    setResetLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/teachers/students/${resetStudent.id}/reset-password`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        MessagePlugin.success(`已重置 ${resetStudent.name} 的密码`);
        setResetVisible(false);
        setResetStudent(null);
      } else {
        const data = await res.json();
        MessagePlugin.error(data.error || "重置失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setResetLoading(false);
    }
  };

  const parseImportText = (text: string): { name: string; studentNo: string | null; password: string | null }[] => {
    const lines = text.trim().split("\n").filter((line) => line.trim());
    return lines.map((line) => {
      // 支持 CSV 格式（逗号分隔）或 Tab 分隔
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
      MessagePlugin.warning("请选择班级");
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
        // 显示警告信息
        if (data.warnings && data.warnings.length > 0) {
          MessagePlugin.warning(data.message + "\n" + data.warnings.join("\n"));
        } else {
          MessagePlugin.success(data.message);
        }
        setImportVisible(false);
        setImportText("");
        setImportClassId("");
        fetchStudents();
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

  const columns = [
    { colKey: "name", title: "姓名" },
    { colKey: "studentNo", title: "学号" },
    { colKey: "className", title: "所在班级" },
    {
      colKey: "action",
      title: "操作",
      cell: ({ row }: { row: Student }) => (
        <div className="flex gap-2">
          <Button
            theme="warning"
            variant="text"
            size="small"
            onClick={() => {
              setResetStudent(row);
              setResetVisible(true);
            }}
          >
            重置密码
          </Button>
        </div>
      ),
    },
  ];

  return (
    <TeacherLayout>
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">学生管理</h2>
            <p className="text-gray-500 text-sm mt-1">查看所有班级学生列表，可导入和重置密码</p>
          </div>
          <Button theme="primary" onClick={() => setImportVisible(true)}>
            导入学生
          </Button>
        </div>
      </div>

      <Card>
        <Table data={students} columns={columns} rowKey="id" />
      </Card>

      <Dialog
        header="重置学生密码"
        visible={resetVisible}
        onClose={() => { setResetVisible(false); setResetStudent(null); }}
        footer={null}
      >
        {resetStudent && (
          <div className="space-y-4">
            <p className="text-gray-700">
              确定要重置学生 <strong>{resetStudent.name}</strong> 的密码吗？
            </p>
            <div className="bg-yellow-50 rounded-lg p-3 text-sm text-yellow-700">
              <p className="font-medium mb-1">重置后：</p>
              <ul className="list-disc list-inside space-y-0.5 text-yellow-600">
                <li>密码将恢复为默认密码（123456）</li>
                <li>学生可使用姓名/学号+密码登录</li>
              </ul>
            </div>
            <div className="flex gap-2 justify-end">
              <Button onClick={() => { setResetVisible(false); setResetStudent(null); }}>取消</Button>
              <Button theme="warning" loading={resetLoading} onClick={handleResetPassword}>
                确认重置
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              选择班级 <span className="text-red-500">*</span>
            </label>
            <Select
              value={importClassId}
              onChange={(val) => setImportClassId(val as string)}
              options={classes}
              placeholder="请选择班级"
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              学生信息 <span className="text-red-500">*</span>
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

          <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
            <div className="flex items-center justify-between mb-2">
              <p className="font-medium">导入说明：</p>
              <Button size="small" variant="outline" onClick={downloadTemplate}>
                下载模板
              </Button>
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-blue-600">
              <li>姓名中的空格会自动去除</li>
              <li>姓名在本次导入中不能重复</li>
              <li>已存在的学生（同名+同班级）将跳过</li>
              <li>密码留空默认为 <strong>123456</strong></li>
              <li>学生可使用姓名/学号+密码登录，或姓名+邀请码（无密码时）</li>
            </ul>
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
