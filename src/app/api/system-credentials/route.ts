import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireAdmin } from "@/lib/api-auth";
import {
  listCredentials,
  createCredential,
  logCredentialEvent,
} from "@/lib/credentials-vault";

const KindEnum = z.enum([
  "wazuh",
  "graylog",
  "librenms",
  "truenas",
  "edge",
  "hub",
  "tailscale",
  "pve",
  "other",
]);
const LaunchModeEnum = z.enum(["copy", "sso_form", "sso_token"]);

const CreateSchema = z.object({
  kind: KindEnum,
  label: z.string().min(1).max(120),
  url: z.string().url().nullable().optional(),
  api_url: z.string().url().nullable().optional(),
  username: z.string().nullable().optional(),
  password: z.string().nullable().optional(),
  api_token: z.string().nullable().optional(),
  extra: z.record(z.string(), z.string()).nullable().optional(),
  launch_mode: LaunchModeEnum.optional(),
  notes: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

export async function GET() {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;
  const items = listCredentials();
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const created = createCredential(parsed.data);
  logCredentialEvent({
    credentialId: created.id,
    action: "create",
    actorUsername: session.user.name ?? null,
    result: "ok",
    details: { kind: created.kind, label: created.label },
  });
  return NextResponse.json({ item: created }, { status: 201 });
}
