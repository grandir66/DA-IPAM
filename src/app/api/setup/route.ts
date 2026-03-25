import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { createUser, getUserCount, getActiveTenants, setUserTenantAccess } from "@/lib/db";
import { SetupSchema } from "@/lib/validators";
import fs from "fs";
import path from "path";
import { generateEncryptionKey } from "@/lib/crypto";

export async function GET() {
  const count = getUserCount();
  const needsSetup = count === 0;
  // Restituisci lista tenant solo durante il setup (nessun dato sensibile)
  const tenants = needsSetup
    ? getActiveTenants().map(t => ({ id: t.id, codice_cliente: t.codice_cliente, ragione_sociale: t.ragione_sociale }))
    : [];
  return NextResponse.json({ needsSetup, tenants });
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

    const { username, password, role, tenant_id } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);

    const user = createUser(
      username,
      passwordHash,
      role ?? "superadmin",
      role === "admin" && tenant_id ? tenant_id : undefined,
    );

    // Se admin, collega l'utente al tenant selezionato
    if (role === "admin" && tenant_id) {
      setUserTenantAccess(user.id, tenant_id, "admin");
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
