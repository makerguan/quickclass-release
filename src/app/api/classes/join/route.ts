import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, studentNo, inviteCode } = body;

    if (!name || !inviteCode) {
      return NextResponse.json({ error: "姓名和邀请码不能为空" }, { status: 400 });
    }

    const classData = await prisma.class.findUnique({
      where: { inviteCode },
    });

    if (!classData) {
      return NextResponse.json({ error: "邀请码无效" }, { status: 404 });
    }

    if (classData.status !== "ACTIVE") {
      return NextResponse.json({ error: "该班级已结束" }, { status: 400 });
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        name,
        classId: classData.id,
        role: "STUDENT",
      },
    });

    if (existingUser) {
      const token = await import("@/lib/auth").then((m) =>
        m.createToken({
          userId: existingUser.id,
          email: existingUser.email || "",
          role: existingUser.role,
          name: existingUser.name,
        })
      );
      return NextResponse.json({
        token,
        user: { id: existingUser.id, name: existingUser.name, role: existingUser.role },
        class: classData,
      });
    }

    const newStudent = await prisma.user.create({
      data: {
        name,
        studentNo: studentNo || null,
        role: "STUDENT",
        classId: classData.id,
      },
    });

    const token = await import("@/lib/auth").then((m) =>
      m.createToken({
        userId: newStudent.id,
        email: newStudent.email || "",
        role: newStudent.role,
        name: newStudent.name,
      })
    );

    return NextResponse.json({
      token,
      user: { id: newStudent.id, name: newStudent.name, role: newStudent.role },
      class: classData,
    });
  } catch (error) {
    console.error("Join class error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
