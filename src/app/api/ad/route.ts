import { NextResponse } from "next/server";
import { requireAdminOrOnboarding } from "@/lib/api-auth";
import { withTenantFromSession, getServerTenantCode } from "@/lib/api-tenant";
import { getTenantDb } from "@/lib/db-tenant";
import { reloadTenantScheduler } from "@/lib/cron/scheduler";
import { getAdIntegrations } from "@/lib/db";
import { creaIntegrazioneAd, VoceNonValePerProtocollo } from "@/lib/credentials/lega-voce";
import { accountDalCorpo } from "@/lib/ad/account-ldap";
import { SegretiNonSalvati } from "@/lib/credentials/archivio";
import { AccountLdapNonValido, vistaIntegrazioneAd, vistaIntegrazioniAd } from "@/lib/ad/credenziale-ldap";
import { z } from "zod/v4";

/** Intervallo di default per il job ad_sync (minuti). 6h: l'AD cambia lentamente
 *  e la dashboard-health considera "stale" oltre 2× questo intervallo. */
const AD_SYNC_INTERVAL_MIN = 360;

/**
 * Garantisce un job ricorrente `ad_sync` (network_id NULL = tutte le integrazioni
 * AD abilitate del tenant) e ricarica lo scheduler in-memory.
 *
 * Storicamente il job NON veniva mai auto-creato all'attivazione di un'integrazione
 * AD (a differenza di wazuh_sync/vuln_sync): l'AD restava non sincronizzato finché
 * qualcuno non creava il job a mano da Settings → Job schedulati. Qui replichiamo
 * il pattern di `wazuh/config` così ogni integrazione AD abilitata ottiene il suo
 * sync ricorrente.
 */
function ensureAdSyncJob(tenantCode: string): void {
  const db = getTenantDb(tenantCode);
  const existing = db
    .prepare("SELECT id FROM scheduled_jobs WHERE job_type = 'ad_sync' AND network_id IS NULL")
    .get() as { id: number } | undefined;
  if (existing) {
    db.prepare(
      "UPDATE scheduled_jobs SET enabled = 1, updated_at = datetime('now') WHERE id = ?",
    ).run(existing.id);
  } else {
    db.prepare(
      `INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, config)
       VALUES (NULL, 'ad_sync', ?, 1, '{}')`,
    ).run(AD_SYNC_INTERVAL_MIN);
  }
  reloadTenantScheduler(tenantCode);
}

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
    if (err instanceof SegretiNonSalvati) return NextResponse.json({ error: err.message }, { status: 503 });
    const msg = err instanceof Error ? err.message : "Errore sconosciuto";
    if (msg.includes("UNIQUE constraint")) {
      return NextResponse.json({ error: "Integrazione già esistente per questo DC e dominio" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  });
}
