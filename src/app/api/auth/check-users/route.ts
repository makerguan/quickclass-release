import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const userCount = await prisma.user.count();
    return NextResponse.json({ hasUsers: userCount > 0 });
  } catch (error) {
    console.error("Check users error:", error);
    return NextResponse.json({ hasUsers: false });
  }
}