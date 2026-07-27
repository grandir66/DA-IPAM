// src/lib/attribution/probe-evidence.ts
// Mappa i finding dei probe passivi (fase 3, spec §4.5) in EvidenceInput[].
// Funzioni PURE: nessuna rete, nessun accesso DB — testabili senza mock.
import type { HttpTlsFinding } from "@/lib/scanner/probes/http-tls";
import type { Smb2Finding } from "@/lib/scanner/probes/smb2";
import type { MdnsFinding } from "@/lib/scanner/probes/mdns";
import type { SsdpFinding } from "@/lib/scanner/probes/ssdp";
import type { WsdFinding } from "@/lib/scanner/probes/wsd";
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

/**
 * Da un `Smb2Finding` (NEGOTIATE + NTLMSSP NEGOTIATE anonimo riusciti) deriva
 * le evidenze: la sola risposta a NTLMSSP implica il dialetto SMB Windows,
 * quindi `os = windows` a confidence alta; la build (se letta dalla Version
 * NTLM) va in `raw_value` (diventa `os_name` in fase di fusione, vedi
 * `fuse.ts#bestRaw`). `netbiosName`/`dnsDomain` non producono evidenze qui:
 * non esiste una dimensione "hostname" nell'attribution engine v2 (solo
 * vendor/category/os) — restano nel finding per usi futuri (es. matching AD).
 */
export function evidenceFromSmb2(f: Smb2Finding): EvidenceInput[] {
  const expires_at = expiresAt();
  return dedupeAndValidate([
    {
      source: "smb", phase: "scan_naabu", dimension: "os",
      claim: "windows", confidence: SMB_OS_CONFIDENCE, raw_value: f.osVersion, expires_at,
    },
    {
      source: "smb", phase: "scan_naabu", dimension: "category",
      claim: "compute", confidence: SMB_CATEGORY_CONFIDENCE, raw_value: null, expires_at,
    },
  ]);
}

// ---------------------------------------------------------------------------
// mDNS (fase 3 Task 2)
// ---------------------------------------------------------------------------

const MDNS_PRINTER_CONFIDENCE = 0.9;
const MDNS_PRINTER_VENDOR_CONFIDENCE = 0.9; // usb_MFG è auto-dichiarato dal device, come i header HTTP
const MDNS_HAP_CONFIDENCE = 0.75;
const MDNS_AV_DISPLAY_CONFIDENCE = 0.7;
// _device-info._tcp è un servizio Bonjour Apple, ma il suo "model=" è
// storicamente spoofato da NAS/Netatalk (Synology/QNAP/TrueNAS) per mostrare
// un'icona "Mac" in Finder durante Time Machine (es. "model=Xserve1,1" su un
// NAS non-Apple): confidence volutamente bassa, questa evidenza da sola non
// può mai superare MIN_CLAIM_SCORE (0.56) nella fusione pesata.
const MDNS_DEVICE_INFO_MODEL_VENDOR_CONFIDENCE = 0.35;

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
 * Da un `MdnsFinding` deriva le evidenze: stampanti via `_ipp`/`_pdl-datastream`
 * (+ vendor/modello da usb_MFG/usb_MDL), categoria HomeKit via `ci=` di `_hap`,
 * display via `_airplay`/`_googlecast`, vendor Apple (a bassa confidence) via
 * `model=` di `_device-info`.
 */
export function evidenceFromMdns(f: MdnsFinding): EvidenceInput[] {
  const expires_at = expiresAt();
  const services = f.services.map((s) => s.toLowerCase());
  const hasService = (needle: string) => services.some((s) => s.includes(needle));
  const out: EvidenceInput[] = [];

  if (hasService("_ipp._tcp") || hasService("_pdl-datastream._tcp")) {
    out.push({
      source: "mdns", phase: "scan_naabu", dimension: "category",
      claim: "peripheral.printer", confidence: MDNS_PRINTER_CONFIDENCE, raw_value: null, expires_at,
    });
    if (f.usbMfg) {
      const raw = [f.usbMfg, f.usbMdl].filter(Boolean).join(" ") || null;
      out.push({
        source: "mdns", phase: "scan_naabu", dimension: "vendor",
        claim: vendorSlug(f.usbMfg), confidence: MDNS_PRINTER_VENDOR_CONFIDENCE, raw_value: raw, expires_at,
      });
    }
  }

  if (hasService("_hap._tcp") && f.hapCategory != null) {
    const category = HAP_CATEGORY_TO_TAXONOMY[f.hapCategory];
    if (category) {
      out.push({
        source: "mdns", phase: "scan_naabu", dimension: "category",
        claim: category, confidence: MDNS_HAP_CONFIDENCE, raw_value: String(f.hapCategory), expires_at,
      });
    }
  }

  if (hasService("_airplay._tcp") || hasService("_googlecast._tcp")) {
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

/**
 * Da un `SsdpFinding` (M-SEARCH + eventuale GET dell'XML device riusciti)
 * deriva le evidenze: vendor da `manufacturer`/`modelName`, categoria da
 * `deviceType` (spec Task 3).
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
 * Da un `WsdFinding` (Probe SOAP riuscito) deriva l'evidenza di categoria:
 * `NetworkVideoTransmitter` → av.camera, `PrintDeviceType`/`PrinterServiceType`
 * → peripheral.printer, `Device`+`Computer` (entrambi presenti) → compute.
 * Match per sottostringa sul nome locale del tipo (i prefissi QName come
 * "dn:"/"tds:" variano tra implementazioni, vedi wsd.ts). Un solo claim
 * category per finding: le famiglie sono mutuamente esclusive per un device
 * reale, e priorita' esplicita evita ambiguita' se i Types elencano piu' tipi.
 */
export function evidenceFromWsd(f: WsdFinding): EvidenceInput[] {
  const expires_at = expiresAt();
  const typesBlob = f.types.join(" ");
  const out: EvidenceInput[] = [];

  if (/NetworkVideoTransmitter/i.test(typesBlob)) {
    out.push({
      source: "wsd", phase: "scan_naabu", dimension: "category",
      claim: "av.camera", confidence: WSD_CAMERA_CONFIDENCE, raw_value: typesBlob, expires_at,
    });
  } else if (/PrintDeviceType|PrinterServiceType/i.test(typesBlob)) {
    out.push({
      source: "wsd", phase: "scan_naabu", dimension: "category",
      claim: "peripheral.printer", confidence: WSD_PRINTER_CONFIDENCE, raw_value: typesBlob, expires_at,
    });
  } else if (/\bDevice\b/i.test(typesBlob) && /\bComputer\b/i.test(typesBlob)) {
    out.push({
      source: "wsd", phase: "scan_naabu", dimension: "category",
      claim: "compute", confidence: WSD_COMPUTE_CONFIDENCE, raw_value: typesBlob, expires_at,
    });
  }

  return dedupeAndValidate(out);
}
