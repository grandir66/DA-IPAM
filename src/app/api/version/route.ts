import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

export async function GET() {
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return NextResponse.json({ version: pkg.version, name: pkg.name });
  } catch {
    return NextResponse.json({ version: "0.0.0", name: "da-invent" });
  }
}
