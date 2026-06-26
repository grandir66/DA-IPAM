import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { getModulesHealth, invalidateModulesHealth } from "@/lib/modules/health";
import type { ModuleRepairAction } from "@/lib/modules/health";
import type { ModuleKey } from "@/lib/modules/registry";

const VALID_KEYS: ModuleKey[] = [
  "edge",
  "librenms",
  "wazuh",
  "graylog",
  "patch_management",
  "network_services",
];

/** Deep-link alla pagina di configurazione del modulo (per la UI "Ripara"). */
function configHrefFor(key: ModuleKey): string | null {
  switch (key) {
    case "wazuh": return "/settings?tab=moduli#module-wazuh";
    case "librenms": return "/settings?tab=moduli#module-librenms";
    case "graylog": return "/settings?tab=moduli#module-graylog";
    case "edge": return "/settings?tab=moduli#module-edge";
    case "network_services": return "/network-services";
    default: return null;
  }
}

/** Suggerimento testuale azionabile per ciascuna repairAction. */
function fixHintFor(action: ModuleRepairAction): string {
  switch (action) {
    case "reconfigure_wazuh":
      return "Verifica URL/credenziali Wazuh (manager :55000 + indexer :9200). La porta 9200 è raggiungibile solo dall'IP di DA-IPAM (firewall).";
    case "check_edge_cert":
      return "Il certificato dell'edge è cambiato: ri-esegui il Test connessione per accettare il nuovo pin (TOFU).";
    case "reconfigure_edge":
      return "Verifica base_url + token dello Scanner-Edge e la raggiungibilità del servizio.";
    case "reconfigure_librenms":
      return "Verifica URL + API token LibreNMS.";
    case "reconfigure_graylog":
      return "Verifica URL Graylog (API raggiungibile su /api/).";
    case "reconfigure_net_services":
      return "Verifica apiUrl + token del bridge Network-Services (:8443).";
    default:
      return "Nessuna azione automatica disponibile — controlla la configurazione del modulo.";
  }
}

/**
 * POST /api/modules/[key]/repair
 * Repair "thin": ri-legge la config, ri-testa LIVE il modulo e ritorna l'esito
 * con una guida azionabile (fix testuale + deep-link alla config). NON orchestra
 * restart di servizi (quello è dell'installer da-appliance), ma dà all'operatore
 * il verdetto aggiornato e dove intervenire.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  return withTenantFromSession(async () => {
    const authErr = await requireAdmin();
    if (isAuthError(authErr)) return authErr;

    const { key: rawKey } = await params;
    if (!VALID_KEYS.includes(rawKey as ModuleKey)) {
      return NextResponse.json({ ok: false, error: `Modulo sconosciuto: ${rawKey}` }, { status: 400 });
    }
    const key = rawKey as ModuleKey;

    const tenantCode = getCurrentTenantCode() ?? "DEFAULT";
    invalidateModulesHealth(tenantCode);
    const [health] = await getModulesHealth(tenantCode, { force: true, only: key });

    if (!health) {
      return NextResponse.json({ ok: false, error: "Modulo non trovato nello stato health" }, { status: 404 });
    }

    return NextResponse.json({
      ok: health.verdict === "ok",
      key,
      verdict: health.verdict,
      reachable: health.reachable,
      authOk: health.authOk,
      detail: health.detail,
      fix: health.verdict === "ok" ? null : fixHintFor(health.repairAction),
      configHref: health.verdict === "ok" ? null : configHrefFor(key),
    });
  });
}
