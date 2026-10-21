/**
 * Dipendenze e Active Directory di un host per la scheda dei server Windows e Linux (21/10).
 *
 * - `dipendenzeDelHost`: host → `inventory_assets` (per `host_id` o per l'apparato dello stesso host) →
 *   `service_asset_dependencies` → `services`. Un host senza asset non è un errore: `servizi: []`.
 * - `adDelHost`: il computer in `ad_computers` e, SOLO se il server è domain controller, i rilievi dell'ultimo
 *   controllo AD riuscito. `rilievi: null` = non so (non è DC, o nessun controllo); `[]` = controllato e pulito.
 *
 * Sola lettura. `null` = host inesistente (la rotta risponde 404).
 */
import { getDb, getHostById } from "@/lib/db";
import { ruoliDaJson } from "@/lib/classification/canonico";

export interface ServizioDipendente { id: number; nome: string; criticita: string | null; tipo: "primario" | "secondario" | "supporto" }
export interface RispostaDipendenze { servizi: ServizioDipendente[] }

export interface ComputerAd { ou: string; os: string | null; ultimo_logon: string | null; abilitato: boolean }
export interface RispostaAd {
  computer: ComputerAd | null;
  /** Solo per un domain controller con almeno un controllo riuscito. */
  rilievi: Array<{ gravita: string; titolo: string }> | null;
  /** Il server è un domain controller (ruolo, OU «Domain Controllers» o scansione). */
  dc: boolean;
  /** Quando è stato fatto il controllo da cui vengono i rilievi (ISO). */
  controllo: string | null;
}

const FORZA: Record<string, number> = { primario: 0, secondario: 1, supporto: 2 };
const CRITICITA: Record<string, number> = { critica: 0, alta: 1, media: 2, bassa: 3 };

export function dipendenzeDelHost(hostId: number): RispostaDipendenze | null {
  if (!getHostById(hostId)) return null;
  const righe = getDb()
    .prepare(
      `SELECT s.id, s.name, s.criticita_servizio, d.dependency_type
         FROM service_asset_dependencies d
         JOIN services s ON s.id = d.service_id
         JOIN inventory_assets a ON a.id = d.asset_id
        WHERE s.stato <> 'dismesso'
          AND (a.host_id = ? OR a.network_device_id IN (SELECT id FROM network_devices WHERE host_id = ?))`,
    )
    .all(hostId, hostId) as Array<{ id: number; name: string; criticita_servizio: string | null; dependency_type: string }>;

  const perServizio = new Map<number, ServizioDipendente>();
  for (const r of righe) {
    const tipo = (r.dependency_type in FORZA ? r.dependency_type : "supporto") as ServizioDipendente["tipo"];
    const att = perServizio.get(r.id);
    // Lo stesso servizio può poggiare su più asset dell'host: vale la dipendenza più forte.
    if (!att || FORZA[tipo] < FORZA[att.tipo]) perServizio.set(r.id, { id: r.id, nome: r.name, criticita: r.criticita_servizio, tipo });
  }
  return {
    servizi: [...perServizio.values()].sort(
      (a, b) => (CRITICITA[a.criticita ?? ""] ?? 4) - (CRITICITA[b.criticita ?? ""] ?? 4) || FORZA[a.tipo] - FORZA[b.tipo] || a.nome.localeCompare(b.nome, "it"),
    ),
  };
}

/** «CN=X,OU=Servers,OU=Sede,DC=…» → «Sede/Servers» (dalla radice alla foglia). */
function ouDaDn(dn: string): string {
  const ou = [...dn.matchAll(/(?:^|,)OU=((?:\\,|[^,])+)/gi)].map((m) => m[1].replace(/\\,/g, ","));
  return ou.reverse().join("/");
}

function tabellaEsiste(nome: string): boolean {
  return !!getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(nome);
}

interface RigaComputer { integration_id: number; ou: string | null; distinguished_name: string; operating_system: string | null; last_logon_at: string | null; enabled: number }

export function adDelHost(hostId: number): RispostaAd | null {
  const host = getHostById(hostId);
  if (!host) return null;
  const db = getDb();

  const c = db
    .prepare(
      `SELECT integration_id, ou, distinguished_name, operating_system, last_logon_at, enabled
         FROM ad_computers WHERE host_id = ? ORDER BY synced_at DESC, id DESC LIMIT 1`,
    )
    .get(hostId) as RigaComputer | undefined;
  const computer: ComputerAd | null = c
    ? { ou: c.ou && c.ou.trim() !== "" ? c.ou : ouDaDn(c.distinguished_name), os: c.operating_system, ultimo_logon: c.last_logon_at, abilitato: c.enabled === 1 }
    : null;

  // DC: dal ruolo dichiarato, dalla scansione o dall'OU in cui sta il computer.
  const dev = db.prepare("SELECT server_roles, last_device_info_json FROM network_devices WHERE host_id = ? ORDER BY id LIMIT 1").get(hostId) as
    | { server_roles: string | null; last_device_info_json: string | null } | undefined;
  let daScansione = false;
  try { daScansione = !!dev?.last_device_info_json && (JSON.parse(dev.last_device_info_json) as { is_domain_controller?: boolean }).is_domain_controller === true; } catch { /* JSON rotto: non è un'indicazione */ }
  const dc = ruoliDaJson(dev?.server_roles).includes("dc") || daScansione || /(^|\/)domain controllers$/i.test(computer?.ou ?? "");

  let rilievi: RispostaAd["rilievi"] = null;
  let controllo: string | null = null;
  if (dc && tabellaEsiste("ad_health_runs") && tabellaEsiste("ad_health_findings")) {
    // L'integrazione è quella da cui viene il computer, altrimenti quella il cui DC è questo IP.
    const integrationId = c?.integration_id
      ?? (db.prepare("SELECT id FROM ad_integrations WHERE dc_host = ? OR lower(dc_host) = lower(?) ORDER BY id LIMIT 1").get(host.ip, host.hostname ?? "") as { id: number } | undefined)?.id;
    if (integrationId != null) {
      const run = db
        .prepare("SELECT id, started_at FROM ad_health_runs WHERE integration_id = ? AND status = 'ok' ORDER BY started_at DESC, id DESC LIMIT 1")
        .get(integrationId) as { id: number; started_at: string } | undefined;
      if (run) {
        controllo = run.started_at;
        // «DA-A-DomainScore» è l'indicatore di rischio del dominio, non un rilievo (il catalogo lo scarta allo stesso modo).
        rilievi = (db.prepare("SELECT severity, title FROM ad_health_findings WHERE run_id = ? AND rule_id <> 'DA-A-DomainScore' ORDER BY id").all(run.id) as Array<{ severity: string; title: string }>)
          .map((f) => ({ gravita: f.severity, titolo: f.title }));
      }
    }
  }
  return { computer, rilievi, dc, controllo };
}
