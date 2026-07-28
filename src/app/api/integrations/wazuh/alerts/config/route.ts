/**
 * Configurazione della RACCOLTA degli alert di sicurezza.
 *
 * Separata dalle notifiche di proposito: qui si decide cosa e' un attacco e
 * cosa e' roba nostra, la' come lo si comunica. Erano finite insieme e non
 * aveva senso cercare "gli IP da escludere" sotto "Notifiche".
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import {
  getDeclaredSelfIdentity,
  setDeclaredSelfIdentity,
} from "@/lib/integrations/self-identity";
import { getWazuhConfig, setWazuhConfig } from "@/lib/integrations/wazuh-config";
import {
  getNotificationConfig,
  setNotificationConfig,
} from "@/lib/notifications/config";
import { isCidr } from "@/lib/integrations/ip-range";

const BodySchema = z.object({
  selfIps: z.array(z.string().max(40)).max(200).optional(),
  selfAccounts: z.array(z.string().max(80)).max(200).optional(),
  deviceRuleIds: z.array(z.string().max(12)).max(100).optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
});

/** Segnala le voci che non sono ne' un IP ne' una rete valida. */
function invalidIps(entries: string[]): string[] {
  const plain = /^\d{1,3}(\.\d{1,3}){3}$/;
  return entries.filter((e) => !plain.test(e.trim()) && !isCidr(e));
}

export async function GET() {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  const self = getDeclaredSelfIdentity();
  return NextResponse.json({
    selfIps: self.ips,
    selfAccounts: self.accounts,
    deviceRuleIds: getWazuhConfig().deviceRuleIds,
    retentionDays: getNotificationConfig().retentionDays,
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

  if (d.selfIps) {
    const bad = invalidIps(d.selfIps);
    if (bad.length > 0) {
      return NextResponse.json(
        { error: `Non sono indirizzi o reti validi: ${bad.join(", ")}` },
        { status: 400 },
      );
    }
  }

  if (d.selfIps !== undefined || d.selfAccounts !== undefined) {
    setDeclaredSelfIdentity({ ips: d.selfIps, accounts: d.selfAccounts });
  }
  if (d.deviceRuleIds !== undefined) setWazuhConfig({ deviceRuleIds: d.deviceRuleIds });
  if (d.retentionDays !== undefined) setNotificationConfig({ retentionDays: d.retentionDays });

  const self = getDeclaredSelfIdentity();
  return NextResponse.json({
    selfIps: self.ips,
    selfAccounts: self.accounts,
    deviceRuleIds: getWazuhConfig().deviceRuleIds,
    retentionDays: getNotificationConfig().retentionDays,
  });
}
