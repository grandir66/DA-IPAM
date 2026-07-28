// src/lib/attribution/probe-evidence.ts
// Mappa i finding dei probe passivi (fase 3, spec §4.5) in EvidenceInput[].
// Funzioni PURE: nessuna rete, nessun accesso DB — testabili senza mock.
import type { HttpTlsFinding } from "@/lib/scanner/probes/http-tls";
import type { Smb2Finding } from "@/lib/scanner/probes/smb2";
import type { MdnsFinding } from "@/lib/scanner/probes/mdns";
import type { SsdpFinding } from "@/lib/scanner/probes/ssdp";
import type { WsdFinding } from "@/lib/scanner/probes/wsd";
import type { RedfishDetectResult } from "@/lib/protocols/redfish";
import { isValidCategory } from "./taxonomy";
import { vendorSlug } from "./emitters";
import type { EvidenceInput } from "./types";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function expiresAt(): string {
  return new Date(Date.now() + THIRTY_DAYS_MS).toISOString();
}

// Server-header di web server generici: non sono il produttore del dispositivo,
// quindi non emettiamo vendor (spec §4.5 Task 1).
const GENERIC_SERVER_RE = /nginx|apache|lighttpd|IIS/i;

interface ServerRule {
  re: RegExp;
  vendorRaw: string;
  category?: string;
}

// vendorRaw passa per vendorSlug() (riuso, non reimplementazione) per restare
// coerente con gli slug prodotti dagli altri emettitori (oui/snmp/wazuh).
const SERVER_VENDOR_RULES: ServerRule[] = [
  { re: /mikrotik|routeros/i, vendorRaw: "MikroTik", category: "network.router" },
  { re: /ubiquiti|unifi/i, vendorRaw: "Ubiquiti" },
  { re: /synology|dsm/i, vendorRaw: "Synology", category: "storage.nas" },
  { re: /qnap|qts/i, vendorRaw: "QNAP", category: "storage.nas" },
  { re: /hp-chaisoe|hp http server/i, vendorRaw: "HP", category: "peripheral.printer" },
  { re: /ilo/i, vendorRaw: "HPE", category: "compute.server" },
  { re: /idrac/i, vendorRaw: "Dell", category: "compute.server" },
  { re: /proxmox/i, vendorRaw: "Proxmox", category: "compute.hypervisor" },
  { re: /vmware|esxi/i, vendorRaw: "VMware", category: "compute.hypervisor" },
];

interface TitleRule {
  re: RegExp;
  category: string;
}

// Ordine rilevante: pfSense/OPNsense (network.firewall) deve vincere PRIMA della
// regola generica router|gateway|firewall (network.router), altrimenti un titolo
// "pfSense - Firewall" finirebbe nella categoria meno specifica.
const TITLE_CATEGORY_RULES: TitleRule[] = [
  { re: /printer|imagerunner|workcentre|brother|kyocera|lexmark/i, category: "peripheral.printer" },
  { re: /camera|nvr|hikvision|dahua|onvif/i, category: "av.camera" },
  { re: /pfsense|opnsense/i, category: "network.firewall" },
  { re: /router|gateway|firewall/i, category: "network.router" },
  { re: /switch/i, category: "network.switch" },
  { re: /nas|diskstation|truenas/i, category: "storage.nas" },
  { re: /ups|powerchute/i, category: "power.ups" },
  { re: /proxmox|vsphere|esxi/i, category: "compute.hypervisor" },
];

interface CertRule {
  re: RegExp;
  vendorRaw?: string;
  category?: string;
}

// CN/SAN/issuer sono spesso auto-dichiarativi (spec §4.5 Task 1). Riusata anche
// per la conferma via issuer (solo la parte vendor, a confidence piu' bassa).
const CERT_RULES: CertRule[] = [
  { re: /\.ui\.com|unifi/i, vendorRaw: "Ubiquiti" },
  { re: /synology/i, vendorRaw: "Synology" },
  { re: /qnap/i, vendorRaw: "QNAP" },
  { re: /ilo|integrated lights-out/i, vendorRaw: "HPE", category: "compute.server" },
  { re: /idrac/i, vendorRaw: "Dell", category: "compute.server" },
  { re: /pfsense|opnsense/i, category: "network.firewall" },
  { re: /vmware/i, vendorRaw: "VMware" },
];

const SERVER_VENDOR_CONFIDENCE = 0.85;
const TITLE_CATEGORY_CONFIDENCE = 0.7;
const CERT_CN_SAN_CONFIDENCE = 0.8;
const CERT_ISSUER_CONFIDENCE = 0.6;

/**
 * Da un elenco di `HttpTlsFinding` (uno o piu' per host, una entry per porta)
 * deriva le evidenze di attribuzione. Deduplica per (dimension, claim) tenendo
 * la confidence piu' alta; scarta claim category fuori tassonomia (difesa in
 * profondita': le regole sopra sono gia' allineate a `taxonomy.ts`, ma un futuro
 * refuso in una regex/categoria non deve propagarsi come evidenza invalida).
 */
export function evidenceFromHttpTls(findings: HttpTlsFinding[]): EvidenceInput[] {
  const acc = new Map<string, EvidenceInput>();

  const push = (input: EvidenceInput) => {
    if (input.dimension === "category" && !isValidCategory(input.claim)) return;
    const key = `${input.dimension}:${input.claim}`;
    const existing = acc.get(key);
    if (!existing || input.confidence > existing.confidence) acc.set(key, input);
  };

  for (const f of findings) {
    const expires_at = expiresAt();

    if (f.server && !GENERIC_SERVER_RE.test(f.server)) {
      for (const rule of SERVER_VENDOR_RULES) {
        if (!rule.re.test(f.server)) continue;
        push({
          source: "http_banner", phase: "scan_naabu", dimension: "vendor",
          claim: vendorSlug(rule.vendorRaw), confidence: SERVER_VENDOR_CONFIDENCE,
          raw_value: f.server, expires_at,
        });
        if (rule.category) {
          push({
            source: "http_banner", phase: "scan_naabu", dimension: "category",
            claim: rule.category, confidence: SERVER_VENDOR_CONFIDENCE,
            raw_value: f.server, expires_at,
          });
        }
        break; // primo match vince
      }
    }

    if (f.title) {
      for (const rule of TITLE_CATEGORY_RULES) {
        if (!rule.re.test(f.title)) continue;
        push({
          source: "http_banner", phase: "scan_naabu", dimension: "category",
          claim: rule.category, confidence: TITLE_CATEGORY_CONFIDENCE,
          raw_value: f.title, expires_at,
        });
        break;
      }
    }

    const certBlob = [f.tlsSubjectCn, ...f.tlsSan].filter((v): v is string => Boolean(v)).join(" ");
    if (certBlob) {
      for (const rule of CERT_RULES) {
        if (!rule.re.test(certBlob)) continue;
        if (rule.vendorRaw) {
          push({
            source: "tls_cert", phase: "scan_naabu", dimension: "vendor",
            claim: vendorSlug(rule.vendorRaw), confidence: CERT_CN_SAN_CONFIDENCE,
            raw_value: certBlob, expires_at,
          });
        }
        if (rule.category) {
          push({
            source: "tls_cert", phase: "scan_naabu", dimension: "category",
            claim: rule.category, confidence: CERT_CN_SAN_CONFIDENCE,
            raw_value: certBlob, expires_at,
          });
        }
        break;
      }
    }

    if (f.tlsIssuer) {
      for (const rule of CERT_RULES) {
        if (!rule.vendorRaw || !rule.re.test(f.tlsIssuer)) continue;
        push({
          source: "tls_cert", phase: "scan_naabu", dimension: "vendor",
          claim: vendorSlug(rule.vendorRaw), confidence: CERT_ISSUER_CONFIDENCE,
          raw_value: f.tlsIssuer, expires_at,
        });
        break;
      }
    }
  }

  return Array.from(acc.values());
}

// ---------------------------------------------------------------------------
// SMB2 (fase 3 Task 2) — vedi commento di testa a smb2.ts per il vincolo di
// sicurezza: il probe si ferma alla CHALLENGE NTLMSSP, mai un'autenticazione.
// ---------------------------------------------------------------------------

const SMB_OS_CONFIDENCE = 0.9;
// La categoria è deliberatamente al livello 1 ("compute", non
// "compute.server"/"compute.workstation"): SMB2 da solo non distingue server
// da workstation, lo fa AD o altre evidenze più specifiche (spec Task 2).
const SMB_CATEGORY_CONFIDENCE = 0.5;

/** Dedup per (dimension, claim) tenendo la confidence più alta; scarta claim category fuori tassonomia. */
function dedupeAndValidate(inputs: EvidenceInput[]): EvidenceInput[] {
  const acc = new Map<string, EvidenceInput>();
  for (const input of inputs) {
    if (input.dimension === "category" && !isValidCategory(input.claim)) continue;
    const key = `${input.dimension}:${input.claim}`;
    const existing = acc.get(key);
    if (!existing || input.confidence > existing.confidence) acc.set(key, input);
  }
  return Array.from(acc.values());
}

// Build minimo plausibile per una versione Windows reale: Windows Vista/2008
// (6.0.6000) è la più vecchia release NT che parla NTLMv2/SMB2, ma già quella
// ha build a 4 cifre. Samba e i suoi derivati (QNAP QTS, Synology DSM, molti
// NAS Linux/BSD) rispondono anch'essi a SMB2/NTLMSSP ma riportano tipicamente
// build=0 nel campo Version della CHALLENGE (es. "6.1.0" — vedi evidenza reale
// QNAP 192.168.40.26, VM 533 rete 192.168.40.0/24, root cause del falso
// positivo os=windows su quel NAS).
const WINDOWS_MIN_PLAUSIBLE_BUILD = 1000;
// Major version realmente usate dalle NTLM Version di Windows (NT 5.x/6.x/10.x).
const WINDOWS_PLAUSIBLE_MAJORS = new Set([5, 6, 10]);

/**
 * Discrimina un vero Windows da Samba/NAS che rispondono comunque a SMB2 con
 * una CHALLENGE NTLMSSP: entrambi superano il probe, ma solo Windows riporta
 * un numero di build realistico (4-5 cifre, es. 7601/9200/9600/14393/17763/
 * 19041/20348/22621/26100). Richiede ANCHE major∈{5,6,10}, non solo build
 * grande, per difesa in profondità contro future varianti Version malformate.
 */
function isPlausibleWindowsVersion(osVersion: string | null): boolean {
  if (!osVersion) return false;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(osVersion);
  if (!match) return false;
  const major = Number(match[1]);
  const build = Number(match[3]);
  return build > WINDOWS_MIN_PLAUSIBLE_BUILD && WINDOWS_PLAUSIBLE_MAJORS.has(major);
}

/**
 * Da un `Smb2Finding` (NEGOTIATE + NTLMSSP NEGOTIATE anonimo riusciti) deriva
 * le evidenze. La sola risposta a NTLMSSP NON basta più a dire Windows: la
 * parlano anche Samba e i suoi derivati (QNAP, Synology, NAS Linux/BSD, molti
 * embedded), che riportano build=0 nella Version — vedi
 * `isPlausibleWindowsVersion`. Emettiamo `os = windows` (confidence alta) SOLO
 * se il build è plausibile; altrimenti nessun claim OS (meglio nessuna
 * informazione che una sbagliata — falso positivo altrimenti su ogni NAS della
 * rete, spec fix smb2-samba-false-positive). La categoria `compute` resta
 * emessa in ogni caso: SMB2 attivo implica comunque una macchina, non un
 * apparato di rete puro; sarà la fusione con mDNS/SSDP (es. storage.nas più
 * profondo/più forte) a comporre l'attribuzione finale. `netbiosName`/
 * `dnsDomain` non producono evidenze qui: non esiste una dimensione
 * "hostname" nell'attribution engine v2 (solo vendor/category/os) — restano
 * nel finding per usi futuri (es. matching AD).
 */
export function evidenceFromSmb2(f: Smb2Finding): EvidenceInput[] {
  const expires_at = expiresAt();
  const evidences: EvidenceInput[] = [];
  if (isPlausibleWindowsVersion(f.osVersion)) {
    evidences.push({
      source: "smb", phase: "scan_naabu", dimension: "os",
      claim: "windows", confidence: SMB_OS_CONFIDENCE, raw_value: f.osVersion, expires_at,
    });
  }
  evidences.push({
    source: "smb", phase: "scan_naabu", dimension: "category",
    claim: "compute", confidence: SMB_CATEGORY_CONFIDENCE, raw_value: null, expires_at,
  });
  return dedupeAndValidate(evidences);
}

// ---------------------------------------------------------------------------
// mDNS (fase 3 Task 2)
// ---------------------------------------------------------------------------

const MDNS_PRINTER_CONFIDENCE = 0.9;
const MDNS_PRINTER_VENDOR_CONFIDENCE = 0.9; // usb_MFG è auto-dichiarato dal device, come i header HTTP
const MDNS_HAP_CONFIDENCE = 0.75;
// _hap._tcp presente ma senza TXT "ci=" (categoria HomeKit): sappiamo solo che
// e' un accessorio HomeKit generico, non il tipo -> iot.other a confidence media.
const MDNS_HAP_UNSPECIFIED_CONFIDENCE = 0.6;
const MDNS_AV_DISPLAY_CONFIDENCE = 0.7;
// _device-info._tcp è un servizio Bonjour Apple, ma il suo "model=" è
// storicamente spoofato da NAS/Netatalk (Synology/QNAP/TrueNAS) per mostrare
// un'icona "Mac" in Finder durante Time Machine (es. "model=Xserve1,1" su un
// NAS non-Apple): confidence volutamente bassa, questa evidenza da sola non
// può mai superare MIN_CLAIM_SCORE (0.56) nella fusione pesata.
const MDNS_DEVICE_INFO_MODEL_VENDOR_CONFIDENCE = 0.35;
// Il *nome* del servizio mDNS annuncia spesso il vendor direttamente
// (es. "_qdiscover._tcp" e' un protocollo proprietario QNAP, "_sonos" idem):
// stesso livello di fiducia degli altri banner auto-dichiarati (Server HTTP).
const MDNS_SERVICE_VENDOR_CONFIDENCE = 0.85;
const MDNS_QDISCOVER_NAS_CONFIDENCE = 0.8;
const MDNS_AXIS_CAMERA_CONFIDENCE = 0.85;
// _adisk/_afpovertcp/_smb insieme a un servizio di "presenza" (_device-info o
// _http, tipici delle web-UI di gestione dei NAS) -> il device espone share
// di rete E si amministra via HTTP: pattern NAS. _smb da solo NON basta (lo
// espone anche una workstation Windows), vedi MDNS_COMPUTE_CONFIDENCE sotto.
const MDNS_NAS_SHARE_CONFIDENCE = 0.6;
const MDNS_COMPUTE_CONFIDENCE = 0.5;

// Apple HomeKit Accessory Categories (mappa ufficiale, solo le voci con un
// corrispettivo di tassonomia utile qui): 2 (bridge) e 5 (illuminazione) sono
// deliberatamente esclude — un bridge HomeKit non dice nulla sul tipo di
// dispositivo fisico, e non esiste una foglia "iot.light" nella tassonomia.
const HAP_CATEGORY_TO_TAXONOMY: Record<number, string> = {
  9: "iot.thermostat",
  17: "av.camera",
  31: "av.display", // Television
  33: "network.router", // Wi-Fi Router
  34: "av.speaker", // Audio Receiver
  35: "av.display", // TV Set Top Box
  36: "av.display", // TV Streaming Stick
};

/**
 * Da un `MdnsFinding` deriva le evidenze: stampanti via `_ipp`/`_printer`/
 * `_pdl-datastream` (+ vendor/modello da usb_MFG/usb_MDL, anche con `_hp`),
 * vendor dal *nome del servizio* stesso (`_qdiscover`→qnap, `_sonos`→sonos,
 * `_axis`→axis+av.camera), condivisione file NAS via `_adisk`/`_afpovertcp`/
 * `_smb` insieme a un segnale di presenza (`_device-info`/`_http`) — `_smb`
 * da solo è troppo generico (Windows lo espone) e degrada a `compute`,
 * `_workstation` da solo → `compute`, categoria HomeKit via `ci=` di `_hap`
 * (o `iot.other` generico se `ci=` manca), display via `_airplay`/
 * `_googlecast`/`_raop`, vendor Apple (a bassa confidence) via `model=` di
 * `_device-info`. `_sftp-ssh`/`_ssh` deliberatamente ignorati: troppo generici
 * per dire alcunché sulla categoria del device.
 */
export function evidenceFromMdns(f: MdnsFinding): EvidenceInput[] {
  const expires_at = expiresAt();
  const services = f.services.map((s) => s.toLowerCase());
  const hasService = (needle: string) => services.some((s) => s.includes(needle));
  const out: EvidenceInput[] = [];

  const isPrinterService =
    hasService("_ipp._tcp") || hasService("_pdl-datastream._tcp") || hasService("_printer._tcp");
  if (isPrinterService) {
    out.push({
      source: "mdns", phase: "scan_naabu", dimension: "category",
      claim: "peripheral.printer", confidence: MDNS_PRINTER_CONFIDENCE, raw_value: null, expires_at,
    });
  }
  if ((isPrinterService || hasService("_hp._tcp")) && f.usbMfg) {
    const raw = [f.usbMfg, f.usbMdl].filter(Boolean).join(" ") || null;
    out.push({
      source: "mdns", phase: "scan_naabu", dimension: "vendor",
      claim: vendorSlug(f.usbMfg), confidence: MDNS_PRINTER_VENDOR_CONFIDENCE, raw_value: raw, expires_at,
    });
  }

  if (hasService("_qdiscover")) {
    out.push({
      source: "mdns", phase: "scan_naabu", dimension: "vendor",
      claim: "qnap", confidence: MDNS_SERVICE_VENDOR_CONFIDENCE, raw_value: null, expires_at,
    });
    out.push({
      source: "mdns", phase: "scan_naabu", dimension: "category",
      claim: "storage.nas", confidence: MDNS_QDISCOVER_NAS_CONFIDENCE, raw_value: null, expires_at,
    });
  }

  if (hasService("_sonos")) {
    out.push({
      source: "mdns", phase: "scan_naabu", dimension: "vendor",
      claim: "sonos", confidence: MDNS_SERVICE_VENDOR_CONFIDENCE, raw_value: null, expires_at,
    });
  }

  if (hasService("_axis")) {
    out.push({
      source: "mdns", phase: "scan_naabu", dimension: "vendor",
      claim: "axis", confidence: MDNS_AXIS_CAMERA_CONFIDENCE, raw_value: null, expires_at,
    });
    out.push({
      source: "mdns", phase: "scan_naabu", dimension: "category",
      claim: "av.camera", confidence: MDNS_AXIS_CAMERA_CONFIDENCE, raw_value: null, expires_at,
    });
  }

  const hasNasShareService =
    hasService("_adisk._tcp") || hasService("_afpovertcp._tcp") || hasService("_smb._tcp");
  const hasNasPresenceSignal = hasService("_device-info._tcp") || hasService("_http._tcp");
  if (hasNasShareService && hasNasPresenceSignal) {
    out.push({
      source: "mdns", phase: "scan_naabu", dimension: "category",
      claim: "storage.nas", confidence: MDNS_NAS_SHARE_CONFIDENCE, raw_value: null, expires_at,
    });
  } else if (hasService("_smb._tcp")) {
    out.push({
      source: "mdns", phase: "scan_naabu", dimension: "category",
      claim: "compute", confidence: MDNS_COMPUTE_CONFIDENCE, raw_value: null, expires_at,
    });
  }

  if (hasService("_workstation._tcp")) {
    out.push({
      source: "mdns", phase: "scan_naabu", dimension: "category",
      claim: "compute", confidence: MDNS_COMPUTE_CONFIDENCE, raw_value: null, expires_at,
    });
  }

  if (hasService("_hap._tcp")) {
    if (f.hapCategory != null) {
      const category = HAP_CATEGORY_TO_TAXONOMY[f.hapCategory];
      if (category) {
        out.push({
          source: "mdns", phase: "scan_naabu", dimension: "category",
          claim: category, confidence: MDNS_HAP_CONFIDENCE, raw_value: String(f.hapCategory), expires_at,
        });
      }
    } else {
      out.push({
        source: "mdns", phase: "scan_naabu", dimension: "category",
        claim: "iot.other", confidence: MDNS_HAP_UNSPECIFIED_CONFIDENCE, raw_value: null, expires_at,
      });
    }
  }

  if (hasService("_airplay._tcp") || hasService("_googlecast._tcp") || hasService("_raop._tcp")) {
    out.push({
      source: "mdns", phase: "scan_naabu", dimension: "category",
      claim: "av.display", confidence: MDNS_AV_DISPLAY_CONFIDENCE, raw_value: null, expires_at,
    });
  }

  if (f.model) {
    out.push({
      source: "mdns", phase: "scan_naabu", dimension: "vendor",
      claim: vendorSlug("Apple"), confidence: MDNS_DEVICE_INFO_MODEL_VENDOR_CONFIDENCE, raw_value: f.model, expires_at,
    });
  }

  return dedupeAndValidate(out);
}

// ---------------------------------------------------------------------------
// SSDP/UPnP (fase 3 Task 3)
// ---------------------------------------------------------------------------

interface SsdpDeviceTypeRule {
  re: RegExp;
  category: string;
  confidence: number;
}

// deviceType e' l'URN UPnP standard (es. "urn:schemas-upnp-org:device:WLANAccessPointDevice:1"):
// match per sottostringa, ordine non critico perche' le famiglie non si sovrappongono.
const SSDP_DEVICE_TYPE_RULES: SsdpDeviceTypeRule[] = [
  { re: /WLANAccessPointDevice/i, category: "network.access_point", confidence: 0.85 },
  { re: /InternetGatewayDevice/i, category: "network.router", confidence: 0.8 },
  { re: /MediaRenderer/i, category: "av.display", confidence: 0.7 },
  { re: /Printer/i, category: "peripheral.printer", confidence: 0.85 },
];

// manufacturer/modelName sono auto-dichiarati dal device nell'XML UPnP (come il
// Server header HTTP): confidence allineata al peso base della sorgente ssdp
// in weights.ts (0.75), non e' una conferma indipendente forte come SNMP.
const SSDP_MANUFACTURER_VENDOR_CONFIDENCE = 0.75;

interface SsdpServerRule {
  re: RegExp;
  vendorRaw?: string;
  vendorConfidence?: number;
  category?: string;
  categoryConfidence?: number;
}

// Il campo `server` della risposta M-SEARCH (es. "Synology/DSM/7.2.1",
// "Linux UPnP/1.0 MikroTik/7.11") e' un banner auto-dichiarato allo stesso
// titolo del Server header HTTP: molti device NAS/router/AV rispondono a SSDP
// pur non esponendo un XML di descrizione (LOCATION assente o non raggiungibile,
// vedi evidenza reale rete 192.168.40.0/24), quindi ignorarlo butta via l'unico
// segnale disponibile in quei casi. Ordine non critico: le famiglie non si
// sovrappongono (nessun banner reale contiene sia "synology" che "qnap").
const SSDP_SERVER_RULES: SsdpServerRule[] = [
  { re: /synology|dsm/i, vendorRaw: "Synology", vendorConfidence: 0.85, category: "storage.nas", categoryConfidence: 0.85 },
  { re: /qnap|qts/i, vendorRaw: "QNAP", vendorConfidence: 0.85, category: "storage.nas", categoryConfidence: 0.85 },
  { re: /mikrotik|routeros/i, vendorRaw: "MikroTik", vendorConfidence: 0.8, category: "network.router", categoryConfidence: 0.8 },
  { re: /ubiquiti|unifi/i, vendorRaw: "Ubiquiti", vendorConfidence: 0.75 },
  { re: /asuswrt|asus/i, vendorRaw: "Asus", vendorConfidence: 0.75, category: "network.router", categoryConfidence: 0.75 },
  { re: /sonos/i, vendorRaw: "Sonos", vendorConfidence: 0.85, category: "av.speaker", categoryConfidence: 0.85 },
  { re: /roku|chromecast|smarttv|samsung|lg/i, category: "av.display", categoryConfidence: 0.75 },
  { re: /brother|epson|canon|\bhp\b/i, category: "peripheral.printer", categoryConfidence: 0.8 },
];

/**
 * Da un `SsdpFinding` (M-SEARCH + eventuale GET dell'XML device riusciti)
 * deriva le evidenze: vendor da `manufacturer`/`modelName`, categoria da
 * `deviceType` (spec Task 3), vendor/categoria dal banner `server` (spec
 * Task "probe rete reale" — l'XML di descrizione spesso non arriva, es. NAS
 * che rispondono al solo M-SEARCH senza LOCATION valido).
 */
export function evidenceFromSsdp(f: SsdpFinding): EvidenceInput[] {
  const expires_at = expiresAt();
  const out: EvidenceInput[] = [];

  if (f.manufacturer) {
    const raw = [f.manufacturer, f.modelName].filter(Boolean).join(" ") || null;
    out.push({
      source: "ssdp", phase: "scan_naabu", dimension: "vendor",
      claim: vendorSlug(f.manufacturer), confidence: SSDP_MANUFACTURER_VENDOR_CONFIDENCE, raw_value: raw, expires_at,
    });
  }

  if (f.deviceType) {
    for (const rule of SSDP_DEVICE_TYPE_RULES) {
      if (!rule.re.test(f.deviceType)) continue;
      out.push({
        source: "ssdp", phase: "scan_naabu", dimension: "category",
        claim: rule.category, confidence: rule.confidence, raw_value: f.deviceType, expires_at,
      });
      break; // primo match vince
    }
  }

  if (f.server) {
    for (const rule of SSDP_SERVER_RULES) {
      if (!rule.re.test(f.server)) continue;
      if (rule.vendorRaw) {
        out.push({
          source: "ssdp", phase: "scan_naabu", dimension: "vendor",
          claim: vendorSlug(rule.vendorRaw), confidence: rule.vendorConfidence ?? SSDP_MANUFACTURER_VENDOR_CONFIDENCE,
          raw_value: f.server, expires_at,
        });
      }
      if (rule.category) {
        out.push({
          source: "ssdp", phase: "scan_naabu", dimension: "category",
          claim: rule.category, confidence: rule.categoryConfidence ?? SSDP_MANUFACTURER_VENDOR_CONFIDENCE,
          raw_value: f.server, expires_at,
        });
      }
      break; // primo match vince
    }
  }

  return dedupeAndValidate(out);
}

// ---------------------------------------------------------------------------
// WS-Discovery (fase 3 Task 3) — `wsd` e' gia' in `AUTHORITATIVE_SOURCES.category`
// (weights.ts): l'evidenza category diventa dichiarativa e salta la somma
// pesata. Per questo NON emettiamo mai un claim category debole/ambiguo: se i
// Types non sono riconosciuti con certezza, nessuna evidenza per quella
// dimensione (spec Task 3).
// ---------------------------------------------------------------------------

const WSD_CAMERA_CONFIDENCE = 0.95; // ONVIF NetworkVideoTransmitter: gia' autoritativa, la confidence alta e' voluta
const WSD_PRINTER_CONFIDENCE = 0.9;
const WSD_COMPUTE_CONFIDENCE = 0.5; // "Device"+"Computer" da soli non distinguono server/workstation

/**
 * Il nome locale di un QName WS-Discovery (es. "wsdp:Device" → "Device",
 * "dp0:NetworkVideoTransmitter" → "NetworkVideoTransmitter"): i prefissi
 * variano per implementazione (vedi commento di testa wsd.ts), il tipo reale
 * e' sempre la parte dopo l'ultimo ":".
 */
function wsdLocalName(qname: string): string {
  const idx = qname.lastIndexOf(":");
  return idx === -1 ? qname : qname.slice(idx + 1);
}

/**
 * Da un `WsdFinding` (Probe SOAP riuscito) deriva l'evidenza di categoria:
 * `NetworkVideoTransmitter` → av.camera (autoritativa), `PrintDeviceType`/
 * `PrinterServiceType` → peripheral.printer, `Computer` (da solo, anche senza
 * `Device`) → compute. `Device` da solo resta troppo generico e non produce
 * evidenza. Confronto per **nome locale esatto** dopo aver scartato il
 * prefisso di namespace (mai per sottostringa: eviterebbe falsi positivi tipo
 * un ipotetico "MyNetworkVideoTransmitterExtended"). Un solo claim category
 * per finding: le famiglie sono mutuamente esclusive per un device reale, e
 * priorita' esplicita evita ambiguita' se i Types elencano piu' tipi.
 */
export function evidenceFromWsd(f: WsdFinding): EvidenceInput[] {
  const expires_at = expiresAt();
  const localNames = new Set(f.types.map(wsdLocalName));
  const typesBlob = f.types.join(" ");
  const out: EvidenceInput[] = [];

  if (localNames.has("NetworkVideoTransmitter")) {
    out.push({
      source: "wsd", phase: "scan_naabu", dimension: "category",
      claim: "av.camera", confidence: WSD_CAMERA_CONFIDENCE, raw_value: typesBlob, expires_at,
    });
  } else if (localNames.has("PrintDeviceType") || localNames.has("PrinterServiceType")) {
    out.push({
      source: "wsd", phase: "scan_naabu", dimension: "category",
      claim: "peripheral.printer", confidence: WSD_PRINTER_CONFIDENCE, raw_value: typesBlob, expires_at,
    });
  } else if (localNames.has("Computer")) {
    out.push({
      source: "wsd", phase: "scan_naabu", dimension: "category",
      claim: "compute", confidence: WSD_COMPUTE_CONFIDENCE, raw_value: typesBlob, expires_at,
    });
  }

  return dedupeAndValidate(out);
}

// ---------------------------------------------------------------------------
// Redfish detect (Fase 4b Task 1) — rilevazione BMC senza credenziali, aggancio
// ai probe passivi della Fase 3 (host con 443/8443 aperte). La conferma piena
// con credenziali (`redfishEvidence` in src/lib/protocols/redfish.ts, fase
// credential_validate, 0.95 autoritativa) resta separata: qui e' solo un
// segnale debole, coerente con lo stesso pattern degli altri probe passivi.
// ---------------------------------------------------------------------------

const REDFISH_DETECT_CATEGORY_CONFIDENCE = 0.9;

/**
 * Da un `RedfishDetectResult` (GET anonimo su `/redfish/v1/` riuscito): un BMC
 * che risponde e' per definizione un server -> `category=compute.server` anche
 * senza credenziali. Nessuna evidenza vendor qui: il vendor confermato via
 * credenziali arriva da `redfishEvidence` a confidence piu' alta; `vendorHint`
 * resta solo nel `raw_value` come traccia diagnostica.
 */
export function evidenceFromRedfishDetect(f: RedfishDetectResult): EvidenceInput[] {
  if (!f.present) return [];
  return [
    {
      source: "redfish", phase: "scan_naabu", dimension: "category",
      claim: "compute.server", confidence: REDFISH_DETECT_CATEGORY_CONFIDENCE,
      raw_value: f.vendorHint, expires_at: expiresAt(),
    },
  ];
}
