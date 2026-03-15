import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { getUserCount, createUser } from "@/lib/db";
import { SetupSchema } from "@/lib/validators";
import fs from "fs";
import path from "path";
import { generateEncryptionKey } from "@/lib/crypto";

export async function GET() {
  const count = getUserCount();
  return NextResponse.json({ needsSetup: count === 0 });
}

export async function POST(request: Request) {
  try {
    // Only allow setup if no users exist
    const count = getUserCount();
    if (count > 0) {
      return NextResponse.json({ error: "Setup già completato" }, { status: 400 });
    }

    const body = await request.json();
    const parsed = SetupSchema.safeParse({ ...body, confirm_password: body.password });
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const user = createUser(parsed.data.username, passwordHash, "admin");

    // Generate encryption key if not exists
    const envPath = path.join(process.cwd(), ".env.local");
    if (!fs.existsSync(envPath) || !fs.readFileSync(envPath, "utf-8").includes("ENCRYPTION_KEY")) {
      const key = generateEncryptionKey();
      const authSecret = generateEncryptionKey();
      const envContent = `ENCRYPTION_KEY=${key}\nAUTH_SECRET=${authSecret}\n`;
      fs.appendFileSync(envPath, envContent);
    }

    return NextResponse.json({ success: true, username: user.username });
  } catch (error) {
    console.error("Setup error:", error);
    return NextResponse.json({ error: "Errore durante il setup" }, { status: 500 });
  }
}
