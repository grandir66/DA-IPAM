/**
 * L'elenco unico della pagina «Apparati» di DatIA Mon (Riccardo, 13/11/2026: «gestire in modo accorpato i
 * device, il template o i template associati, e per Windows e Linux la modalità di installazione dell'agente»).
 *
 * Mette insieme gli apparati che il centro ha già in Zabbix (con modelli, stato e agente) e quelli che DA-IPAM
 * conosce e Zabbix no. «Già in Zabbix» si decide come fa il centro prima di aggiungere: stesso IP, un altro IP
 * dello stesso apparato fisico, o lo stesso nome. Pura: la rotta le passa le righe di DA-IPAM.
 */
import type { HostDelCentro, OggettoDiFamiglia, ProblemaDelCentro } from "./api";
import { statoOggetto, type StatoOggetto } from "@/lib/cliente/monitoring";

export type StatoApparato = StatoOggetto | "da_aggiungere";
export type StatoAgente = "si" | "no" | "non_so" | "non_serve" | "da_installare";

export interface ApparatoElenco {
  /** `z:<hostid>` per quelli in Zabbix, `i:<id>` per quelli solo in DA-IPAM. */
  chiave: string;
  hostid: string | null;
  hostIdIpam: number | null;
  nome: string;
  /** Il nome tecnico in Zabbix: è quello che l'agente deve dichiarare. null per chi non è in Zabbix. */
  hostTecnico: string | null;
  ip: string | null;
  famiglia: string;
  stato: StatoApparato;
  motivo: string | null;
  modelli: string[];
  agente: StatoAgente;
  /** Per l'agente: che sistema è, se si sa. */
  sistema: "windows" | "linux" | null;
}

export interface RigaIpam {
  id: number;
  ip: string;
  nome: string;
  classificazione: string | null;
  /** Gli altri IP dello stesso apparato fisico, separati da virgola. */
  altri: string | null;
}

/** La famiglia di un apparato di DA-IPAM, dalla sua classificazione (stessi nomi delle famiglie del centro). */
export function famigliaDaClassificazione(c: string | null): string {
  const v = (c ?? "").toLowerCase();
  if (v.includes("windows")) return "windows";
  if (["server_linux", "server", "linux", "dhcp_server", "dns_server", "nfs_server", "mail_server", "web_server",
    "database_server", "backup_server"].includes(v)) return "linux";
  if (v === "vm") return "vm";
  if (v === "firewall" || v === "vpn_gateway") return "firewall";
  if (["switch", "bridge", "rete_ot"].includes(v)) return "switch";
  if (["router", "modem", "ont", "load_balancer"].includes(v)) return "router";
  if (["access_point", "controller_wifi", "network_controller", "repeater"].includes(v)) return "wifi";
  if (v.startsWith("nas") || v === "storage") return "storage";
  if (v === "ups" || v === "pdu") return "ups";
  if (v === "hypervisor") return "virtualizzazione";
  if (v === "centralino" || v === "gateway_voip") return "centralino";
  if (v === "telecamera" || v === "nvr") return "videosorveglianza";
  return "altro";
}

function sistemaDi(famiglia: string, modelli: readonly string[]): "windows" | "linux" | null {
  if (famiglia === "windows" || modelli.some((m) => /^windows /i.test(m))) return "windows";
  if (famiglia === "linux" || modelli.some((m) => /^linux /i.test(m))) return "linux";
  return null;
}

export function elencoApparati(i: {
  host: readonly HostDelCentro[];
  famiglie: readonly OggettoDiFamiglia[];
  problemi: readonly ProblemaDelCentro[];
  vecchio: boolean;
  ipam: readonly RigaIpam[];
}): ApparatoElenco[] {
  const ipDi = new Map(i.host.map((h) => [h.hostid, h.ip]));
  const tecnicoDi = new Map(i.host.map((h) => [h.hostid, h.host]));
  const problemiDi = new Map<string, ProblemaDelCentro[]>();
  for (const p of i.problemi) problemiDi.set(p.hostid, [...(problemiDi.get(p.hostid) ?? []), p]);
  // Le righe ricavate (VM del Proxmox, dominio, database, datastore) non sono host di Zabbix:
  // qui non hanno modelli né agente da gestire.
  const elenco: ApparatoElenco[] = i.famiglie.filter((o) => !o.derivata).map((o) => {
    const { stato, motivo } = statoOggetto(o, problemiDi.get(o.hostid) ?? [], i.vecchio);
    return {
      chiave: `z:${o.hostid}`,
      hostid: o.hostid,
      hostIdIpam: null,
      nome: o.nome,
      hostTecnico: tecnicoDi.get(o.hostid) || null,
      ip: ipDi.get(o.hostid)?.[0] ?? null,
      famiglia: o.famiglia,
      stato,
      motivo,
      modelli: o.modelli,
      agente: o.agente,
      sistema: sistemaDi(o.famiglia, o.modelli),
    };
  });
  const ipZbx = new Set(i.host.flatMap((h) => h.ip));
  const nomiZbx = new Set(i.host.flatMap((h) => [h.nome.toLowerCase(), h.host.toLowerCase()]));
  for (const r of i.ipam) {
    const altri = (r.altri ?? "").split(",").filter(Boolean);
    if (ipZbx.has(r.ip) || altri.some((x) => ipZbx.has(x)) || nomiZbx.has(r.nome.toLowerCase())) continue;
    const famiglia = famigliaDaClassificazione(r.classificazione);
    const sistema = sistemaDi(famiglia, []);
    elenco.push({
      chiave: `i:${r.id}`,
      hostid: null,
      hostIdIpam: r.id,
      nome: r.nome,
      hostTecnico: null,
      ip: r.ip,
      famiglia,
      stato: "da_aggiungere",
      motivo: null,
      modelli: [],
      agente: sistema ? "da_installare" : "non_serve",
      sistema,
    });
  }
  return elenco;
}
