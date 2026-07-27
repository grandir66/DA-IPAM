// src/lib/attribution/probe-evidence.ts
// Mappa i finding dei probe passivi (fase 3, spec §4.5) in EvidenceInput[].
// Funzioni PURE: nessuna rete, nessun accesso DB — testabili senza mock.
import type { HttpTlsFinding } from "@/lib/scanner/probes/http-tls";
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
