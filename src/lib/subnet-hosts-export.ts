import { joinCsvRow } from "@/lib/csv-utils";
import {
  getNetworkById,
  getNetworkRouterBinding,
  getHostsByNetworkWithDevices,
} from "@/lib/db";
import type { Host } from "@/types";

type HostRow = Host & {
  device_id?: number;
  device?: { id: number; name: string; sysname: string | null; vendor: string; protocol: string };
  ad_dns_host_name?: string | null;
  multihomed?: {
    group_id: string;
    match_type: string;
    peers: Array<{ ip: string; network_name: string; host_id: number }>;
  } | null;
};

/** Intestazioni in italiano, ordine ottimizzato per lettura in Excel (identità → stato → dettagli tecnici → ID). */
export const SUBNET_HOST_CSV_COLUMN_LABELS_IT = [
  "Nome subnet",
  "CIDR subnet",
  "Posizione",
  "VLAN",
  "Gateway subnet",
  "DNS subnet",
  "Descrizione subnet",
  "IP host",
  "MAC",
  "Vendor (MAC)",
  "Hostname",
  "Nome visualizzato",
  "DNS forward",
  "DNS reverse",
  "Classificazione",
  "Codice inventario",
  "Note",
  "Stato monitoraggio",
  "Host conosciuto",
  "Ultimo visto",
  "Primo visto",
  "Tempo risposta (ms)",
  "Porte da monitorare",
  "Origine hostname",
  "Assegnazione IP",
  "Conflitti / flag",
  "Sistema operativo",
  "Modello",
  "Matricola / serial",
  "Firmware",
  "Produttore rilevato",
  "Porte aperte (JSON)",
  "Rilevamento fingerprint (JSON)",
  "Dati SNMP (JSON)",
  "Classificazione forzata manualmente",
  "Nome DNS (Active Directory)",
  "Dispositivo gestito — nome",
  "Dispositivo gestito — sysname",
  "Dispositivo gestito — vendor",
  "Dispositivo gestito — protocollo",
  "Stesso host su più subnet (JSON)",
  "ID subnet",
  "ID host",
  "ID router ARP",
  "Nome router ARP",
  "IP router ARP",
  "ID dispositivo gestito",
  "Subnet creata il",
  "Subnet aggiornata il",
  "Host creato il",
  "Host aggiornato il",
] as const;

function hostField(h: HostRow, key: keyof Host | "classification_manual"): string {
  const raw = (h as unknown as Record<string, unknown>)[key as string];
  if (raw === null || raw === undefined) return "";
  return String(raw);
}

function formatDateTimeIt(s: string | null | undefined): string {
  if (s == null || String(s).trim() === "") return "";
  const raw = String(s).trim();
  const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "medium" });
}

function yesNo01(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "";
  const v = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(v)) return String(n);
  return v === 0 ? "No" : "Sì";
}

function translateStatus(s: string | null | undefined): string {
  if (s == null || s === "") return "";
  const m: Record<string, string> = {
    online: "Online",
    offline: "Offline",
    unknown: "Sconosciuto",
  };
  return m[s] ?? s;
}

function translateIpAssignment(s: string | null | undefined): string {
  if (s == null || s === "") return "";
  const m: Record<string, string> = {
    unknown: "Sconosciuto",
    dynamic: "DHCP / dinamico",
    static: "Statico",
    reserved: "Riservato",
  };
  return m[s] ?? s;
}

function translateHostnameSource(s: string | null | undefined): string {
  if (s == null || s === "") return "";
  const m: Record<string, string> = {
    manual: "Manuale",
    dhcp: "DHCP",
    snmp: "SNMP",
    nmap: "nmap",
    dns: "DNS",
    arp: "ARP",
  };
  return m[s] ?? s;
}

function rowForHost(
  net: NonNullable<ReturnType<typeof getNetworkById>>,
  router: ReturnType<typeof getNetworkRouterBinding>,
  h: HostRow
): string[] {
  return [
    net.name,
    net.cidr,
    net.location ?? "",
    net.vlan_id != null ? String(net.vlan_id) : "",
    net.gateway ?? "",
    net.dns_server ?? "",
    net.description ?? "",
    h.ip,
    h.mac ?? "",
    h.vendor ?? "",
    h.hostname ?? "",
    h.custom_name ?? "",
    h.dns_forward ?? "",
    h.dns_reverse ?? "",
    h.classification ?? "",
    h.inventory_code ?? "",
    h.notes ?? "",
    translateStatus(h.status),
    yesNo01(h.known_host),
    formatDateTimeIt(h.last_seen),
    formatDateTimeIt(h.first_seen),
    h.last_response_time_ms != null ? String(h.last_response_time_ms) : "",
    h.monitor_ports ?? "",
    translateHostnameSource(h.hostname_source),
    translateIpAssignment(h.ip_assignment),
    h.conflict_flags ?? "",
    h.os_info ?? "",
    h.model ?? "",
    h.serial_number ?? "",
    h.firmware ?? "",
    h.device_manufacturer ?? "",
    h.open_ports ?? "",
    h.detection_json ?? "",
    h.snmp_data ?? "",
    yesNo01(hostField(h, "classification_manual")),
    h.ad_dns_host_name ?? "",
    h.device?.name ?? "",
    h.device?.sysname ?? "",
    h.device?.vendor ?? "",
    h.device?.protocol ?? "",
    h.multihomed ? JSON.stringify(h.multihomed) : "",
    String(net.id),
    String(h.id),
    router ? String(router.id) : "",
    router?.name ?? "",
    router?.host ?? "",
    h.device_id != null ? String(h.device_id) : "",
    formatDateTimeIt(net.created_at),
    formatDateTimeIt(net.updated_at),
    formatDateTimeIt(h.created_at),
    formatDateTimeIt(h.updated_at),
  ];
}

function emptyHostRow(
  net: NonNullable<ReturnType<typeof getNetworkById>>,
  router: ReturnType<typeof getNetworkRouterBinding>
): string[] {
  const head: string[] = [
    net.name,
    net.cidr,
    net.location ?? "",
    net.vlan_id != null ? String(net.vlan_id) : "",
    net.gateway ?? "",
    net.dns_server ?? "",
    net.description ?? "",
  ];
  const middleEmpty = 34;
  const tail: string[] = [
    String(net.id),
    "",
    router ? String(router.id) : "",
    router?.name ?? "",
    router?.host ?? "",
    "",
    formatDateTimeIt(net.created_at),
    formatDateTimeIt(net.updated_at),
    "",
    "",
  ];
  return [...head, ...Array(middleEmpty).fill("") as string[], ...tail];
}

/**
 * CSV UTF-8 con BOM, separatore `;` (Excel con impostazioni italiane).
 * Una riga per host; subnet senza host generano una riga con colonne host vuote.
 * Non include snmp_community della subnet (dato sensibile).
 */
export function buildSubnetHostsExportCsv(networkIds: number[]): {
  csv: string;
  skippedNetworkIds: number[];
  rowCount: number;
} {
  const unique = [...new Set(networkIds)].filter((id) => Number.isFinite(id) && id > 0);
  const skippedNetworkIds: number[] = [];
  const lines: string[] = [];

  lines.push(joinCsvRow([...SUBNET_HOST_CSV_COLUMN_LABELS_IT]));

  let rowCount = 0;
  for (const nid of unique) {
    const net = getNetworkById(nid);
    if (!net) {
      skippedNetworkIds.push(nid);
      continue;
    }
    const router = getNetworkRouterBinding(nid);
    const hosts = getHostsByNetworkWithDevices(nid) as HostRow[];
    if (hosts.length === 0) {
      lines.push(joinCsvRow(emptyHostRow(net, router)));
      rowCount += 1;
      continue;
    }
    for (const h of hosts) {
      lines.push(joinCsvRow(rowForHost(net, router, h)));
      rowCount += 1;
    }
  }

  return {
    csv: "\uFEFF" + lines.join("\n"),
    skippedNetworkIds,
    rowCount,
  };
}
