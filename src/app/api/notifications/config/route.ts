/**
 * Configurazione del motore di notifica (hub-level).
 *
 *   GET   → configurazione senza segreti
 *   POST  → aggiorna. Password e header di auth: stringa vuota = non toccare.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import {
  getNotificationConfigPublic,
  setNotificationConfig,
} from "@/lib/notifications/config";
import { ALERT_CATEGORIES } from "@/lib/integrations/wazuh-alerts";
import {
  getDeclaredSelfIdentity,
  setDeclaredSelfIdentity,
} from "@/lib/integrations/self-identity";

const BodySchema = z.object({
  enabled: z.boolean().optional(),

  smtpEnabled: z.boolean().optional(),
  smtpHost: z.string().max(255).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().max(255).optional(),
  smtpPassword: z.string().max(255).optional(),
  smtpFrom: z.string().max(255).optional(),
  smtpTo: z.string().max(1000).optional(),

  webhookEnabled: z.boolean().optional(),
  webhookUrl: z.string().max(500).optional(),
  webhookAuthHeader: z.string().max(500).optional(),

  immediateCategories: z.array(z.string().max(40)).max(20).optional(),
  immediateMinLevel: z.number().int().min(1).max(16).optional(),
  digestIntervalMinutes: z.number().int().min(5).max(1440).optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
  /** Reti/IP nostri (anche CIDR) e account di servizio da non trattare come attacchi. */
  selfIps: z.array(z.string().max(40)).max(200).optional(),
  selfAccounts: z.array(z.string().max(80)).max(200).optional(),
});

export async function GET() {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  return NextResponse.json({
    config: getNotificationConfigPublic(),
    categories: ALERT_CATEGORIES.map((c) => ({ id: c.id, labelIt: c.labelIt })),
    self: getDeclaredSelfIdentity(),
  });
}

export async function POST(req: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;

  const policy =
    d.immediateCategories !== undefined ||
    d.immediateMinLevel !== undefined ||
    d.digestIntervalMinutes !== undefined
      ? {
          ...(d.immediateCategories !== undefined
            ? { immediateCategories: d.immediateCategories }
            : {}),
          ...(d.immediateMinLevel !== undefined
            ? { immediateMinLevel: d.immediateMinLevel }
            : {}),
          ...(d.digestIntervalMinutes !== undefined
            ? { digestIntervalMinutes: d.digestIntervalMinutes }
            : {}),
        }
      : undefined;

  if (d.selfIps !== undefined || d.selfAccounts !== undefined) {
    setDeclaredSelfIdentity({ ips: d.selfIps, accounts: d.selfAccounts });
  }

  setNotificationConfig({
    ...d,
    ...(policy
      ? { policy: policy as Parameters<typeof setNotificationConfig>[0]["policy"] }
      : {}),
  });

  return NextResponse.json({
    config: getNotificationConfigPublic(),
    self: getDeclaredSelfIdentity(),
  });
}
