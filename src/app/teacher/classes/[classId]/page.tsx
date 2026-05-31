"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useParams } from "next/navigation";
import {
  Button,
  Card,
  Table,
  MessagePlugin,
  Dialog,
  Checkbox,
} from "tdesign-react";
import { DeleteIcon, ArrowLeftIcon } from "tdesign-icons-react";
import TeacherLayout from "@/components/layout/TeacherLayout";

interface StudentInfo {
  id: string;
  name: string;
  studentNo: string | null;
  createdAt: string;
  password: string | null;
}

interface ClassDetail {
  id: string;
  name: string;
  description: string | null;
  inviteCode: string;
  students: StudentInfo[];
}

export default function ClassDetailPage() {
  const router = useRouter();
  const params = useParams();
  const classId = params.classId as string;
  const [classData, setClassData] = useState<ClassDetail | null>(null);
  const [deleteStudentId, setDeleteStudentId] = useState<string | null>(null);
  const [deleteStudentName, setDeleteStudentName] = useState("");
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resetStudentId, setResetStudentId] = useState<string | null>(null);
  const [resetStudentName, setResetStudentName] = useState("");
  const [resetVisible, setResetVisible] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  // 批量删除
  const [selectedRowKeys, setSelectedRowKeys] = useState<(string | number)[]>([]);
  const [batchDeleteVisible, setBatchDeleteVisible] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  useEffect(() => {
    if (classId) {
      fetchClassDetail();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  const fetchClassDetail = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/classes/${classId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setClassData(data);
      }
    } catch {
      console.error("获取班级详情失败");
    }
  };

  const studentColumns = [
    { colKey: "row-select", type: "multiple" as const, width: 40 },
    { colKey: "name", title: "姓名" },
    { colKey: "studentNo", title: "学号" },
    { colKey: "createdAt", title: "加入时间", cell: ({ row }: { row: Record<string, unknown> }) => new Date(row.createdAt as string).toLocaleString() },
    {
      colKey: "password",
      title: "密码状态",
      cell: ({ row }: { row: { password: string | null } }) => row.password ? (
        <span className="text-green-600 text-xs">已设密码</span>
      ) : (
        <span className="text-gray-400 text-xs">仅邀请码</span>
      ),
    },
    {
      colKey: "action",
      title: "操作",
      cell: ({ row }: { row: { id: string; name: string } }) => (
        <div className="flex gap-2">
          <Button
            theme="warning"
            variant="text"
            size="small"
            onClick={() => {
              setResetStudentId(row.id);
              setResetStudentName(row.name);
              setResetVisible(true);
            }}
          >
            重置密码
          </Button>
          <Button
            theme="danger"
            variant="text"
            size="small"
            icon={<DeleteIcon />}
            onClick={() => {
              setDeleteStudentId(row.id);
              setDeleteStudentName(row.name);
              setDeleteVisible(true);
            }}
          >
            删除
          </Button>
        </div>
      ),
    },
  ];

  const handleDeleteStudent = async () => {
    if (!deleteStudentId) return;
    setDeleting(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/students/${deleteStudentId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        MessagePlugin.success("学生已删除");
        setDeleteVisible(false);
        setDeleteStudentId(null);
        fetchClassDetail();
      } else {
        const data = await res.json();
        MessagePlugin.error(data.error || "删除失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setDeleting(false);
    }
  };

  // 批量删除学生
  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return;
    setBatchDeleting(true);
    try {
      const token = localStorage.getItem("token");
      let successCount = 0;
      let failCount = 0;
      for (const id of selectedRowKeys) {
        const res = await fetch(`/api/students/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          successCount++;
        } else {
          failCount++;
        }
      }
      setBatchDeleteVisible(false);
      setSelectedRowKeys([]);
      if (failCount === 0) {
        MessagePlugin.success(`已删除 ${successCount} 名学生`);
      } else {
        MessagePlugin.warning(`删除 ${successCount} 名，失败 ${failCount} 名`);
      }
      fetchClassDetail();
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setBatchDeleting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetStudentId) return;
    setResetLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/teachers/students/${resetStudentId}/reset-password`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        MessagePlugin.success(`已重置 ${resetStudentName} 的密码`);
        setResetVisible(false);
        setResetStudentId(null);
        fetchClassDetail();
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

  return (
    <TeacherLayout>
      <div className="mb-4 flex items-center gap-3">
        <Button theme="default" variant="text" size="small" icon={<ArrowLeftIcon />} onClick={() => router.back()} className="mr-1" />
        <h2 className="text-xl font-semibold">{classData?.name}</h2>
        <p className="text-gray-500 text-sm mt-1">
          邀请码：{classData?.inviteCode}
        </p>
      </div>

      <Card>
        <div className="mb-4 flex items-center gap-3">
          {selectedRowKeys.length > 0 && (
            <>
              <span className="text-sm text-gray-600">
                已选 {selectedRowKeys.length} 名学生
              </span>
              <Button
                theme="danger"
                size="small"
                icon={<DeleteIcon />}
                onClick={() => setBatchDeleteVisible(true)}
              >
                批量删除
              </Button>
            </>
          )}
        </div>
        <Table
          data={classData?.students || []}
          columns={studentColumns}
          rowKey="id"
          selectedRowKeys={selectedRowKeys}
          onSelectChange={(keys: (string | number)[]) => setSelectedRowKeys(keys)}
        />
      </Card>

      <Dialog
        header="删除学生"
        visible={deleteVisible}
        onClose={() => { setDeleteVisible(false); setDeleteStudentId(null); }}
        footer={null}
      >
        <div className="space-y-4">
          <p className="text-gray-700">
            确定要删除学生 <strong>{deleteStudentName}</strong> 吗？
          </p>
          <div className="bg-red-50 rounded-lg p-3 text-sm text-red-700">
            <p className="font-medium mb-1">此操作将同时删除：</p>
            <ul className="list-disc list-inside space-y-0.5 text-red-600">
              <li>该学生的所有对话记录和消息</li>
              <li>该学生的 AI 分析结果</li>
            </ul>
            <p className="mt-2 font-medium">此操作不可撤销！</p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button onClick={() => { setDeleteVisible(false); setDeleteStudentId(null); }}>取消</Button>
            <Button theme="danger" loading={deleting} onClick={handleDeleteStudent}>
              确认删除
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        header="重置学生密码"
        visible={resetVisible}
        onClose={() => { setResetVisible(false); setResetStudentId(null); }}
        footer={null}
      >
        {resetStudentName && (
          <div className="space-y-4">
            <p className="text-gray-700">
              确定要重置学生 <strong>{resetStudentName}</strong> 的密码吗？
            </p>
            <div className="bg-yellow-50 rounded-lg p-3 text-sm text-yellow-700">
              <p className="font-medium mb-1">重置后：</p>
              <ul className="list-disc list-inside space-y-0.5 text-yellow-600">
                <li>该学生密码将清除，恢复到可用邀请码登录的状态</li>
                <li>学生再次登录时只需输入姓名和邀请码</li>
                <li>学生可在个人中心重新设置密码</li>
              </ul>
            </div>
            <div className="flex gap-2 justify-end">
              <Button onClick={() => { setResetVisible(false); setResetStudentId(null); }}>取消</Button>
              <Button theme="warning" loading={resetLoading} onClick={handleResetPassword}>
                确认重置
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        header="批量删除学生"
        visible={batchDeleteVisible}
        onClose={() => { setBatchDeleteVisible(false); }}
        footer={null}
      >
        <div className="space-y-4">
          <p className="text-gray-700">
            确定要删除选中的 <strong>{selectedRowKeys.length}</strong> 名学生吗？
          </p>
          <div className="bg-red-50 rounded-lg p-3 text-sm text-red-700">
            <p className="font-medium mb-1">此操作将同时删除：</p>
            <ul className="list-disc list-inside space-y-0.5 text-red-600">
              <li>这些学生的所有对话记录和消息</li>
              <li>这些学生的 AI 分析结果</li>
              <li>这些学生的互动探究和作业答题数据</li>
            </ul>
            <p className="mt-2 font-medium">此操作不可撤销！</p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button onClick={() => { setBatchDeleteVisible(false); }}>取消</Button>
            <Button theme="danger" loading={batchDeleting} onClick={handleBatchDelete}>
              确认删除
            </Button>
          </div>
        </div>
      </Dialog>
    </TeacherLayout>
  );
}
