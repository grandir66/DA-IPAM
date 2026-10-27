import { NextResponse } from "next/server";
import fs from "fs";
import { unisci } from "@/lib/percorsi";

export async function GET() {
  try {
    const pkgPath = unisci(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return NextResponse.json({ version: pkg.version, name: pkg.name });
  } catch {
    return NextResponse.json({ version: "0.0.0", name: "da-invent" });
  }
}
