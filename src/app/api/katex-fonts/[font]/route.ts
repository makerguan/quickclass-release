import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

const FONT_NAME_PATTERN = /^KaTeX_[A-Za-z0-9_-]+\.(woff2|woff|ttf)$/;
const CONTENT_TYPES: Record<string, string> = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ font: string }> }
) {
  try {
    const { font } = await params;
    if (!FONT_NAME_PATTERN.test(font)) {
      return NextResponse.json({ error: "字体文件不存在" }, { status: 404 });
    }

    const fontPath = path.join(
      process.cwd(),
      "node_modules",
      "katex",
      "dist",
      "fonts",
      font
    );
    const data = fs.readFileSync(fontPath);

    return new NextResponse(data, {
      headers: {
        "Content-Type": CONTENT_TYPES[path.extname(font)] || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "字体文件不存在" }, { status: 404 });
  }
}
