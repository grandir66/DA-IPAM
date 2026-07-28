// src/lib/attribution/emitters.ts
// Emettitori fase 1 (spec §9): SOLO segnali già in DB, zero probe nuovi.
import { classifyDevice } from "@/lib/device-classifier";
import { lookupSysObjectId } from "@/lib/scanner/snmp-sysobj-lookup";
import { mapSysObjCategory } from "@/lib/attribution/sysobj-category";
import { kbLookupSysObjectId } from "./kb";
import type { KbSysObjMatch } from "./kb";
import { categoryDepth, mapLegacyClassification } from "./taxonomy";
import type { CategorySlug } from "./taxonomy";
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
  // Caso reale 192.168.40.23/.26 (VM 533, tenant 70791): OUI risolve "Synology
  // Incorporated"/"QNAP Systems, Inc." mentre SSDP/mDNS producono "synology"/
  // "qnap" — senza alias i voti si spaccano tra fonti e nessun claim supera soglia.
  "synology-incorporated": "synology",
  "qnap-systems": "qnap",
  "proxmox-server-solutions": "proxmox",
  "ubiquiti-inc": "ubiquiti",
  "belkin-international": "belkin",
  "vmware-inc": "vmware",
};

/**
 * "Ubiquiti Inc" → "ubiquiti"; "Hewlett Packard Enterprise" → "hpe" (via ALIAS).
 * Lo strip dei suffissi societari è a SINGOLA passata (un solo `.replace`,
 * niente loop): rimuove solo l'ULTIMO token societario, non incatena più
 * suffissi in un colpo solo ("QNAP Systems, Inc." → "QNAP Systems", non
 * "QNAP"). Le forme con più suffissi societari residui vanno unificate via
 * ALIAS (vedi sopra) — è la regex stessa a garantire che uno strip non riduca
 * mai la stringa a vuoto: richiede sempre uno spazio prima del suffisso, quindi
 * un nome di UNA sola parola (anche se coincide con un suffisso, es. "Systems"
 * da solo) non viene mai toccato.
 */
export function vendorSlug(name: string): string {
  const slug = name.trim().toLowerCase()
    .replace(/,?\s+(inc|ltd|llc|gmbh|s\.?p\.?a\.?|s\.?r\.?l\.?|co|corp|corporation|technologies|technology|solutions|holdings|group|electronics|international|industries|networks?|communications|incorporated|systems)\.?$/i, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return ALIAS[slug] ?? slug;
}

// Lacuna 1 (fase produzione): MAC di NIC virtuali — il vendor OUI è quello
// dell'hypervisor, non un "produttore" fisico. Match per sostringa (spec: "contiene").
const HYPERVISOR_VENDOR_RE = /proxmox|vmware|qemu|xensource|virtualbox|oracle virtualbox|hyper-v|parallels|nutanix/i;

// Lacuna 2: voci placeholder del registro IEEE (nessun produttore reale dietro il
// MAC, es. locally-administered/random) — match esatto (dopo trim), non sostringa.
// Estesa (caso reale 192.168.40.23, Synology): il lookup sysObjectID net-snmp
// generico (OID 1.3.6.1.4.1.8072.*) restituisce vendor "Linux", che NON è un
// produttore — vero per NAS, router, qualunque host Linux con net-snmp attivo.
const VENDOR_PLACEHOLDER_RE = /^(ieee registration authority|private|linux|unknown|generic|net-snmp|netsnmp|n\/a|other)$/i;

// OID net-snmp generico (Lacuna 2): significa solo "gira net-snmp", vero per NAS,
// router, qualunque Linux — non basta a inferire una categoria device.
const GENERIC_NETSNMP_OID_RE = /^1\.3\.6\.1\.4\.1\.8072\./;

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

/** Normalizzazione della LOOKUP_TABLE builtin allo stesso shape della KB, per il merge. */
interface BuiltinSysObjMatch {
  vendor: string;
  product: string | null;
  category: CategorySlug | null;
}

/**
 * Combina KB (9.554 voci GLPI) e LOOKUP_TABLE builtin (94 voci curate a mano)
 * per un match sysObjectID, invece di far vincere una sola fonte:
 * - **vendor/modello**: preferisci la KB (molto più ricca), fallback alla builtin.
 * - **categoria**: la PIÙ PROFONDA fra le due (`categoryDepth`, taxonomy.ts) —
 *   la KB deriva la categoria dal solo TYPE GLPI (per gli apparati di rete è
 *   sempre "NETWORKING" → livello 1 "network"), mentre la builtin distingue
 *   spesso router/switch/access_point (livello 2). A parità di profondità
 *   vince la builtin (curata a mano). Se solo una fonte ha una categoria, si
 *   usa quella. Caso guida (regressione): OID 1.3.6.1.4.1.41112.1.6 con SOLO
 *   sysObjectID (niente sysDescr) → deve restare "network.access_point", non
 *   degradare a "network" solo perché la KB matcha anch'essa l'OID.
 */
export function mergeSysObjSources(
  kbMatch: KbSysObjMatch | null,
  builtinMatch: BuiltinSysObjMatch | null
): { vendor: string | null; product: string | null; category: CategorySlug | null } {
  const vendor = kbMatch?.vendor ?? builtinMatch?.vendor ?? null;
  const product = kbMatch?.model ?? builtinMatch?.product ?? null;

  const kbCategory = kbMatch?.category ?? null;
  const builtinCategory = builtinMatch?.category ?? null;
  let category: CategorySlug | null;
  if (kbCategory && builtinCategory) {
    category = categoryDepth(builtinCategory) >= categoryDepth(kbCategory) ? builtinCategory : kbCategory;
  } else {
    category = kbCategory ?? builtinCategory;
  }

  return { vendor, product, category };
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

  // 2. SNMP: sysObjectID via KB (9.554 entry GLPI) COMBINATA con la LOOKUP_TABLE
  //    builtin (94 entry, curate a mano con distinzione switch/router/AP che la
  //    KB — TYPE GLPI "NETWORKING" — non offre da sola, livello 1 soltanto):
  //    vendor/modello dalla KB (fallback builtin), categoria la più profonda fra
  //    le due (mergeSysObjSources) — mai una fonte sola "vince" a prescindere,
  //    altrimenti si perde la profondità nota alla builtin (regressione Ubiquiti,
  //    vedi commento su mergeSysObjSources) + sysDescr (incl. Ubiquiti).
  const snmp = safeJson<{ sysDescr?: string | null; sysObjectID?: string | null; manufacturer?: string | null }>(host.snmp_data);
  if (snmp?.sysObjectID) {
    const kbMatch = kbLookupSysObjectId(snmp.sysObjectID);
    const legacyMatch = lookupSysObjectId(snmp.sysObjectID);
    const builtinMatch: BuiltinSysObjMatch | null = legacyMatch
      ? {
          vendor: legacyMatch.vendor,
          product: legacyMatch.product ?? null,
          category: mapSysObjCategory(legacyMatch)
            ? (mapLegacyClassification(mapSysObjCategory(legacyMatch)!).category ?? null)
            : null,
        }
      : null;
    const { vendor, product, category } = mergeSysObjSources(kbMatch, builtinMatch);

    if (vendor) {
      // Match generico (OID net-snmp 1.3.6.1.4.1.8072.* OPPURE vendor/product
      // che matcha il filtro placeholder, es. vendor "Linux"): non è un
      // produttore identificabile né una categoria device — niente vendor,
      // niente categoria. Lascia parlare sysDescr e gli altri segnali.
      const generic = GENERIC_NETSNMP_OID_RE.test(snmp.sysObjectID.trim())
        || VENDOR_PLACEHOLDER_RE.test(vendor.trim())
        || (product ? VENDOR_PLACEHOLDER_RE.test(product.trim()) : false);
      if (!VENDOR_PLACEHOLDER_RE.test(vendor.trim())) {
        out.push({
          source: "snmp_sysobj", phase: "scan_snmp_verify", dimension: "vendor",
          claim: vendorSlug(vendor), confidence: 0.95, raw_value: vendor,
        });
      }
      if (!generic && category) {
        out.push({
          source: "snmp_sysobj", phase: "scan_snmp_verify", dimension: "category",
          claim: category, confidence: 0.95,
          raw_value: product ? `${snmp.sysObjectID} → ${product}` : snmp.sysObjectID,
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
