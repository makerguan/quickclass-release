import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createToken } from "@/lib/auth";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";

type StudentCandidate = Prisma.UserGetPayload<{
  include: { Class_User_classIdToClass: true };
}>;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // 输入归一化：去除首尾空格，避免粘贴/输入空格导致匹配失败（密码不 trim，可能合法含空格）
    const name = (body.name ?? "").toString().trim() || "";
    const studentNo = (body.studentNo ?? "").toString().trim() || "";
    const inviteCode = (body.inviteCode ?? "").toString().trim() || "";
    const password = body.password;
    // 二次登录时用于指定班级：同名/同学号学生跨班多账号时，由学生选择课堂后回传
    const classId = (body.classId ?? "").toString().trim() || "";

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
      // 定位候选学生：学号优先（唯一性强），未命中再按姓名兜底。
      // 姓名和学号都可能跨班级重复（学号仅班内查重），因此先收集全部候选再逐步收窄，
      // 避免 findFirst 无排序导致同名学生登录到哪个课堂不可控
      let candidates: StudentCandidate[] = [];

      if (studentNo) {
        candidates = await prisma.user.findMany({
          where: { studentNo, role: "STUDENT" },
          include: { Class_User_classIdToClass: true },
          orderBy: { createdAt: "asc" },
        });

        // 学号命中但姓名全部不符：学号录错或填错，明确报错
        if (candidates.length > 0 && name && !candidates.some((c) => c.name === name)) {
          return NextResponse.json({ error: "姓名与学号不匹配" }, { status: 401 });
        }
      }

      if (candidates.length === 0 && name) {
        candidates = await prisma.user.findMany({
          where: { name, role: "STUDENT" },
          include: { Class_User_classIdToClass: true },
          orderBy: { createdAt: "asc" },
        });
        // 姓名命中即可作为候选，不再因学号不一致（含账号未录学号）拒绝：
        // 学号仅作辅助定位，认证因子是密码
      }

      if (candidates.length === 0) {
        return NextResponse.json(
          {
            error: studentNo && !name
              ? "未找到该学号的学生，请确认学号或改用姓名登录"
              : "学生不存在，请确认姓名或学号",
          },
          { status: 404 }
        );
      }

      // 指定了班级（同名学生二次登录选择课堂）：收窄到该班级
      if (classId) {
        const narrowed = candidates.filter((c) => c.classId === classId);
        if (narrowed.length === 0) {
          return NextResponse.json(
            { error: "所选班级下没有匹配的学生" },
            { status: 404 }
          );
        }
        candidates = narrowed;
      }

      // 逐一验证密码，收集全部匹配的账号
      const matched: StudentCandidate[] = [];
      for (const c of candidates) {
        if (c.password && (await bcrypt.compare(password, c.password))) {
          matched.push(c);
        }
      }

      if (matched.length === 0) {
        if (!candidates.some((c) => c.password)) {
          return NextResponse.json(
            { error: "您还未设置密码，请使用姓名+邀请码登录" },
            { status: 401 }
          );
        }
        return NextResponse.json({ error: "密码错误" }, { status: 401 });
      }

      // 密码匹配到多个班级的账号（如同名跨班且都被重置为默认密码）：
      // 不随机进入某个课堂，返回班级列表让学生选择
      if (matched.length > 1) {
        return NextResponse.json({
          needClassSelection: true,
          classes: matched.map((c) => ({
            classId: c.classId,
            className: c.Class_User_classIdToClass?.name || "未知班级",
          })),
        });
      }

      const user = matched[0];

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