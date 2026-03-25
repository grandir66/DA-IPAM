import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { createUser, getUserCount, createTenant, createTenantDatabase, setUserTenantAccess } from "@/lib/db";
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

    const { username, password, mode, codice_cliente, ragione_sociale } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);

    if (mode === "single") {
      // Single-tenant: crea tenant + utente admin collegato
      const tenantCode = codice_cliente!.toUpperCase();
      const tenant = createTenant({
        codice_cliente: tenantCode,
        ragione_sociale: ragione_sociale!,
        indirizzo: null,
        citta: null,
        provincia: null,
        cap: null,
        telefono: null,
        email: null,
        piva: null,
        cf: null,
        referente: null,
        note: null,
        active: 1,
      });

      // Crea il database SQLite del tenant
      createTenantDatabase(tenantCode);

      // Crea utente admin collegato al tenant
      const user = createUser(username, passwordHash, "admin", tenant.id);
      setUserTenantAccess(user.id, tenant.id, "admin");
    } else {
      // Multi-tenant (MSP): crea superadmin
      createUser(username, passwordHash, "superadmin");
    }

    // Generate encryption key / AUTH_SECRET if not exists, and inject into process.env
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

    return NextResponse.json({ success: true, username });
  } catch (error) {
    console.error("Setup error:", error);
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return NextResponse.json({ error: "Codice cliente già esistente" }, { status: 409 });
    }
    return NextResponse.json({ error: "Errore durante il setup" }, { status: 500 });
  }
}
