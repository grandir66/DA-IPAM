import { NextResponse } from "next/server";
import { requireAdminOrOnboarding, requireAuth } from "@/lib/api-auth";
import {
  getAdIntegrations,
  createAdIntegration,
} from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { z } from "zod/v4";

const AdIntegrationSchema = z.object({
  name: z.string().min(1),
  dc_host: z.string().min(1),
  domain: z.string().min(1),
  base_dn: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  use_ssl: z.boolean().default(true),
  port: z.number().int().positive().default(636),
  enabled: z.boolean().default(true),
  winrm_credential_id: z.number().int().positive().nullable().optional(),
});

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const integrations = getAdIntegrations();
  const masked = integrations.map((i) => ({
    ...i,
    encrypted_username: undefined,
    encrypted_password: undefined,
    username: "●●●●●●●●",
    password: "●●●●●●●●",
  }));
  return NextResponse.json(masked);
}

export async function POST(request: Request) {
  const auth = await requireAdminOrOnboarding();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const parsed = AdIntegrationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Dati non validi", details: parsed.error.issues }, { status: 400 });
    }

    const { name, dc_host, domain, base_dn, username, password, use_ssl, port, enabled, winrm_credential_id } = parsed.data;

    const integration = createAdIntegration({
      name,
      dc_host,
      domain,
      base_dn,
      encrypted_username: encrypt(username),
      encrypted_password: encrypt(password),
      use_ssl: use_ssl ? 1 : 0,
      port,
      enabled: enabled ? 1 : 0,
      winrm_credential_id: winrm_credential_id ?? null,
    });

    return NextResponse.json({
      ...integration,
      encrypted_username: undefined,
      encrypted_password: undefined,
      username: "●●●●●●●●",
      password: "●●●●●●●●",
    }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Errore sconosciuto";
    if (msg.includes("UNIQUE constraint")) {
      return NextResponse.json({ error: "Integrazione già esistente per questo DC e dominio" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
