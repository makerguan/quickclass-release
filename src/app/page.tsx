import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import RegisterForm from "./RegisterForm";

// 强制动态渲染，每次请求都查询数据库
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  // 服务端检查是否有教师
  // 已有教师 → 直接重定向到登录页（不会渲染任何 UI）
  // 注意：redirect() 内部通过 throw NEXT_REDIRECT 实现，绝对不能放在 try/catch 里
  let teacherCount = 0;
  try {
    teacherCount = await prisma.user.count({ where: { role: "TEACHER" } });
  } catch (error) {
    // 数据库出错时按"无教师"处理，让用户能看到设置表单
    console.error("Check users error:", error);
  }

  if (teacherCount > 0) {
    // 必须在 try/catch 外面调用 redirect
    redirect("/login");
  }

  // 没有教师 → 渲染注册表单
  return <RegisterForm />;
}
