/**
 * client-config.ts — Modulo standalone per la gestione delle configurazioni cliente.
 *
 * Storage su filesystem: data/client-configs/<CODICE>/
 *   - <CODICE>.json  (dati strutturati)
 *   - <CODICE>.md    (documento leggibile, stesso formato dello script Python)
 *
 * Collegamento al sistema IPAM solo tramite codice cliente.
 */

import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ClienteData {
  cliente: string;
  referente: string;
  cod_cliente: string;
}

export interface AccessoData {
  rdp: string[];
  teamviewer: string[];
  vpn: string[];
  bitwise: string;
}

export interface VlanRow {
  id: string;
  subnet: string;
  gtw: string;
  dns: string;
  note: string;
}

export interface SwitchRow {
  nome: string;
  ip: string;
  modello: string;
  credenziali: string;
  snmp: string;
  note: string;
}

export interface FirewallData {
  modello: string;
  sn: string;
  ip_interno: string;
  ip_esterno: string;
  credenziali: string;
  snmp: string;
  note: string;
}

export interface LineaRow {
  nome: string;
  provider: string;
  ip_sub: string;
  ip_p2p: string;
  router: string;
  note: string;
}

export interface WifiSsid {
  ssid: string;
  wpa: string;
}

export interface WifiData {
  controller: string;
  controller_ip: string;
  controller_cred: string;
  aps: string[];
  ssids: WifiSsid[];
  note: string;
}

export interface VpnRow {
  nome: string;
  local_device: string;
  remote_device: string;
  local_ip: string;
  remote_ip: string;
  local_net: string;
  remote_net: string;
  ike: string;
  ipsec: string;
  note: string;
}

export interface StorageRow {
  nome: string;
  modello: string;
  ip: string;
  credenziali: string;
  spazio: string;
  snmp: string;
  note: string;
}

export interface AdData {
  dominio_dns: string;
  dominio_netbios: string;
  credenziali: string;
  dns: string;
  dhcp: string;
  user_domarc: string;
  dc: string;
  note: string;
}

export interface ServerFisicoRow {
  nome: string;
  modello: string;
  ip: string;
  ip_ilo: string;
  credenziali: string;
  snmp: string;
  note: string;
}

export interface ProxmoxNodo {
  nome: string;
  ip: string;
  credenziali: string;
}

export interface VirtualizzazioneData {
  tipo: "vmware" | "proxmox";
  // VMware
  vcenter_ver?: string;
  vcenter_ip?: string;
  vcenter_cred?: string;
  vcenter_cred_5480?: string;
  esx?: string[];
  // Proxmox
  versione?: string;
  cluster?: string;
  nodi?: ProxmoxNodo[];
  note?: string;
}

export interface VmRow {
  nome: string;
  ip: string;
  funzioni: string;
  os: string;
  cpu: string;
  ram: string;
  dischi: string;
}

export interface PostaData {
  locale: string;
  cloud_servizio: string;
  cloud_cred: string;
}

export interface CentralinoData {
  tipo: string;
  ip: string;
  credenziali: string;
  linee: string;
  telefoni: string;
}

export interface SoftwaredomarcData {
  antivirus: string;
  log_collector: string;
  datia: string;
  office365: string;
}

export interface ServizioCloudRow {
  nome: string;
  dettagli: string;
}

export interface BackupData {
  locale: string;
  nas: string;
  cloud: string;
  software: string;
}

export interface GestionaleRow {
  nome: string;
  assistenza: string;
}

export interface ApparatiData {
  ups: string;
  domotica: string;
  altri: string;
}

export interface ClientConfig {
  cliente: ClienteData;
  accesso: AccessoData;
  network: VlanRow[];
  switch: SwitchRow[];
  firewall: FirewallData;
  linee: LineaRow[];
  // Sezioni opzionali
  wifi?: WifiData;
  vpn?: VpnRow[];
  storage?: StorageRow[];
  ad?: AdData;
  server_fisici?: ServerFisicoRow[];
  virtualizzazione?: VirtualizzazioneData;
  vm?: VmRow[];
  posta?: PostaData;
  centralino?: CentralinoData;
  software_domarc?: SoftwaredomarcData;
  servizi_cloud?: ServizioCloudRow[];
  stampanti?: string[];
  backup?: BackupData;
  gestionale?: GestionaleRow[];
  apparati?: ApparatiData;
  licenze?: string;
}

// ─────────────────────────────────────────────
// Filesystem I/O
// ─────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), "data", "client-configs");

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sanitizeCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

function configDir(codiceCliente: string): string {
  return path.join(DATA_DIR, sanitizeCode(codiceCliente));
}

function jsonPath(codiceCliente: string): string {
  const code = sanitizeCode(codiceCliente);
  return path.join(configDir(codiceCliente), `${code}.json`);
}

function mdPath(codiceCliente: string): string {
  const code = sanitizeCode(codiceCliente);
  return path.join(configDir(codiceCliente), `${code}.md`);
}

/** Legge la config JSON di un cliente. Ritorna null se non esiste. */
export function getClientConfig(codiceCliente: string): ClientConfig | null {
  const p = jsonPath(codiceCliente);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw) as ClientConfig;
  } catch {
    return null;
  }
}

/** Salva la config JSON + rigenera il MD. */
export function saveClientConfig(codiceCliente: string, data: ClientConfig): void {
  const dir = configDir(codiceCliente);
  ensureDir(dir);
  fs.writeFileSync(jsonPath(codiceCliente), JSON.stringify(data, null, 2), "utf-8");
  fs.writeFileSync(mdPath(codiceCliente), renderMarkdown(data), "utf-8");
}

/** Elimina la cartella di configurazione di un cliente. */
export function deleteClientConfig(codiceCliente: string): boolean {
  const dir = configDir(codiceCliente);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

/** Lista tutti i codici cliente con config salvata. */
export function listClientConfigs(): string[] {
  ensureDir(DATA_DIR);
  return fs.readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => fs.existsSync(path.join(DATA_DIR, name, `${name}.json`)))
    .sort();
}

/** Legge il markdown generato. Ritorna null se non esiste. */
export function getClientConfigMd(codiceCliente: string): string | null {
  const p = mdPath(codiceCliente);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf-8");
}

// ─────────────────────────────────────────────
// Markdown renderer (port dello script Python)
// ─────────────────────────────────────────────

function pad(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

function renderCliente(d: ClienteData): string {
  return [
    "# CLIENTE:\n",
    "```",
    `REFERENTE/I TECNICO: ${d.referente}`,
    `COD CLIENTE:         ${d.cod_cliente}`,
    "```",
  ].join("\n");
}

function renderAccesso(d: AccessoData): string {
  const lines = ["# ACCESSO SERVIZI CLIENTE\n", "```"];
  d.rdp.forEach((r, i) => {
    const label = d.rdp.length > 1 ? `RDP${i + 1}:` : "RDP:";
    lines.push(`${pad(label, 12)}${r}`);
  });
  d.teamviewer.forEach((t, i) => {
    const label = d.teamviewer.length > 1 ? `TEAMVIEWER${i + 1}:` : "TEAMVIEWER:";
    lines.push(`${pad(label, 12)}${t}`);
  });
  d.vpn.forEach((v, i) => {
    const label = d.vpn.length > 1 ? `VPN${i + 1}:` : "VPN:";
    lines.push(`${pad(label, 12)}${v}`);
  });
  if (d.bitwise) {
    lines.push(`${pad("BITWISE:", 12)}${d.bitwise}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function renderNetwork(rows: VlanRow[]): string {
  const lines = ["# NETWORK\n", "```"];
  lines.push(`${pad("", 12)}${pad("ID", 6)}${pad("SUBNET", 16)}${pad("GTW", 16)}DNS`);
  for (const r of rows) {
    lines.push(`${pad("VLAN XXX:", 12)}${pad(r.id, 6)}${pad(r.subnet, 16)}${pad(r.gtw, 16)}${r.dns}`);
    lines.push(`    Note: ${r.note}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function renderSwitch(rows: SwitchRow[]): string {
  const lines = ["# SWITCH\n", "```"];
  lines.push(`${pad("SW", 12)}${pad("IP", 16)}${pad("MODELLO", 14)}${pad("CREDENZIALI", 20)}SNMP`);
  for (const r of rows) {
    lines.push(`    ${pad(r.nome, 8)}${pad(r.ip, 16)}${pad(r.modello, 14)}${pad(r.credenziali, 20)}${r.snmp}`);
    lines.push(`    Note: ${r.note}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function renderFirewall(d: FirewallData): string {
  return [
    "# FIREWALL\n",
    "```",
    `FWL Modello:     ${d.modello}`,
    `FWL SN:          ${d.sn}`,
    `FWL IP Interno:  ${d.ip_interno}`,
    `FWL IP Esterno:  ${d.ip_esterno}`,
    `FWL Credenziali: ${d.credenziali}`,
    `FWL SNMP:        ${d.snmp}`,
    `Note:            ${d.note}`,
    "```",
  ].join("\n");
}

function renderLinee(rows: LineaRow[]): string {
  const lines = ["# LINEE DATI\n", "```"];
  lines.push(`${pad("", 12)}${pad("Provider", 12)}${pad("IP/sub", 16)}${pad("IP p2p", 16)}router`);
  for (const r of rows) {
    lines.push(`${pad(r.nome, 12)}${pad(r.provider, 12)}${pad(r.ip_sub, 16)}${pad(r.ip_p2p, 16)}${r.router}`);
    lines.push(`    Note: ${r.note}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function renderWifi(d: WifiData): string {
  const lines = ["# WIFI\n", "```"];
  lines.push(`WIFI CONTROLLER:             ${d.controller}`);
  lines.push(`WIFI CONTROLLER IP:          ${d.controller_ip}`);
  lines.push(`WIFI CONTROLLER credenziali: ${d.controller_cred}`);
  lines.push("");
  d.aps.forEach((ap, i) => lines.push(`WIFI AP${String(i + 1).padStart(2, "0")}: ${ap}`));
  lines.push("");
  d.ssids.forEach((s, i) => lines.push(`WIFI SSID${i + 1}: ${pad(s.ssid, 20)} WPA: ${s.wpa}`));
  lines.push("");
  lines.push(`Note: ${d.note}`);
  lines.push("```");
  return lines.join("\n");
}

function renderVpn(rows: VpnRow[]): string {
  const lines = ["# VPN\n", "```"];
  for (const r of rows) {
    lines.push(`${r.nome}:`);
    lines.push(`    ${pad("Local Device", 20)}Remote Device`);
    lines.push(`    ${pad(r.local_device, 20)}${r.remote_device}`);
    lines.push(`    ${pad("Local IP", 20)}Remote IP`);
    lines.push(`    ${pad(r.local_ip, 20)}${r.remote_ip}`);
    lines.push(`    ${pad("Local Network", 20)}Remote Network`);
    lines.push(`    ${pad(r.local_net, 20)}${r.remote_net}`);
    lines.push(`    IKE par:   ${r.ike}`);
    lines.push(`    IPSEC Par: ${r.ipsec}`);
    lines.push(`    Note:      ${r.note}`);
    lines.push("");
  }
  lines.push("```");
  return lines.join("\n");
}

function renderStorage(rows: StorageRow[]): string {
  const lines = ["# STORAGE\n", "```"];
  lines.push(`${pad("NAS", 8)}${pad("Modello", 16)}${pad("IP", 16)}${pad("Credenziali", 20)}${pad("Spazio", 12)}SNMP`);
  for (const r of rows) {
    lines.push(`${pad(r.nome, 8)}${pad(r.modello, 16)}${pad(r.ip, 16)}${pad(r.credenziali, 20)}${pad(r.spazio, 12)}${r.snmp}`);
    lines.push(`    Note: ${r.note}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function renderAd(d: AdData): string {
  return [
    "# AD\n",
    "```",
    `DOMINIO DNS (FQDN):  ${d.dominio_dns}`,
    `DOMINIO NETBIOS:     ${d.dominio_netbios}`,
    `CREDENZIALI:         ${d.credenziali}`,
    `DNS:                 ${d.dns}`,
    `DHCP:                ${d.dhcp}`,
    `User DOMARC:         ${d.user_domarc}`,
    `DOMAIN CONTROLLER:   ${d.dc}`,
    `Note:                ${d.note}`,
    "```",
  ].join("\n");
}

function renderServerFisici(rows: ServerFisicoRow[]): string {
  const lines = ["# SERVER FISICI\n", "```"];
  lines.push(`${pad("SERVER", 12)}${pad("MODELLO", 14)}${pad("IP", 16)}${pad("IP ILO", 16)}${pad("CREDENZIALI", 20)}SNMP`);
  for (const r of rows) {
    lines.push(`${pad(r.nome, 12)}${pad(r.modello, 14)}${pad(r.ip, 16)}${pad(r.ip_ilo, 16)}${pad(r.credenziali, 20)}${r.snmp}`);
    lines.push(`    Note: ${r.note}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function renderVirtualizzazione(d: VirtualizzazioneData): string {
  const lines = ["# VIRTUALIZZAZIONE\n", "```"];
  if (d.tipo === "proxmox") {
    lines.push(`PIATTAFORMA:   Proxmox VE ${d.versione ?? ""}`);
    lines.push(`CLUSTER:       ${d.cluster || "(standalone)"}`);
    lines.push("");
    lines.push(`${pad("NODO", 16)}${pad("IP", 16)}CREDENZIALI`);
    for (const nd of d.nodi ?? []) {
      lines.push(`${pad(nd.nome, 16)}${pad(nd.ip, 16)}${nd.credenziali}`);
    }
    if (d.note) lines.push(`\nNote: ${d.note}`);
  } else {
    lines.push("PIATTAFORMA:   VMware");
    lines.push(`${pad("", 12)}${pad("ver", 8)}${pad("IP", 16)}${pad("CREDENZIALI", 24)}CREDENZIALI (5480)`);
    lines.push(
      `${pad("VCENTER", 12)}${pad(d.vcenter_ver ?? "", 8)}${pad(d.vcenter_ip ?? "", 16)}${pad(d.vcenter_cred ?? "", 24)}${d.vcenter_cred_5480 ?? ""}`
    );
    (d.esx ?? []).forEach((esx, i) => lines.push(`ESX${String(i + 1).padStart(2, "0")}       ${esx}`));
  }
  lines.push("```");
  return lines.join("\n");
}

function renderVm(rows: VmRow[]): string {
  const lines = ["# VM\n", "```"];
  lines.push(`${pad("NOME", 12)}${pad("IP", 16)}${pad("FUNZIONI", 20)}${pad("OS", 8)}${pad("CPU", 5)}${pad("RAM", 5)}DISCHI`);
  for (const r of rows) {
    lines.push(`${pad(r.nome, 12)}${pad(r.ip, 16)}${pad(r.funzioni, 20)}${pad(r.os, 8)}${pad(r.cpu, 5)}${pad(r.ram, 5)}${r.dischi}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function renderPosta(d: PostaData): string {
  return [
    "# POSTA\n",
    "```",
    `locale:                   ${d.locale}`,
    `Cloud Servizio:           ${d.cloud_servizio}`,
    `Cloud Sito e Credenziali: ${d.cloud_cred}`,
    "```",
  ].join("\n");
}

function renderCentralino(d: CentralinoData): string {
  return [
    "# CENTRALINO\n",
    "```",
    `CENTRALINO TIPO:        ${d.tipo}`,
    `CENTRALINO IP:          ${d.ip}`,
    `CENTRALINO CREDENZIALI: ${d.credenziali}`,
    `CENTRALINO LINEE:       ${d.linee}`,
    `TELEFONI:               ${d.telefoni}`,
    "```",
  ].join("\n");
}

function renderSoftwareDomarc(d: SoftwaredomarcData): string {
  return [
    "# SOFTWARE DOMARC\n",
    "```",
    `ANTIVIRUS:      ${d.antivirus}`,
    `LOG COLLECTOR:  ${d.log_collector}`,
    `DATIA MONITOR:  ${d.datia}`,
    `OFFICE 365:     ${d.office365}`,
    "```",
  ].join("\n");
}

function renderServiziCloud(rows: ServizioCloudRow[]): string {
  const lines = ["# SERVIZI CLOUD\n", "```"];
  for (const r of rows) {
    lines.push(`${r.nome}: ${r.dettagli}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function renderStampanti(items: string[]): string {
  const lines = ["# STAMPANTI\n", "```"];
  items.forEach((s, i) => lines.push(`Stampante ${i + 1}: ${s}`));
  lines.push("```");
  return lines.join("\n");
}

function renderBackup(d: BackupData): string {
  const lx = d.locale ? "X" : " ";
  const nx = d.nas ? "X" : " ";
  const cx = d.cloud ? "X" : " ";
  return [
    "# BACKUP\n",
    "```",
    `${pad("TIPO BACKUP", 16)}${pad("LOCALE", 12)}${pad("NAS", 12)}CLOUD`,
    `${pad("", 16)}${pad(lx, 12)}${pad(nx, 12)}${cx}`,
    `Locale: ${d.locale}`,
    `NAS:    ${d.nas}`,
    `Cloud:  ${d.cloud}`,
    "",
    `SOFTWARE: ${d.software}`,
    "```",
  ].join("\n");
}

function renderGestionale(rows: GestionaleRow[]): string {
  const lines = ["# GESTIONALE/I o altri SOFTWARE\n", "```"];
  for (const r of rows) {
    lines.push(`SOFTWARE:              ${r.nome}`);
    lines.push(`RIFERIMENTI ASSISTENZA:${r.assistenza}`);
    lines.push("");
  }
  lines.push("```");
  return lines.join("\n");
}

function renderApparati(d: ApparatiData): string {
  return [
    "# APPARATI AGGIUNTIVI\n",
    "```",
    `UPS:      ${d.ups}`,
    `DOMOTICA: ${d.domotica}`,
    `ALTRI:    ${d.altri}`,
    "```",
  ].join("\n");
}

function renderLicenze(s: string): string {
  return `# GESTIONE LICENZE PER CONTO CLIENTE\n\n\`\`\`\n${s}\n\`\`\``;
}

type MandatorySection = { key: "cliente"; render: (d: ClienteData) => string }
  | { key: "accesso"; render: (d: AccessoData) => string }
  | { key: "network"; render: (d: VlanRow[]) => string }
  | { key: "switch"; render: (d: SwitchRow[]) => string }
  | { key: "firewall"; render: (d: FirewallData) => string }
  | { key: "linee"; render: (d: LineaRow[]) => string };

const MANDATORY_SECTIONS: MandatorySection[] = [
  { key: "cliente", render: renderCliente },
  { key: "accesso", render: renderAccesso },
  { key: "network", render: renderNetwork },
  { key: "switch", render: renderSwitch },
  { key: "firewall", render: renderFirewall },
  { key: "linee", render: renderLinee },
];

const OPTIONAL_SECTIONS: Array<{ key: string; render: (d: never) => string }> = [
  { key: "wifi", render: renderWifi as (d: never) => string },
  { key: "vpn", render: renderVpn as (d: never) => string },
  { key: "storage", render: renderStorage as (d: never) => string },
  { key: "ad", render: renderAd as (d: never) => string },
  { key: "server_fisici", render: renderServerFisici as (d: never) => string },
  { key: "virtualizzazione", render: renderVirtualizzazione as (d: never) => string },
  { key: "vm", render: renderVm as (d: never) => string },
  { key: "posta", render: renderPosta as (d: never) => string },
  { key: "centralino", render: renderCentralino as (d: never) => string },
  { key: "software_domarc", render: renderSoftwareDomarc as (d: never) => string },
  { key: "servizi_cloud", render: renderServiziCloud as (d: never) => string },
  { key: "stampanti", render: renderStampanti as (d: never) => string },
  { key: "backup", render: renderBackup as (d: never) => string },
  { key: "gestionale", render: renderGestionale as (d: never) => string },
  { key: "apparati", render: renderApparati as (d: never) => string },
  { key: "licenze", render: renderLicenze as (d: never) => string },
];

/** Genera il markdown completo della configurazione cliente. */
export function renderMarkdown(data: ClientConfig): string {
  const parts: string[] = [];
  parts.push(`<!-- Cliente: ${data.cliente.cliente} -->\n`);

  for (const sec of MANDATORY_SECTIONS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parts.push((sec.render as (d: any) => string)(data[sec.key]));
  }

  for (const sec of OPTIONAL_SECTIONS) {
    const val = (data as unknown as Record<string, unknown>)[sec.key];
    if (val !== undefined && val !== null) {
      parts.push(sec.render(val as never));
    }
  }

  return parts.join("\n\n");
}
