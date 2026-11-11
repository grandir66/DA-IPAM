import type Database from "better-sqlite3";
import { CATEGORY_TAXONOMY } from "@/lib/attribution/taxonomy";
import { parseDbDate } from "@/lib/db-date";
import { ePortaFisica, etichettaVelocita, numeroPorta, type PortaSwitch } from "@/lib/scheda/porte-da-guardare";
import { condizioneAssente } from "@/lib/hosts/assenti";
import { ipNumero } from "@/lib/trunk/reti";
import { nomeCategoria } from "../categorie";
import { nelCliente, type ContestoCliente } from "../contesto";
import { daQuanto, sistemaPulito } from "../testi";
import type { RiquadroCliente, SchedaCliente, VoceAttenzione } from "../registro";

export type TipoCliente = "computer" | "server" | "virtuali" | "rete" | "stampanti" | "telefoni" | "mobili" | "altro" | "non_riconosciuti";

export const TIPI_CLIENTE: ReadonlyArray<{ tipo: TipoCliente; titolo: string; icona: string }> = [
  { tipo: "computer", titolo: "Computer", icona: "Monitor" },
  { tipo: "server", titolo: "Server", icona: "Server" },
  { tipo: "virtuali", titolo: "Macchine virtuali", icona: "Boxes" },
  { tipo: "rete", titolo: "Rete", icona: "Network" },
  { tipo: "stampanti", titolo: "Stampanti", icona: "Printer" },
  { tipo: "telefoni", titolo: "Telefoni", icona: "Phone" },
  { tipo: "mobili", titolo: "Cellulari e tablet", icona: "Smartphone" },
  { tipo: "altro", titolo: "Telecamere e altro", icona: "Camera" },
  { tipo: "non_riconosciuti", titolo: "Non riconosciuti", icona: "CircleHelp" },
];

const RADICE: Record<string, TipoCliente> = {
  compute: "server",
  storage: "server",
  network: "rete",
  peripheral: "stampanti",
  voip: "telefoni",
  mobile: "mobili",
  av: "altro",
  iot: "altro",
  ot: "altro",
  power: "altro",
};

/** compute.workstation e compute.laptop sono computer; compute.vm è una macchina virtuale; il resto segue la radice. */
export function tipoCliente(categoria: string | null): TipoCliente {
  if (!categoria) return "non_riconosciuti";
  if (categoria === "compute.workstation" || categoria === "compute.laptop") return "computer";
  if (categoria === "compute.vm") return "virtuali";
  const radice = categoria.split(".")[0] ?? "";
  return RADICE[radice] ?? "non_riconosciuti";
}

export interface RigaApparato {
  ip: string;
  nome: string;
  cosa: string;
  /** Categoria e produttore, senza il sistema operativo. */
  cosaBreve: string;
  acceso: boolean;
  /** Spento da più di 7 giorni, o spento senza una data. */
  assente: boolean;
  vistoIl: string | null;
  haPorte: boolean;
}

export interface PortaCliente {
  numero: number;
  nome: string;
  stato: "collegata" | "libera";
  dorsale: boolean;
  velocita: string | null;
  vlan: number | null;
  attaccato: { nome: string; ip: string | null } | null;
  verso: string | null;
}

interface RigaHost {
  id: number;
  ip: string;
  status: string | null;
  custom_name: string | null;
  hostname: string | null;
  last_seen: string | null;
  attr_category: string | null;
  attr_vendor_name: string | null;
  attr_os_name: string | null;
  device_manufacturer: string | null;
  vendor: string | null;
  os_info: string | null;
  physical_device_id: number | null;
  assente: number;
  spento_lungo: number;
}

interface RigaPorta {
  id: number;
  device_id: number;
  port_index: number;
  port_name: string;
  status: string | null;
  speed: string | null;
  vlan: number | null;
  is_trunk: number | null;
  is_uplink: number | null;
  host_id: number | null;
  single_mac_hostname: string | null;
  single_mac_ip: string | null;
  trunk_neighbor_name: string | null;
  trunk_primary_name: string | null;
}

const HOST = `h.id, h.ip, h.status, h.custom_name, h.hostname, h.last_seen, h.attr_category,
  h.attr_vendor_name, h.attr_os_name, h.device_manufacturer, h.vendor, h.os_info, h.physical_device_id,
  CASE WHEN ${condizioneAssente("h")} THEN 1 ELSE 0 END AS assente,
  CASE WHEN h.status = 'offline' AND h.last_seen IS NOT NULL
    AND datetime(h.last_seen) < datetime('now', '-1 day')
    AND NOT (${condizioneAssente("h")})
    THEN 1 ELSE 0 END AS spento_lungo`;

function testo(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function inizialeMaiuscola(s: string): string {
  return s.charAt(0).toLocaleUpperCase("it-IT") + s.slice(1);
}

function pezziDi(host: RigaHost, conSistema: boolean): string[] {
  const pezzi: string[] = [];
  const categoria = nomeCategoria(testo(host.attr_category));
  if (categoria) pezzi.push(inizialeMaiuscola(categoria));
  const produttore = testo(host.attr_vendor_name) ?? testo(host.device_manufacturer) ?? testo(host.vendor);
  if (produttore) pezzi.push(produttore);
  if (conSistema) {
    const sistema = sistemaPulito(testo(host.attr_os_name)) ?? sistemaPulito(testo(host.os_info));
    if (sistema) pezzi.push(sistema);
  }
  return pezzi;
}

function cosaDi(host: RigaHost): string {
  const pezzi = pezziDi(host, true);
  return pezzi.length > 0 ? pezzi.join(" · ") : "Non riconosciuto";
}

function cosaBreveDi(host: RigaHost): string {
  const pezzi = pezziDi(host, false);
  return pezzi.length > 0 ? pezzi.join(" · ") : "Non riconosciuto";
}

function nomeDi(host: RigaHost): string {
  return testo(host.custom_name) ?? testo(host.hostname) ?? host.ip;
}

/** Stesso apparato fisico: resta l'indirizzo più basso. Senza cluster, ogni host conta. */
function unici(hosts: RigaHost[]): RigaHost[] {
  const perCluster = new Map<number, RigaHost>();
  const sciolti: RigaHost[] = [];
  for (const host of hosts) {
    if (host.physical_device_id == null) {
      sciolti.push(host);
      continue;
    }
    const gia = perCluster.get(host.physical_device_id);
    if (!gia || ipNumero(host.ip) < ipNumero(gia.ip)) perCluster.set(host.physical_device_id, host);
  }
  return [...sciolti, ...perCluster.values()];
}

function hostsTutti(db: Database.Database): RigaHost[] {
  return unici(db.prepare(`SELECT ${HOST} FROM hosts h`).all() as RigaHost[]);
}

const TIPI_CON_PORTE = "('switch', 'router')";

function ipConPorte(db: Database.Database): Set<string> {
  const righe = db.prepare(`
    SELECT DISTINCT nd.host AS ip
    FROM network_devices nd
    WHERE nd.device_type IN ${TIPI_CON_PORTE}
      AND EXISTS (SELECT 1 FROM switch_ports sp WHERE sp.device_id = nd.id)
  `).all() as Array<{ ip: string }>;
  return new Set(righe.map((r) => r.ip));
}

function rigaDi(host: RigaHost, conPorte: Set<string>): RigaApparato {
  return {
    ip: host.ip,
    nome: nomeDi(host),
    cosa: cosaDi(host),
    cosaBreve: cosaBreveDi(host),
    acceso: host.status === "online",
    assente: host.assente === 1,
    vistoIl: testo(host.last_seen),
    haPorte: conPorte.has(host.ip),
  };
}

function ordina(a: RigaApparato, b: RigaApparato): number {
  if (a.acceso !== b.acceso) return a.acceso ? -1 : 1;
  if (a.assente !== b.assente) return a.assente ? 1 : -1;
  return a.nome.localeCompare(b.nome, "it");
}

export function conteggiPerTipo(db: Database.Database): Record<TipoCliente, number> {
  const conteggi = Object.fromEntries(TIPI_CLIENTE.map((t) => [t.tipo, 0])) as Record<TipoCliente, number>;
  for (const host of hostsTutti(db)) conteggi[tipoCliente(testo(host.attr_category))] += 1;
  return conteggi;
}

/** Accesi, poi spenti, poi assenti; dentro ogni gruppo per nome. Al più 500. */
export function apparatiDelTipo(db: Database.Database, tipo: TipoCliente): RigaApparato[] {
  const conPorte = ipConPorte(db);
  return hostsTutti(db)
    .filter((h) => tipoCliente(testo(h.attr_category)) === tipo)
    .map((h) => rigaDi(h, conPorte))
    .sort(ordina)
    .slice(0, 500);
}

function comePorta(r: RigaPorta): PortaSwitch {
  const status = r.status === "up" || r.status === "down" || r.status === "disabled" ? r.status : null;
  return {
    id: r.id,
    port_index: r.port_index,
    port_name: r.port_name,
    status,
    speed: r.speed,
    duplex: null,
    vlan: r.vlan,
    poe_status: null,
    poe_power_mw: null,
    mac_count: 0,
    is_trunk: r.is_trunk ?? 0,
    stp_state: null,
  };
}

function nomiAttaccati(db: Database.Database, porte: RigaPorta[]): Map<number, { nome: string; ip: string }> {
  const ids = [...new Set(porte.map((p) => p.host_id).filter((id): id is number => id != null))];
  const mappa = new Map<number, { nome: string; ip: string }>();
  if (ids.length === 0) return mappa;
  const righe = db.prepare(
    `SELECT id, ip, custom_name, hostname FROM hosts WHERE id IN (${ids.map(() => "?").join(",")})`,
  ).all(...ids) as Array<{ id: number; ip: string; custom_name: string | null; hostname: string | null }>;
  for (const host of righe) {
    mappa.set(host.id, { nome: testo(host.custom_name) ?? testo(host.hostname) ?? host.ip, ip: host.ip });
  }
  return mappa;
}

function attaccatoDi(porta: RigaPorta, nomi: Map<number, { nome: string; ip: string }>): PortaCliente["attaccato"] {
  if (porta.host_id != null) {
    const host = nomi.get(porta.host_id);
    if (host) return host;
  }
  const nome = testo(porta.single_mac_hostname) ?? testo(porta.single_mac_ip);
  if (!nome) return null;
  return { nome, ip: testo(porta.single_mac_ip) };
}

/** null se per quell'indirizzo non c'è nessuna porta letta. */
export function porteDelloSwitch(db: Database.Database, ip: string): PortaCliente[] | null {
  const porte = db.prepare(`
    SELECT sp.id, sp.device_id, sp.port_index, sp.port_name, sp.status, sp.speed, sp.vlan,
      sp.is_trunk, sp.is_uplink, sp.host_id, sp.single_mac_hostname, sp.single_mac_ip,
      sp.trunk_neighbor_name, sp.trunk_primary_name
    FROM switch_ports sp
    JOIN network_devices nd ON nd.id = sp.device_id
    WHERE nd.host = ? AND nd.device_type IN ${TIPI_CON_PORTE}
  `).all(ip) as RigaPorta[];
  if (porte.length === 0) return null;
  return inPorteCliente(porte, nomiAttaccati(db, porte));
}

function inPorteCliente(porte: RigaPorta[], nomi: Map<number, { nome: string; ip: string }>): PortaCliente[] {
  return porte
    .filter((p) => ePortaFisica(comePorta(p)))
    .map((p) => {
      const dorsale = p.is_trunk === 1 || p.is_uplink === 1;
      return {
        numero: numeroPorta(comePorta(p)),
        nome: p.port_name,
        stato: p.status === "up" ? "collegata" as const : "libera" as const,
        dorsale,
        velocita: etichettaVelocita(p.speed),
        vlan: p.vlan,
        attaccato: dorsale ? null : attaccatoDi(p, nomi),
        verso: dorsale ? testo(p.trunk_neighbor_name) ?? testo(p.trunk_primary_name) : null,
      };
    })
    .sort((a, b) => a.numero - b.numero || a.nome.localeCompare(b.nome, "it"));
}

export interface ApparatoConPorte {
  ip: string;
  nome: string;
  porte: PortaCliente[];
  libere: number;
}

/**
 * Gli apparati di rete con le porte lette, ognuno con le sue porte (Riccardo, 11/11/2026: «un box in alto con un link
 * agli apparati di rete che hanno memorizzato uno schema delle porte, per vedere rapidamente che porte sono
 * disponibili, un po' come gli IP nelle network»). Una query per le porte e una per i nomi, non una per apparato.
 * «Libera» è la stessa della pagina Apparati: la porta non è collegata all'ultima lettura.
 */
export function apparatiConPorte(db: Database.Database): ApparatoConPorte[] {
  const righe = db.prepare(`
    SELECT sp.id, sp.device_id, sp.port_index, sp.port_name, sp.status, sp.speed, sp.vlan,
      sp.is_trunk, sp.is_uplink, sp.host_id, sp.single_mac_hostname, sp.single_mac_ip,
      sp.trunk_neighbor_name, sp.trunk_primary_name, nd.host AS ip_apparato, nd.name AS nome_apparato
    FROM switch_ports sp
    JOIN network_devices nd ON nd.id = sp.device_id
    WHERE nd.device_type IN ${TIPI_CON_PORTE}
  `).all() as Array<RigaPorta & { ip_apparato: string; nome_apparato: string }>;
  const nomi = nomiAttaccati(db, righe);
  const perApparato = new Map<number, { ip: string; nome: string; righe: RigaPorta[] }>();
  for (const r of righe) {
    const a = perApparato.get(r.device_id) ?? { ip: r.ip_apparato, nome: r.nome_apparato, righe: [] };
    a.righe.push(r);
    perApparato.set(r.device_id, a);
  }
  return [...perApparato.values()]
    .map((a) => {
      const porte = inPorteCliente(a.righe, nomi);
      return { ip: a.ip, nome: a.nome, porte, libere: porte.filter((p) => p.stato === "libera").length };
    })
    .filter((a) => a.porte.length > 0)
    .sort((a, b) => a.nome.localeCompare(b.nome, "it"));
}

function porteLette(db: Database.Database): number {
  const riga = db.prepare(`
    SELECT COUNT(sp.id) AS porte
    FROM network_devices nd
    JOIN switch_ports sp ON sp.device_id = nd.id
    WHERE nd.device_type = 'switch'
  `).get() as { porte: number };
  return riga.porte;
}

interface SpentoSegnalato {
  ip: string;
  nome: string;
  tipo: TipoCliente;
  categoria: string | null;
  last_seen: string;
}

function spentiDaSegnalare(db: Database.Database): SpentoSegnalato[] {
  return hostsTutti(db)
    .filter((h) => {
      const tipo = tipoCliente(testo(h.attr_category));
      return h.spento_lungo === 1 && (tipo === "rete" || tipo === "server");
    })
    .map((h) => ({
      ip: h.ip,
      nome: nomeDi(h),
      tipo: tipoCliente(testo(h.attr_category)),
      categoria: nomeCategoria(testo(h.attr_category)),
      last_seen: h.last_seen ?? "",
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "it"));
}

/** Nomi delle notizie: rete e server spenti da più di un giorno e non assenti. */
export function nomiDaSegnalare(db: Database.Database): string[] {
  return spentiDaSegnalare(db).map((h) => h.nome);
}

/** Se il nome è l'indirizzo, la voce comincia con la categoria. */
export function fraseApparatoSpento(
  nome: string,
  ip: string,
  categoria: string | null,
  lastSeen: string,
  adesso: Date = new Date(),
): string {
  const testa = nome !== ip ? nome : categoria ? `${inizialeMaiuscola(categoria)} ${ip}` : ip;
  return `${testa} spento ${daQuanto(parseDbDate(lastSeen), adesso)}`;
}

function contestoApparati(accesi: number, porte: number): string {
  const a = accesi === 1 ? "1 acceso" : `${accesi} accesi`;
  const p = porte === 1 ? "1 porta di rete letta" : `${porte} porte di rete lette`;
  return `${a} · ${p}`;
}

function riquadroApparati(c: ContestoCliente): RiquadroCliente {
  return nelCliente(c, (db) => {
    const hosts = hostsTutti(db);
    const accesi = hosts.filter((h) => h.status === "online").length;
    const porte = porteLette(db);
    const aperti = spentiDaSegnalare(db).length;
    return {
      numero: String(hosts.length),
      contesto: contestoApparati(accesi, porte),
      aperti,
      stato: aperti > 0 ? "attenzione" : "a_posto",
    };
  });
}

function attenzioneApparati(c: ContestoCliente): VoceAttenzione[] {
  return nelCliente(c, (db) =>
    spentiDaSegnalare(db).slice(0, 5).map((h) => ({
      gravita: "nota" as const,
      testo: fraseApparatoSpento(h.nome, h.ip, h.categoria, h.last_seen),
      href: `/cliente/apparati?tipo=${h.tipo}&ip=${encodeURIComponent(h.ip)}`,
      scheda: "Apparati",
    })),
  );
}

export const schedaApparati: SchedaCliente = {
  id: "apparati",
  titolo: "Apparati",
  ordine: 20,
  icona: "MonitorSmartphone",
  attiva: () => true,
  riquadro: riquadroApparati,
  attenzione: attenzioneApparati,
};

/** Ogni foglia della tassonomia ha un tipo. Serve alla prova, non alla pagina. */
export function foglieTassonomia(): string[] {
  return Object.entries(CATEGORY_TAXONOMY).flatMap(([radice, foglie]) => foglie.map((f) => `${radice}.${f}`));
}
