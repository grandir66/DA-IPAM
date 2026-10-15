/**
 * Proposta dell'apparato da un host (tappa 1 credenziali, 15/10).
 *
 * Una sola logica per le quattro finestre che trasformano un IP in apparato
 * (scheda dell'oggetto, pagina della rete, discovery, lista per
 * classificazione). Prima ognuna aveva la sua: «hp» + SSH + ProCurve per un
 * server Windows su hardware HP, «server + Altro + UPS + SNMP v2» fisso nella
 * finestra in blocco, «microsoft» che la tabella degli apparati rifiuta.
 *
 * Regole:
 * - la **piattaforma** (`network_devices.vendor`) viene dalla famiglia di
 *   sistema operativo dedotta, non dal produttore dell'hardware;
 * - la **classificazione** è sempre un valore di DEVICE_CLASSIFICATIONS o ""
 *   (da scegliere: la finestra blocca il salvataggio), e la scelta manuale
 *   dell'host vince;
 * - la **credenziale** è la prima validata sull'host con protocollo e tipo
 *   compatibili (`tipiCredenzialePerProtocollo`), la **porta** è quella con cui
 *   è stata validata, poi quella propria della credenziale, poi lo standard.
 *
 * Modulo puro: niente DB, lo usano i componenti client.
 */
import { DEVICE_CLASSIFICATIONS } from "@/lib/device-classifications";
import { coerceProtocolForVendor, coerceScanTargetForVendor } from "@/lib/vendor-device-profile";
import { inferVendorFromManufacturer } from "@/lib/vendor-inference";
import { isMacOsHost, suggestEndpointClassification } from "@/lib/host-platform-detect";
import { getDefaultProductProfileForVendor, PRODUCT_PROFILES_BY_VENDOR } from "@/lib/device-product-profiles";
import { tipiCredenzialePerProtocollo } from "@/lib/credential-protocol-map";
import { DEFAULT_PORTS, portaCredenziale, type CredProtocol } from "@/lib/credentials/porte";

export interface HostPerProposta {
  ip: string;
  hostname: string | null;
  custom_name: string | null;
  classification: string | null;
  classification_manual?: number | null;
  // Facoltativi: le righe di `hosts` li hanno, le liste leggere a volte no.
  inferred_vendor?: string | null;
  inferred_os_family?: string | null;
  inferred_protocol?: string | null;
  inferred_device_type?: string | null;
  inferred_scan_target?: string | null;
  device_manufacturer: string | null;
  os_info: string | null;
  model: string | null;
  vendor: string | null;
  snmp_data: string | null;
  host_credentials?: Array<{ credential_id: number; protocol_type: string; port: number; validated: number }>;
}

export interface CredenzialeArchivio {
  id: number;
  name: string;
  credential_type: string;
  port: number | null;
}

export type ProtocolloApparato = "ssh" | "snmp_v2" | "snmp_v3" | "winrm" | "api";

export interface PropostaApparato {
  name: string;
  vendor: string;
  protocol: ProtocolloApparato;
  /** "" = da scegliere: il salvataggio è bloccato. */
  classification: string;
  productProfile: string | null;
  scanTarget: string | null;
  port: number;
  credentialId: string | null;
  snmpCredentialId: string | null;
  useForArpPoll: boolean;
}

/** Valori ammessi da `network_devices.vendor` (più `apple`, che la tappa 1b aggiunge alla tabella). */
const PIATTAFORME = new Set([
  "mikrotik", "ubiquiti", "hp", "cisco", "omada", "stormshield", "proxmox", "vmware",
  "linux", "windows", "synology", "qnap", "apple", "other",
]);

/** Piattaforme software che girano su Linux: vincono sulla famiglia «linux». */
const PIATTAFORME_SU_LINUX = new Set(["proxmox", "vmware", "synology", "qnap"]);

/** Marche di rete: vincono sulla famiglia «linux» solo se l'host è un apparato di rete. */
const MARCHE_DI_RETE = new Set(["mikrotik", "ubiquiti", "cisco", "hp", "stormshield", "omada"]);
const CLASSI_DI_RETE = new Set(["switch", "router", "firewall", "access_point"]);

/** Marche di hardware che dicono la piattaforma (senza famiglia SO dedotta). */
const MARCA_A_PIATTAFORMA: Record<string, string> = { microsoft: "windows" };

const ALIAS_CLASSIFICAZIONE: Record<string, string> = { printer: "stampante", macos: "notebook" };
const CLASSIFICAZIONI = new Set<string>(DEVICE_CLASSIFICATIONS.filter((c) => c !== "unknown"));

/** Slug di DEVICE_CLASSIFICATIONS, con gli alias del classificatore; "" se non è un valore ammesso. */
export function classificazioneValida(valore: string | null | undefined): string {
  if (!valore) return "";
  const v = ALIAS_CLASSIFICAZIONE[valore] ?? valore;
  return CLASSIFICAZIONI.has(v) ? v : "";
}

function leggiSnmp(host: HostPerProposta): { sysName?: string; manufacturer?: string } | null {
  if (!host.snmp_data) return null;
  try {
    const d = JSON.parse(host.snmp_data) as unknown;
    return d && typeof d === "object" ? (d as { sysName?: string; manufacturer?: string }) : null;
  } catch {
    return null;
  }
}

function eMac(host: HostPerProposta): boolean {
  return isMacOsHost({
    os_info: host.os_info,
    inferred_os_family: host.inferred_os_family,
    device_manufacturer: host.device_manufacturer,
    model: host.model,
    vendor: host.vendor,
  });
}

function classificazioneDaHost(host: HostPerProposta): string {
  if (host.classification_manual === 1) {
    const manuale = classificazioneValida(host.classification);
    if (manuale) return manuale;
  }
  const mac = suggestEndpointClassification({
    os_info: host.os_info,
    inferred_os_family: host.inferred_os_family,
    classification: host.classification,
    model: host.model,
  });
  return classificazioneValida(mac)
    || classificazioneValida(host.inferred_device_type)
    || classificazioneValida(host.classification);
}

function piattaformaConClassificazione(host: HostPerProposta, classificazione: string): string {
  const famiglia = host.inferred_os_family;
  const marca = (host.inferred_vendor ?? "").toLowerCase();
  if (famiglia === "macos" || eMac(host)) return "apple";
  if (famiglia === "windows") return "windows";
  if (famiglia === "linux") {
    if (PIATTAFORME_SU_LINUX.has(marca)) return marca;
    if (MARCHE_DI_RETE.has(marca) && CLASSI_DI_RETE.has(classificazione)) return marca;
    return "linux";
  }
  if (MARCA_A_PIATTAFORMA[marca]) return MARCA_A_PIATTAFORMA[marca];
  if (PIATTAFORME.has(marca)) return marca;
  const dalProduttore = inferVendorFromManufacturer(leggiSnmp(host)?.manufacturer ?? host.device_manufacturer ?? null);
  return PIATTAFORME.has(dalProduttore) ? dalProduttore : "other";
}

/** Valore ammesso da `network_devices.vendor`, dedotto dalla famiglia SO e non dall'hardware. */
export function piattaformaDaHost(host: HostPerProposta): string {
  return piattaformaConClassificazione(host, classificazioneDaHost(host));
}

/**
 * Profilo prodotto coerente con la classificazione: `getDefaultProductProfileForVendor`
 * prende il primo dell'elenco (ProCurve per ogni «hp», server per ogni Windows).
 * Esportata: le finestre la usano anche quando si cambia la classificazione a mano.
 */
export function profiloPerClassificazione(piattaforma: string, classificazione: string): string {
  const ammessi = (PRODUCT_PROFILES_BY_VENDOR as Record<string, readonly string[]>)[piattaforma] ?? [];
  const server = classificazione.startsWith("server") || classificazione.endsWith("_server") || classificazione === "vm";
  const preferito: Record<string, string | undefined> = {
    windows: server ? "windows_server" : classificazione ? "windows_client" : undefined,
    linux: server ? "linux_server" : classificazione ? "linux_client" : undefined,
    hp: classificazione === "stampante" ? "hp_stampante" : server ? "hp_server_ilo" : undefined,
    mikrotik: classificazione === "router" ? "mikrotik_router" : classificazione === "switch" ? "mikrotik_switch" : undefined,
    ubiquiti: classificazione === "router" ? "ubiquiti_router" : classificazione === "access_point" ? "ubiquiti_access_point" : classificazione === "switch" ? "ubiquiti_switch_managed" : undefined,
    cisco: classificazione === "router" ? "cisco_router" : classificazione === "voip" ? "cisco_telefono" : undefined,
    qnap: classificazione === "switch" ? "qnap_switch" : classificazione === "router" ? "qnap_router" : undefined,
    omada: classificazione === "access_point" ? "omada_access_point" : classificazione === "switch" ? "omada_switch" : undefined,
    proxmox: classificazione === "backup_server" ? "proxmox_pbs" : undefined,
  };
  const scelto = preferito[piattaforma];
  if (scelto && ammessi.includes(scelto)) return scelto;
  return getDefaultProductProfileForVendor(piattaforma, classificazione || null);
}

function protocolloCredenziale(p: ProtocolloApparato): CredProtocol {
  return p === "snmp_v2" || p === "snmp_v3" ? "snmp" : p;
}

function eSnmp(p: ProtocolloApparato): boolean {
  return p === "snmp_v2" || p === "snmp_v3";
}

/** Prima credenziale validata sull'host per quel protocollo, con tipo compatibile. */
function credenzialeValidata(
  host: HostPerProposta | undefined,
  protocollo: ProtocolloApparato,
  archivio: CredenzialeArchivio[],
): { id: number; port: number } | null {
  const tipi = tipiCredenzialePerProtocollo(protocollo);
  const proto = protocolloCredenziale(protocollo);
  for (const hc of host?.host_credentials ?? []) {
    if (hc.validated !== 1 || hc.protocol_type !== proto) continue;
    const voce = archivio.find((c) => c.id === hc.credential_id);
    if (voce && tipi.includes(voce.credential_type)) return { id: hc.credential_id, port: hc.port };
  }
  return null;
}

/** Porta per la credenziale scelta: quella validata sull'host, poi la sua propria, poi lo standard. */
export function portaPerCredenziale(
  credentialId: string | null,
  protocollo: ProtocolloApparato,
  archivio: CredenzialeArchivio[],
  host?: HostPerProposta,
): number {
  const proto = protocolloCredenziale(protocollo);
  if (credentialId) {
    const id = Number(credentialId);
    const validata = host?.host_credentials?.find((hc) => hc.credential_id === id && hc.protocol_type === proto && hc.validated === 1);
    if (validata) return validata.port;
    const voce = archivio.find((c) => c.id === id);
    if (voce) return portaCredenziale(voce, proto);
  }
  return DEFAULT_PORTS[proto];
}

function protocolloPer(host: HostPerProposta, piattaforma: string): ProtocolloApparato {
  if (piattaforma === "windows") return "winrm";
  if (piattaforma === "linux" || piattaforma === "apple") return "ssh";
  const dedotto = host.inferred_protocol ?? (leggiSnmp(host) ? "snmp_v2" : undefined);
  return coerceProtocolForVendor(piattaforma, dedotto ?? undefined) as ProtocolloApparato;
}

export function proponiApparato(host: HostPerProposta, archivio: CredenzialeArchivio[]): PropostaApparato {
  const classification = classificazioneDaHost(host);
  const vendor = piattaformaConClassificazione(host, classification);
  const protocol = protocolloPer(host, vendor);
  const principale = credenzialeValidata(host, protocol, archivio);
  const snmp = eSnmp(protocol) ? null : credenzialeValidata(host, "snmp_v2", archivio);
  const credentialId = principale ? String(principale.id) : null;
  return {
    name: leggiSnmp(host)?.sysName || host.custom_name || host.hostname || host.ip,
    vendor,
    protocol,
    classification,
    productProfile: profiloPerClassificazione(vendor, classification),
    scanTarget: coerceScanTargetForVendor(vendor, vendor === "apple" ? "macos" : host.inferred_scan_target),
    port: principale?.port ?? portaPerCredenziale(credentialId, protocol, archivio, host),
    credentialId,
    snmpCredentialId: snmp ? String(snmp.id) : null,
    useForArpPoll: classification === "router" || classification === "firewall",
  };
}

/**
 * Cambio di protocollo: una credenziale di tipo incompatibile si azzera, la
 * porta si ricalcola; con SNMP la credenziale principale è quella SNMP e la
 * seconda tendina si svuota (tornando a un altro protocollo la SNMP scende lì).
 */
export function riallineaAlProtocollo(
  p: PropostaApparato,
  protocollo: ProtocolloApparato,
  archivio: CredenzialeArchivio[],
  host?: HostPerProposta,
): PropostaApparato {
  const tipi = tipiCredenzialePerProtocollo(protocollo);
  const tipoDi = (id: string | null) => (id ? archivio.find((c) => c.id === Number(id))?.credential_type ?? null : null);
  let credentialId = p.credentialId;
  let snmpCredentialId = p.snmpCredentialId;

  if (eSnmp(protocollo)) {
    if (!(tipoDi(credentialId) === "snmp")) credentialId = snmpCredentialId;
    if (!credentialId) credentialId = credenzialeValidata(host, protocollo, archivio)?.id.toString() ?? null;
    snmpCredentialId = null;
  } else {
    if (eSnmp(p.protocol) && tipoDi(credentialId) === "snmp" && !snmpCredentialId) snmpCredentialId = credentialId;
    const tipo = tipoDi(credentialId);
    if (!tipo || !tipi.includes(tipo)) credentialId = credenzialeValidata(host, protocollo, archivio)?.id.toString() ?? null;
  }

  return {
    ...p,
    protocol: protocollo,
    credentialId,
    snmpCredentialId,
    port: portaPerCredenziale(credentialId, protocollo, archivio, host),
  };
}
