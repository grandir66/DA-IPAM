import { NextResponse } from "next/server";
import { requireAdminOrOnboarding } from "@/lib/api-auth";
import { withTenantFromSession, getServerTenantCode } from "@/lib/api-tenant";
import { ensureAdSyncJob } from "@/lib/ad/sincronizzazione";
import { getAdIntegrations } from "@/lib/db";
import { creaIntegrazioneAd, VoceNonValePerProtocollo } from "@/lib/credentials/lega-voce";
import { accountDalCorpo } from "@/lib/ad/account-ldap";
import { AccountLdapNonValido, vistaIntegrazioneAd, vistaIntegrazioniAd } from "@/lib/ad/credenziale-ldap";
import { z } from "zod/v4";

/**
 * L'account LDAP (tappa 2f, T24): `credential_id` di una voce «Active
 * Directory», oppure `username` e `password` di un account nuovo, che diventa
 * la voce «AD · <nome>» (pagina, «Nuova nell'archivio», e wizard di avvio).
 */
const AdIntegrationSchema = z.object({
  name: z.string().min(1),
  dc_host: z.string().min(1),
  domain: z.string().min(1),
  base_dn: z.string().min(1),
  credential_id: z.number().int().positive().nullable().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  use_ssl: z.boolean().default(true),
  port: z.number().int().positive().default(636),
  enabled: z.boolean().default(true),
  winrm_credential_id: z.number().int().positive().nullable().optional(),
});

export async function GET() {
  return withTenantFromSession(async () => {
    return NextResponse.json(vistaIntegrazioniAd(getAdIntegrations()));
  });
}

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdminOrOnboarding();
    if (auth instanceof NextResponse) return auth;

    try {
    const body = await request.json();
    const parsed = AdIntegrationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Dati non validi", details: parsed.error.issues }, { status: 400 });
    }

    const { name, dc_host, domain, base_dn, use_ssl, port, enabled, winrm_credential_id } = parsed.data;
    const account = accountDalCorpo(parsed.data, true);
    if (!account.ok || !account.account) {
      return NextResponse.json({ error: account.ok ? "Account LDAP mancante" : account.errore }, { status: 400 });
    }
    // WinRM/DHCP dell'AD: solo voci Windows, mai l'account AD (D7 = (a), T13);
    // l'account LDAP: solo una voce Active Directory (T24). I controlli stanno
    // in creaIntegrazioneAd, qui il rifiuto è un 400.
    const integration = creaIntegrazioneAd(
      {
        name,
        dc_host,
        domain,
        base_dn,
        use_ssl: use_ssl ? 1 : 0,
        port,
        enabled: enabled ? 1 : 0,
        winrm_credential_id: winrm_credential_id ?? null,
      },
      account.account,
    );

    // Auto-registra il job ad_sync ricorrente (se l'integrazione è abilitata) così
    // l'AD si risincronizza da solo, senza dover creare il job a mano.
    if (enabled) {
      const tenantCode = await getServerTenantCode();
      ensureAdSyncJob(tenantCode);
    }

    return NextResponse.json(vistaIntegrazioneAd(integration), { status: 201 });
  } catch (err) {
    if (err instanceof VoceNonValePerProtocollo || err instanceof AccountLdapNonValido) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : "Errore sconosciuto";
    if (msg.includes("UNIQUE constraint")) {
      return NextResponse.json({ error: "Integrazione già esistente per questo DC e dominio" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  });
}
