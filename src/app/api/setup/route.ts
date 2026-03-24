import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { createUser, getTenantByCode, getUserCount, setUserTenantAccess } from "@/lib/db";
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

    const defaultTenant = getTenantByCode("DEFAULT");
    if (defaultTenant) {
      try {
        setUserTenantAccess(user.id, defaultTenant.id, "admin");
      } catch (e) {
        console.error("Setup: impossibile associare l'utente al tenant DEFAULT:", e);
      }
    }

    // Generate encryption key / AUTH_SECRET if not exists, and inject into process.env
    // so the running process can use them immediately (without a restart)
    const envPath = path.join(process.cwd(), ".env.local");
    let envContent = "";
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, "utf-8");
    }
    let envDirty = false;
    if (!envContent.includes("ENCRYPTION_KEY")) {
      const key = generateEncryptionKey();
      envContent += `\nENCRYPTION_KEY=${key}\n`;
      process.env.ENCRYPTION_KEY = key;
      envDirty = true;
    }
    if (!envContent.includes("AUTH_SECRET")) {
      const authSecret = generateEncryptionKey();
      envContent += `AUTH_SECRET=${authSecret}\n`;
      process.env.AUTH_SECRET = authSecret;
      envDirty = true;
    }
    if (envDirty) {
      fs.writeFileSync(envPath, envContent.replace(/^\n+/, ""));
    }

    return NextResponse.json({ success: true, username: user.username });
  } catch (error) {
    console.error("Setup error:", error);
    return NextResponse.json({ error: "Errore durante il setup" }, { status: 500 });
  }
}
