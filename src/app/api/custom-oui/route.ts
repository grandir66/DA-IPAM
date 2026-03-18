import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { invalidateCustomOuiCache } from "@/lib/scanner/mac-vendor";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

const DATA_DIR = path.join(process.cwd(), "data");
const CUSTOM_OUI_PATH = path.join(DATA_DIR, "custom_oui.txt");

export async function GET() {
  try {
    if (!fs.existsSync(CUSTOM_OUI_PATH)) {
      return NextResponse.json({ content: "" });
    }
    const content = fs.readFileSync(CUSTOM_OUI_PATH, "utf-8");
    return NextResponse.json({ content });
  } catch (error) {
    console.error("Error reading custom OUI:", error);
    return NextResponse.json({ error: "Errore nella lettura del file" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const content = typeof body.content === "string" ? body.content : "";
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(CUSTOM_OUI_PATH, content, "utf-8");
    invalidateCustomOuiCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error writing custom OUI:", error);
    return NextResponse.json({ error: "Errore nel salvataggio" }, { status: 500 });
  }
}
