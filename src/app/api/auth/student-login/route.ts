import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createToken } from "@/lib/auth";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  try {
    const { name, studentNo, inviteCode, password } = await req.json();

    // 检查必填：至少需要姓名或学号
    if (!name && !studentNo) {
      return NextResponse.json({ error: "请填写姓名或学号" }, { status: 400 });
    }

    // ===== 情况1：邀请码登录（无密码或忘记密码时使用） =====
    if (inviteCode) {
      const classData = await prisma.class.findUnique({
        where: { inviteCode },
      });

      if (!classData) {
        return NextResponse.json({ error: "邀请码无效" }, { status: 404 });
      }

      // 在该班级内查找学生
      const whereClause: any = {
        classId: classData.id,
        role: "STUDENT",
      };
      if (name) whereClause.name = name;
      else if (studentNo) whereClause.studentNo = studentNo;

      let user = await prisma.user.findFirst({ where: whereClause });

      if (user) {
        // 已有账号：有密码的拒绝邀请码登录，无密码的允许
        if (user.password) {
          return NextResponse.json(
            { error: "您已设置密码，请使用姓名/学号+密码登录" },
            { status: 401 }
          );
        }

        // 无密码，邀请码登录成功
        const token = await createToken({
          userId: user.id,
          name: user.name,
          role: user.role,
          classId: user.classId,
        });

        return NextResponse.json({
          token,
          user: {
            id: user.id,
            name: user.name,
            role: user.role,
            classId: user.classId,
            className: classData.name,
            hasPassword: false,
            studentMotto: user.studentMotto,
          },
        });
      } else {
        // 没有该学生，检查班级是否开放邀请码注册
        if (!classData.openInviteCode) {
          return NextResponse.json(
            { error: "该班级未开放邀请码注册，请联系老师获取帮助" },
            { status: 403 }
          );
        }

        // 开放邀请码，创建新账号（不设置密码）
        if (!name && !studentNo) {
          return NextResponse.json({ error: "请填写姓名或学号" }, { status: 400 });
        }

        // 检查班级内是否已有同名/同学号学生
        if (name) {
          const existing = await prisma.user.findFirst({
            where: { name, classId: classData.id, role: "STUDENT" },
          });
          if (existing) {
            return NextResponse.json({ error: "该班级已有同名学生" }, { status: 400 });
          }
        }
        if (studentNo) {
          const existing = await prisma.user.findFirst({
            where: { studentNo, classId: classData.id, role: "STUDENT" },
          });
          if (existing) {
            return NextResponse.json({ error: "该班级已有同学号的学生" }, { status: 400 });
          }
        }

        user = await prisma.user.create({
          data: {
            name: name || `学生${studentNo || Date.now()}`,
            studentNo: studentNo || null,
            role: "STUDENT",
            classId: classData.id,
            password: null, // 不设置密码
          },
        });

        const token = await createToken({
          userId: user.id,
          name: user.name,
          role: user.role,
          classId: user.classId,
        });

        return NextResponse.json({
          token,
          user: {
            id: user.id,
            name: user.name,
            role: user.role,
            classId: user.classId,
            className: classData.name,
            hasPassword: false,
            studentMotto: user.studentMotto,
          },
        });
      }
    }

    // ===== 情况2：密码登录（必须有密码） =====
    if (password) {
      // 用姓名或学号查找学生
      let user = null;

      if (name) {
        user = await prisma.user.findFirst({
          where: { name, role: "STUDENT" },
          include: { Class_User_classIdToClass: true },
        });

        if (user && studentNo && user.studentNo !== studentNo) {
          return NextResponse.json({ error: "学号与姓名不匹配" }, { status: 401 });
        }
      }

      if (!user && studentNo) {
        user = await prisma.user.findFirst({
          where: { studentNo, role: "STUDENT" },
          include: { Class_User_classIdToClass: true },
        });

        if (user && name && user.name !== name) {
          return NextResponse.json({ error: "姓名与学号不匹配" }, { status: 401 });
        }
      }

      if (!user) {
        return NextResponse.json({ error: "学生不存在" }, { status: 404 });
      }

      if (!user.password) {
        return NextResponse.json(
          { error: "您还未设置密码，请使用姓名+邀请码登录" },
          { status: 401 }
        );
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return NextResponse.json({ error: "密码错误" }, { status: 401 });
      }

      // 登录成功
      const token = await createToken({
        userId: user.id,
        name: user.name,
        role: user.role,
        classId: user.classId,
      });

      return NextResponse.json({
        token,
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
          classId: user.classId,
          className: user.Class_User_classIdToClass?.name,
          hasPassword: true,
        },
      });
    }

    // ===== 情况3：什么都没提供，提示 =====
    return NextResponse.json(
      { error: "请填写邀请码或密码" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Student login error:", error);
    return NextResponse.json({ error: "登录失败" }, { status: 500 });
  }
}