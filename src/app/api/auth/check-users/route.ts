import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// 强制动态路由，避免被 Next.js 静态缓存（注册后必须立即能查到这个新用户）
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    // 只检测"教师用户"，与 /api/auth/register 保持一致
    // 本地部署只支持一个教师账号；学生加入班级时会动态创建，不影响此判断
    const teacherCount = await prisma.user.count({ where: { role: "TEACHER" } });
    return NextResponse.json({ hasTeacher: teacherCount > 0 });
  } catch (error) {
    console.error("Check users error:", error);
    // 出错时也按"无教师"处理，让用户能看到设置表单
    return NextResponse.json({ hasTeacher: false });
  }
}