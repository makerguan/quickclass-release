import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createToken } from "@/lib/auth";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  try {
    // 本地部署只允许一个教师账号
    const teacherCount = await prisma.user.count({ where: { role: "TEACHER" } });
    if (teacherCount > 0) {
      return NextResponse.json(
        { error: "本地部署仅支持一个教师账号，请直接登录" },
        { status: 403 }
      );
    }

    const { phone, password, name, email, school, recoveryQuestion, recoveryAnswer } = await req.json();

    if (!phone || !password || !name) {
      return NextResponse.json(
        { error: "请填写所有必填项" },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findFirst({ where: { phone } });
    if (existing) {
      return NextResponse.json(
        { error: "该手机号已被注册" },
        { status: 409 }
      );
    }

    // TODO: 检查资源广场网站是否已有此手机号注册
    // const externalCheck = await fetch("http://www.maoyouhui.org/api/check-phone", {...});
    // if (externalCheck.ok && externalCheck.data.exists) {
    //   return NextResponse.json({ error: "该手机号已在资源广场注册，请使用原账号登录" }, { status: 409 });
    // }

    const hashedPassword = await bcrypt.hash(password, 10);
    let recoveryAnswerHash = null;
    let passwordKeyHash = null;

    // 如果设置了恢复问题，同时哈希存储答案
    if (recoveryQuestion && recoveryAnswer) {
      recoveryAnswerHash = await bcrypt.hash(recoveryAnswer, 10);
    }

    // 生成密码密钥文件
    const keyToken = crypto.randomUUID() + "-" + Date.now();
    if (recoveryQuestion && recoveryAnswer) {
      passwordKeyHash = await bcrypt.hash(keyToken, 10);
    }

    const user = await prisma.user.create({
      data: {
        phone,
        email,
        password: hashedPassword,
        name,
        role: "TEACHER",
        school,
        recoveryQuestion,
        recoveryAnswerHash,
        passwordKeyHash,
      },
    });

    // TODO: 同步到资源广场网站
    // await fetch("http://www.maoyouhui.org/api/sync-user", {...});

    // 异步填充演示数据（不阻塞 token 返回）
    // 仅第一个教师注册时执行（注册路由已限定本地部署仅一个教师账号）
    void (async () => {
      try {
        const { seedDemoForNewTeacher } = await import("@/../prisma/seed-demo");
        await seedDemoForNewTeacher(user.id, user.name);
      } catch (e) {
        console.error("[register] 演示数据填充失败（不影响注册）:", e);
      }
    })();

    const token = await createToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      // 返回密钥文件内容（仅当设置了恢复问题时）
      recoveryKey: (recoveryQuestion && recoveryAnswer) ? keyToken : null,
    });
  } catch (error) {
    console.error("Register error:", error);
    return NextResponse.json({ error: "注册失败" }, { status: 500 });
  }
}
