// src/lib/attribution/emitters.ts
// Emettitori fase 1 (spec §9): SOLO segnali già in DB, zero probe nuovi.
import { classifyDevice } from "@/lib/device-classifier";
import { lookupSysObjectId } from "@/lib/scanner/snmp-sysobj-lookup";
import { mapSysObjCategory } from "@/lib/attribution/sysobj-category";
import { mapLegacyClassification } from "./taxonomy";
import type { AttributionSource, EvidenceInput } from "./types";

/**
 * Sorgenti che `emitEvidenceFromSignals` ricalcola INTEGRALMENTE ad ogni chiamata
 * (dato il set di segnali, l'insieme di evidenze emesse da queste sorgenti è
 * deterministico e completo). Usata da `retireStaleEvidence` per capire quali
 * evidenze attive possono essere ritirate quando l'emettitore smette di riprodurle.
 * ESCLUSE deliberatamente: `manual` (mai automatico) e `inv_agent` (arriva da un
 * flusso diverso, non da questo emettitore — ritirarla qui la farebbe sparire ad
 * ogni recompute anche se l'agente è ancora presente).
 */
export const RECOMPUTED_SOURCES = [
  "oui", "snmp_sysobj", "snmp_sysdescr", "nmap_os", "hostname", "ports", "ad", "wazuh", "lldp", "cdp",
] as const satisfies readonly AttributionSource[];

export interface AttributionSignals {
  host: {
    id: number; ip: string; mac: string | null; vendor: string | null;
    hostname: string | null; os_info: string | null; open_ports: string | null;
    snmp_data: string | null; detection_json: string | null;
  };
  adComputer: { operating_system: string | null; operating_system_version: string | null } | null;
  wazuh: { os_platform: string | null; os_name: string | null; os_version: string | null; board_vendor: string | null } | null;
  neighborSightings: Array<{ protocol: string; remote_platform: string | null; remote_device_name: string }>;
}

/**
 * Alias di normalizzazione finale: varianti note dello stesso vendor che la sola
 * pulizia suffissi/punteggiatura non unifica (nomi registro OUI non standard,
 * o abbreviazioni SNMP diverse) — altrimenti i voti si spaccano tra fonti
 * (OUI vs SNMP sysObjectID vs Wazuh board_vendor) e nessun claim supera soglia.
 */
const ALIAS: Record<string, string> = {
  "routerboard-com": "mikrotik",
  "routerboard": "mikrotik",
  "ubiquiti-networks": "ubiquiti",
  "hewlett-packard": "hpe",
  "hewlett-packard-enterprise": "hpe",
};

/** "Ubiquiti Inc" → "ubiquiti"; "Hewlett Packard Enterprise" → "hpe" (via ALIAS) */
export function vendorSlug(name: string): string {
  const slug = name.trim().toLowerCase()
    .replace(/,?\s+(inc|ltd|llc|gmbh|s\.?p\.?a\.?|s\.?r\.?l\.?|co|corp|corporation|technologies|technology|networks)\.?$/i, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return ALIAS[slug] ?? slug;
}

// Lacuna 1 (fase produzione): MAC di NIC virtuali — il vendor OUI è quello
// dell'hypervisor, non un "produttore" fisico. Match per sostringa (spec: "contiene").
const HYPERVISOR_VENDOR_RE = /proxmox|vmware|qemu|xensource|virtualbox|oracle virtualbox|hyper-v|parallels|nutanix/i;

// Lacuna 2: voci placeholder del registro IEEE (nessun produttore reale dietro il
// MAC, es. locally-administered/random) — match esatto (dopo trim), non sostringa.
const VENDOR_PLACEHOLDER_RE = /^(ieee registration authority|private)$/i;

// Caso Ubiquiti (nota Fase 0 della spec): il modello nel sysDescr distingue AP/switch/router
const UBNT_AP = /\b(U[67][A-Z0-9-]*|UAP[A-Z0-9-]*|UA-[A-Z0-9-]*)\b/i;
const UBNT_SW = /\b(USW[A-Z0-9-]*|US-\d[A-Z0-9-]*|USL\d*|UniFi\s*Switch)\b/i;
const UBNT_GW = /\b(USG[A-Z0-9-]*|UXG[A-Z0-9-]*|UDM[A-Z0-9-]*|UDR|EdgeRouter|ER-[A-Z0-9]+)\b/i;

const OS_PLATFORM_FAMILY: Record<string, string> = {
  windows: "windows", darwin: "macos", macos: "macos",
  ubuntu: "linux", debian: "linux", centos: "linux", rhel: "linux",
  rocky: "linux", alma: "linux", suse: "linux", fedora: "linux", alpine: "linux",
};

function osFamilyFromText(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("windows")) return "windows";
  if (t.includes("mac os") || t.includes("macos") || t.includes("os x")) return "macos";
  if (t.includes("linux") || t.includes("ubuntu") || t.includes("debian") || t.includes("centos")) return "linux";
  if (t.includes("routeros") || t.includes("ios") || t.includes("junos") || t.includes("edgeos") || t.includes("vyos")) return "network-os";
  return null;
}

function safeJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function categoryFromLegacyText(input: Parameters<typeof classifyDevice>[0]): string | null {
  const legacy = classifyDevice(input);
  if (!legacy || legacy === "unknown") return null;
  return mapLegacyClassification(legacy).category;
}

export function emitEvidenceFromSignals(signals: AttributionSignals): EvidenceInput[] {
  const out: EvidenceInput[] = [];
  const { host } = signals;

  // 1. Vendor da OUI: hosts.vendor è già la risoluzione OUI del MAC (lookupVendorSync
  //    a scan-time). Non rifacciamo il lookup: emettiamo il dato persistito.
  //    - NIC virtuale (hypervisor noto nel vendor OUI) → emettiamo ANCHE la categoria
  //      compute.vm (oltre al vendor: utile sapere quale hypervisor la ospita).
  //    - Vendor placeholder del registro (IEEE Registration Authority / Private) →
  //      non è un produttore: niente evidenza vendor.
  if (host.vendor) {
    if (HYPERVISOR_VENDOR_RE.test(host.vendor)) {
      out.push({
        source: "oui", phase: "scan_icmp", dimension: "category",
        claim: "compute.vm", confidence: 0.85, raw_value: host.vendor,
      });
    }
    if (!VENDOR_PLACEHOLDER_RE.test(host.vendor.trim())) {
      out.push({
        source: "oui", phase: "scan_icmp", dimension: "vendor",
        claim: vendorSlug(host.vendor), confidence: 0.9, raw_value: host.vendor,
      });
    }
  }

  // 2. SNMP: sysObjectID via KB + sysDescr (incl. caso Ubiquiti)
  const snmp = safeJson<{ sysDescr?: string | null; sysObjectID?: string | null; manufacturer?: string | null }>(host.snmp_data);
  if (snmp?.sysObjectID) {
    const match = lookupSysObjectId(snmp.sysObjectID);
    if (match) {
      out.push({
        source: "snmp_sysobj", phase: "scan_snmp_verify", dimension: "vendor",
        claim: vendorSlug(match.vendor), confidence: 0.95, raw_value: match.vendor,
      });
      const legacyCat = mapSysObjCategory(match);
      const cat = legacyCat ? mapLegacyClassification(legacyCat).category : null;
      if (cat) {
        out.push({
          source: "snmp_sysobj", phase: "scan_snmp_verify", dimension: "category",
          claim: cat, confidence: 0.95, raw_value: `${snmp.sysObjectID} → ${match.product}`,
        });
      }
    }
  }
  if (snmp?.sysDescr) {
    const d = snmp.sysDescr;
    let ubntCat: string | null = null;
    if (UBNT_SW.test(d)) ubntCat = "network.switch";
    else if (UBNT_AP.test(d)) ubntCat = "network.access_point";
    else if (UBNT_GW.test(d)) ubntCat = "network.router";
    if (ubntCat) {
      out.push({ source: "snmp_sysdescr", phase: "scan_snmp_verify", dimension: "category", claim: ubntCat, confidence: 0.9, raw_value: d.slice(0, 200) });
    } else {
      const cat = categoryFromLegacyText({ sysDescr: d });
      if (cat) out.push({ source: "snmp_sysdescr", phase: "scan_snmp_verify", dimension: "category", claim: cat, confidence: 0.75, raw_value: d.slice(0, 200) });
    }
    const osFam = osFamilyFromText(d);
    if (osFam) out.push({ source: "snmp_sysdescr", phase: "scan_snmp_verify", dimension: "os", claim: osFam, confidence: 0.7, raw_value: d.slice(0, 200) });
  }

  // 3. os_info (nmap/altro)
  if (host.os_info) {
    const fam = osFamilyFromText(host.os_info);
    if (fam) out.push({ source: "nmap_os", phase: "scan_nmap_base", dimension: "os", claim: fam, confidence: 0.7, raw_value: host.os_info.slice(0, 200) });
  }

  // 4. hostname (debole)
  if (host.hostname) {
    const cat = categoryFromLegacyText({ hostname: host.hostname });
    if (cat) out.push({ source: "hostname", phase: "scan_icmp", dimension: "category", claim: cat, confidence: 0.5, raw_value: host.hostname });
  }

  // 5. porte aperte (debole)
  const ports = safeJson<Array<{ port: number }>>(host.open_ports);
  if (ports && ports.length > 0) {
    const cat = categoryFromLegacyText({ openPorts: ports });
    if (cat) out.push({ source: "ports", phase: "scan_naabu", dimension: "category", claim: cat, confidence: 0.5, raw_value: ports.map((p) => p.port).join(",") });
  }

  // 6. AD — autoritativo su OS (spec §4.3 punto 4)
  const ados = signals.adComputer?.operating_system;
  if (ados) {
    out.push({ source: "ad", phase: "integration", dimension: "os", claim: osFamilyFromText(ados) ?? "windows", confidence: 0.95, raw_value: ados });
    out.push({
      source: "ad", phase: "integration", dimension: "category",
      claim: ados.toLowerCase().includes("server") ? "compute.server" : "compute.workstation",
      confidence: 0.85, raw_value: ados,
    });
  }

  // 7. Wazuh — autoritativo su OS; l'agente implica compute.*
  const wz = signals.wazuh; // narrowing esplicito: l'optional chaining nella condizione non basta a TS
  if (wz && (wz.os_platform || wz.os_name)) {
    const plat = (wz.os_platform ?? "").toLowerCase();
    const fam = OS_PLATFORM_FAMILY[plat] ?? osFamilyFromText(wz.os_name ?? "") ?? (plat ? "linux" : null);
    const rawOs = [wz.os_name, wz.os_version].filter(Boolean).join(" ") || null;
    if (fam) out.push({ source: "wazuh", phase: "integration", dimension: "os", claim: fam, confidence: 0.95, raw_value: rawOs });
    out.push({ source: "wazuh", phase: "integration", dimension: "category", claim: "compute", confidence: 0.6, raw_value: "agente Wazuh presente" });
    if (wz.board_vendor) {
      out.push({ source: "wazuh", phase: "integration", dimension: "vendor", claim: vendorSlug(wz.board_vendor), confidence: 0.7, raw_value: wz.board_vendor });
    }
  }

  // 8. Neighbors LLDP/CDP — testuale, non autoritativo (capability bits non in DB, decisione 7)
  for (const n of signals.neighborSightings) {
    if (!n.remote_platform) continue;
    const cat = categoryFromLegacyText({ sysDescr: n.remote_platform });
    if (!cat) continue;
    const source = n.protocol === "cdp" ? "cdp" : "lldp";
    out.push({ source, phase: "integration", dimension: "category", claim: cat, confidence: 0.7, raw_value: n.remote_platform.slice(0, 200) });
    break; // un solo sighting basta: gli altri sono duplicati dello stesso vicinato
  }

  return out;
}
