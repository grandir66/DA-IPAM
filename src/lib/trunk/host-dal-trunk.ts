/**
 * Host e MAC delle reti dal sensore trunk (27/10/2026, mini PC dimostrativo 72729-ipam).
 *
 * Nelle reti con tag l'appliance non è sullo stesso segmento e spesso non c'è un router che dia
 * la tabella ARP: gli host restavano senza MAC (nella nativa li vede da sola). Le osservazioni
 * del trunk finivano solo in `mac_ip_mapping`. Qui, per ogni rete con `vlan_id`, le osservazioni
 * dello stesso VID con un IP della rete diventano host (se mancano) o completano il MAC (se manca).
 * Una rete senza VLAN prende le osservazioni senza tag (VID 0, la nativa del trunk): sulla VM 999
 * la nativa aveva 42 host e nessun MAC, con 43 osservazioni senza tag. Un MAC già presente non si
 * tocca: quello del router o dello scan resta la fonte.
 */
import { getCurrentTenantCode, getTenantDb, upsertHost } from "@/lib/db-tenant";
import { isIpInCidr, normalizeMacForStorage } from "@/lib/utils";
import { lookupVendorSync } from "@/lib/scanner/mac-vendor";

/** Come i rilievi: si porta solo ciò che si è visto di recente (la tabella tiene settimane). */
const FINESTRA_GIORNI = 30;
const ONLINE_ORE = 24;

export interface EsitoHostDalTrunk {
  creati: number;
  mac: number;
}

export function portaHostDalTrunk(opz: { networkId?: number; adesso?: Date } = {}): EsitoHostDalTrunk {
  const d = getTenantDb(getCurrentTenantCode() ?? "DEFAULT");
  const adesso = (opz.adesso ?? new Date()).getTime();
  const reti = d.prepare(
    `SELECT id, cidr, COALESCE(vlan_id, 0) AS vlan_id FROM networks${opz.networkId != null ? " WHERE id = ?" : ""}`,
  ).all(...(opz.networkId != null ? [opz.networkId] : [])) as Array<{ id: number; cidr: string; vlan_id: number }>;
  const osservazioni = d.prepare(
    "SELECT mac_display AS mac, ip, nome, ultima_vista FROM trunk_osservazioni WHERE vid = ? AND ip != '' ORDER BY ultima_vista DESC",
  );
  const host = d.prepare("SELECT id, mac, vendor, hostname FROM hosts WHERE network_id = ? AND ip = ?");
  const completa = d.prepare(`
    UPDATE hosts SET mac = ?, vendor = COALESCE(NULLIF(vendor, ''), ?),
      hostname = COALESCE(NULLIF(hostname, ''), ?),
      hostname_source = CASE WHEN COALESCE(hostname, '') = '' AND ? IS NOT NULL THEN 'arp' ELSE hostname_source END,
      updated_at = datetime('now')
    WHERE id = ?`);
  const esito: EsitoHostDalTrunk = { creati: 0, mac: 0 };
  for (const rete of reti) {
    const visti = new Set<string>();
    for (const o of osservazioni.all(rete.vlan_id) as Array<{ mac: string; ip: string; nome: string | null; ultima_vista: string }>) {
      if (visti.has(o.ip) || !isIpInCidr(o.ip, rete.cidr)) continue;
      visti.add(o.ip);   // la più recente per IP
      const vista = Date.parse(o.ultima_vista.endsWith("Z") ? o.ultima_vista : `${o.ultima_vista}Z`);
      if (!Number.isFinite(vista) || adesso - vista > FINESTRA_GIORNI * 86_400_000) continue;
      const mac = normalizeMacForStorage(o.mac);
      if (!mac) continue;
      const vendor = lookupVendorSync(mac);
      const c = host.get(rete.id, o.ip) as { id: number; mac: string | null } | undefined;
      if (c) {
        if (c.mac) continue;
        completa.run(mac, vendor, o.nome, o.nome, c.id);
        esito.mac++;
        continue;
      }
      const nuovo = upsertHost({
        network_id: rete.id, ip: o.ip, mac, vendor: vendor ?? undefined,
        hostname: o.nome ?? undefined, hostname_source: o.nome ? "arp" : undefined,
        status: adesso - vista <= ONLINE_ORE * 3_600_000 ? "online" : undefined,
      });
      if (nuovo) esito.creati++;
    }
  }
  return esito;
}
