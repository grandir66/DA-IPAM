// src/lib/attribution/emitters.ts
// Emettitori fase 1 (spec §9): SOLO segnali già in DB, zero probe nuovi.
import { classifyDevice } from "@/lib/device-classifier";
import { lookupSysObjectId } from "@/lib/scanner/snmp-sysobj-lookup";
import { mapSysObjCategory } from "@/lib/attribution/sysobj-category";
import { categoriaDaCapacita, type Annuncio } from "./annunci";
import { kbLookupSysObjectId } from "./kb";
import type { KbSysObjMatch } from "./kb";
import { matchMacProduct } from "./mac-product";
import { categoryDepth, isValidCategory, mapLegacyClassification } from "./taxonomy";
import type { CategorySlug } from "./taxonomy";
import type { GemelloDiMac } from "./gemelli";
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
  "oui", "mac_product", "snmp_sysobj", "snmp_sysdescr", "nmap_os", "hostname", "ports", "ad", "wazuh", "lldp", "cdp", "mndp", "ubnt", "mac_gemello",
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
  /** Cosa gli apparati dicono di sé (attribution/annunci.ts). Opzionale: i segnali di chi non li legge restano validi. */
  annunci?: Annuncio[];
  /** La categoria di un'altra riga con lo stesso MAC (attribution/gemelli.ts). Opzionale come gli annunci. */
  gemello?: GemelloDiMac | null;
}

/**
 * Il mestiere scritto nel testo di `-O` (06/11/2026): nmap chiude il nome con il tipo di apparato («Cisco SG200 or
 * SG300 switch»), e fino a oggi di quella riga si leggeva solo la famiglia del sistema operativo.
 */
function categoriaDaTestoNmap(testo: string): CategorySlug | null {
  if (/\(ipotesi \d+%\)/.test(testo)) return null;   // il segno lo mette scanner/profili/lettura.ts
  if (/\bswitch\b/i.test(testo)) return "network.switch";
  if (/\brouter\b/i.test(testo)) return "network.router";
  if (/\bfirewall\b/i.test(testo)) return "network.firewall";
  if (/\b(wap|access point)\b/i.test(testo)) return "network.access_point";
  if (/\bprinter\b/i.test(testo)) return "peripheral.printer";
  if (/\b(voip|ip) phone\b/i.test(testo)) return "voip.phone";
  if (/\b(webcam|ip camera)\b/i.test(testo)) return "av.camera";
  return null;
}

/** La categoria di un annuncio: prima il testo, che è specifico, poi le capacità dichiarate. */
export const CONFIDENZA_ANNUNCIO = 0.85;
/** Il modello annunciato con una sigla riconosciuta: sopra AUTHORITY_MIN_CONFIDENCE, decide la categoria. */
export const CONFIDENZA_MODELLO_ANNUNCIATO = 0.95;

/** La confidenza con cui un annuncio dice la sua categoria. */
export function confidenzaAnnuncio(a: Annuncio, categoria: string): number {
  return (a.protocollo === "mndp" || a.protocollo === "ubnt") && categoria !== "network" ? CONFIDENZA_MODELLO_ANNUNCIATO : CONFIDENZA_ANNUNCIO;
}

/**
 * MNDP e la scoperta Ubiquiti (10/11/2026) non dichiarano capacità: il mestiere si legge dal
 * modello. Sigle dei due cataloghi; dove la sigla non basta si resta su «apparato di rete».
 */
function categoriaDaModelloAnnunciato(a: Annuncio): string | null {
  const m = (a.piattaforma ?? "").trim();
  if (!m) return null;
  if (a.protocollo === "mndp") {
    if (/^(CRS|CSS|netPower|FiberBox)/i.test(m)) return "network.switch";
    if (/^(cAP|wAP|mANT|SXT|LHG|LDF|DISC|NetMetal|BaseBox|OmniTIK|Groove|QRT|DynaDish|Audience|wsAP)/i.test(m)) return "network.access_point";
    if (/^(CCR|RB|hEX|hAP|L009|CHR|PowerBox|Chateau|LtAP|KNOT)/i.test(m)) return "network.router";
    return "network";
  }
  if (a.protocollo === "ubnt") {
    if (/^(USW|US-?\d|US[A-Z]|USF|USC|USL|USM|USPM|ES-|EdgeSwitch)/i.test(m)) return "network.switch";
    if (/^(U6|U7|UAP|UAL|UWB|UK-|nanoHD|BZ2|E7|UBB|NBE|LBE|PBE|LAP|Rocket|NanoStation|LiteBeam)/i.test(m)) return "network.access_point";
    if (/^(UDM|UDR|UXG|USG|UCG|UDW|ER-|EdgeRouter|UX)/i.test(m)) return "network.router";
    return "network";
  }
  return null;
}

export function categoriaDaAnnuncio(a: Annuncio): string | null {
  const daModello = categoriaDaModelloAnnunciato(a);
  if (daModello) return daModello;
  return (a.piattaforma ? categoryFromLegacyText({ sysDescr: a.piattaforma }) : null) ?? categoriaDaCapacita(a.capacita, a.piattaforma);
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

/**
 * Produttori che fanno solo apparati di campo: qui l'OUI dice anche il tipo (72729, 04/11/2026: 30 apparati senza categoria).
 * Microchip NON è qui: è un chip montato da terzi, l'OUI non dice cosa sia l'apparato.
 */
const OUI_SOLO_OT: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bweintek\b/i, "hmi"],
  [/\bcrevis\b/i, "plc"],
  [/\bkronotech\b/i, "iot"],
  [/\bcontrol techniques\b/i, "rete_ot"],
  [/\bvacon\b/i, "rete_ot"],
  /* Non sono OT ma vale la stessa regola: fanno un solo tipo di apparato (10/11/2026,
   * hub 533: 16 Fanvil e 8 Meross senza categoria; il motore vecchio li sapeva, il
   * nuovo aveva solo `hostname` a 0.17). */
  [/\bfanvil\b/i, "voip"],
  [/\byealink\b/i, "voip"],
  [/\bmeross\b/i, "iot"],
];

// Lacuna 2: voci placeholder del registro IEEE (nessun produttore reale dietro il
// MAC, es. locally-administered/random) — match esatto (dopo trim), non sostringa.
// Estesa (caso reale 192.168.40.23, Synology): il lookup sysObjectID net-snmp
// generico (OID 1.3.6.1.4.1.8072.*) restituisce vendor "Linux", che NON è un
// produttore — vero per NAS, router, qualunque host Linux con net-snmp attivo.
// Esportata (Task 2, `refreshHostVendorsFromMac` in db-tenant.ts): riusata per
// riconoscere un vendor placeholder scritto in hosts.vendor a scan-time da una
// vecchia catena di risoluzione, senza duplicare la regex.
export const VENDOR_PLACEHOLDER_RE = /^(ieee registration authority|private|linux|unknown|generic|net-snmp|netsnmp|n\/a|other)$/i;

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
  /* ESXi e' una famiglia a se': lo dice `vmware-version` ("VMware ESXi 7.0.3")
   * e anche l'impronta di nmap su un host 443. Prima cadeva in `null` e l'host
   * restava senza famiglia pur avendo il nome giusto in `os_info`. */
  if (t.includes("esxi") || t.includes("vmware esx")) return "esxi";
  return null;
}

/**
 * Prodotti riconoscibili dalla **stringa di versione** che `-sV` mette su una porta
 * (05/11/2026, prova di Riccardo sul banco: il Proxmox dichiarava «Proxmox Virtual
 * Environment REST API 3.0» sulla 3128 e il server Windows «Microsoft Windows RPC»
 * sulla 135, e nessuno dei due aveva categoria o sistema operativo).
 *
 * È il banner che il servizio dà di sé: vale molto quando nomina il prodotto, e per
 * questo si tiene stretto — regex ancorate a nomi di prodotto, mai a parole generiche.
 * Le categorie sono slug validi della tassonomia (`taxonomy.ts`), controllati da una prova.
 */
const PRODOTTI_DA_VERSIONE: ReadonlyArray<{
  re: RegExp; vendor?: string; category?: string; os?: string; nome: string;
}> = [
  { re: /proxmox virtual environment/i, vendor: "proxmox", category: "compute.hypervisor", nome: "Proxmox VE" },
  { re: /vmware esxi/i, vendor: "vmware", category: "compute.hypervisor", os: "esxi", nome: "VMware ESXi" },
  { re: /vmware authentication daemon/i, vendor: "vmware", category: "compute.hypervisor", nome: "VMware authd" },
  { re: /\bsynology\b|diskstation/i, vendor: "synology", category: "storage.nas", nome: "Synology DSM" },
  { re: /\bqnap\b|qts\b/i, vendor: "qnap", category: "storage.nas", nome: "QNAP QTS" },
  /* RouterOS è un sistema operativo di rete, e lo dice il prodotto: senza questo `os` si
   * cadeva sul banner di un'altra porta — i quattro MikroTik dell'hub hanno «Linux telnetd»
   * sulla 23 e prendevano `linux` (scelta di Riccardo, 05/11/2026). */
  { re: /mikrotik|routeros/i, vendor: "mikrotik", category: "network.router", os: "network-os", nome: "MikroTik RouterOS" },
  { re: /jetdirect|hp ethernet multi-environment/i, vendor: "hp", category: "peripheral.printer", nome: "HP JetDirect" },
  { re: /\bilo\b|integrated lights-out/i, vendor: "hpe", nome: "HPE iLO" },
  { re: /\bidrac\b/i, vendor: "dell", nome: "Dell iDRAC" },
  { re: /microsoft windows/i, os: "windows", nome: "Microsoft Windows" },
  { re: /unifi|ubiquiti/i, vendor: "ubiquiti", nome: "Ubiquiti UniFi" },
];

/** Prodotto riconosciuto in una stringa di versione, o `null`. */
export function prodottoDaVersione(versione: string | null | undefined) {
  if (!versione) return null;
  return PRODOTTI_DA_VERSIONE.find((p) => p.re.test(versione)) ?? null;
}

/**
 * Firme (10/11/2026, misura sull'hub 533): nomi e porte che da soli dicono il tipo.
 * Sommare gli indizi deboli non serviva — su 107 host senza categoria solo 3 ne
 * avevano due concordi; gli altri avevano UN indizio, spesso certo (Winbox + API =
 * RouterOS) ma emesso a 0.15-0.17 come qualunque altro. Qui il peso è quello di
 * `nmap_service`: 0.85 x 0.7 = 0.595, sopra soglia e sotto chi parla con l'apparato.
 * Il nome «iPhone» finiva su `voip.phone` (la regola vecchia cerca «phone»): da lì
 * venivano i falsi «voip» sulla rete dei client.
 */
const PESO_FIRMA = 0.85;
const FIRME_NOME: ReadonlyArray<readonly [RegExp, CategorySlug]> = [
  [/^desktop-[a-z0-9]{7}$/i, "compute.workstation"], // nome di serie di Windows 10/11
  [/^(mac-?mini|imac|mac-?studio|surface)\b/i, "compute.workstation"],
  [/^macbook/i, "compute.laptop"],
  [/^android-[0-9a-f]{16}$/i, "mobile.phone"], // nome di serie di Android
  [/^ipad\b/i, "mobile.tablet"],
  // `^s2\d` (11/11/2026): i Samsung S si chiamano «S25-Ultra-di-<nome>», senza «Galaxy».
  [/^iphone\b|^pixel[-\s]?\d|^galaxy[-\s]|^s2\d([-\s]|$)|fairphone|nothing[-\s]phone|^redmi|^oneplus/i, "mobile.phone"],
];
const FIRME_PORTE: ReadonlyArray<readonly [(aperte: ReadonlySet<number>) => boolean, CategorySlug]> = [
  [(a) => a.has(8291) && (a.has(8728) || a.has(8729)), "network.router"], // Winbox + API RouterOS
  [(a) => a.has(8006) && a.has(22), "compute.hypervisor"], // interfaccia di Proxmox VE
  [(a) => a.has(17988), "compute.server"], // virtual media di HPE iLO
  [(a) => a.has(8007) && a.has(22), "compute.server"], // Proxmox Backup Server
  [(a) => a.has(6789) && a.has(8443) && a.has(8880), "network.controller"], // console UniFi
];

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
    const ot = OUI_SOLO_OT.find(([re]) => re.test(host.vendor ?? ""));
    const categoriaOt = ot ? mapLegacyClassification(ot[1]).category : null;
    if (categoriaOt) {
      out.push({
        source: "oui", phase: "scan_icmp", dimension: "category",
        claim: categoriaOt, confidence: 0.85, raw_value: host.vendor,
      });
    }
  }

  // 1b. Linea di prodotto da mac_product_map (hub, Task 3): prefisso MAC +
  //     hostname_pattern opzionale risolvono famiglia prodotto/categoria quando
  //     l'OUI da solo non basta (es. Ubiquiti: stesso vendor per AP/switch/
  //     gateway). `matchMacProduct` valida già la categoria internamente
  //     (isValidCategory) — qui il controllo è ridondante ma esplicito: nessuna
  //     evidenza categoria se non c'è un match valido.
  if (host.mac) {
    const mp = matchMacProduct(host.mac, host.hostname);
    if (mp) {
      out.push({
        source: "mac_product", phase: "scan_icmp", dimension: "vendor",
        claim: vendorSlug(mp.vendor), confidence: mp.confidence, raw_value: mp.product_family ?? mp.vendor,
      });
      if (mp.category && isValidCategory(mp.category)) {
        out.push({
          source: "mac_product", phase: "scan_icmp", dimension: "category",
          claim: mp.category, confidence: mp.confidence, raw_value: mp.product_family ?? mp.vendor,
        });
      }
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
    const mestiere = categoriaDaTestoNmap(host.os_info);
    if (mestiere) out.push({ source: "nmap_os", phase: "scan_nmap_base", dimension: "category", claim: mestiere, confidence: 0.7, raw_value: host.os_info.slice(0, 200) });
  }

  // 3b. gemello di MAC: la stessa scheda di rete su un altro IP
  if (signals.gemello && isValidCategory(signals.gemello.categoria)) {
    out.push({ source: "mac_gemello", phase: "scan_icmp", dimension: "category", claim: signals.gemello.categoria, confidence: 0.7, raw_value: `stesso MAC di ${signals.gemello.ip}` });
  }

  // 4. hostname: prima le firme (nomi che dicono il tipo), poi la regola debole
  if (host.hostname) {
    const firma = FIRME_NOME.find(([re]) => re.test(host.hostname ?? ""));
    if (firma) {
      out.push({ source: "hostname", phase: "scan_icmp", dimension: "category", claim: firma[1], confidence: 0.7, weight: PESO_FIRMA, raw_value: host.hostname });
    } else {
      const cat = categoryFromLegacyText({ hostname: host.hostname });
      if (cat) out.push({ source: "hostname", phase: "scan_icmp", dimension: "category", claim: cat, confidence: 0.5, raw_value: host.hostname });
    }
  }

  // 5. porte aperte: prima le firme (porte di un solo prodotto), poi la regola debole
  const ports = safeJson<Array<{ port: number; version?: string | null }>>(host.open_ports);
  if (ports && ports.length > 0) {
    const aperte = new Set(ports.map((p) => p.port));
    const firma = FIRME_PORTE.find(([vale]) => vale(aperte));
    const elenco = ports.map((p) => p.port).join(",");
    if (firma) {
      out.push({ source: "ports", phase: "scan_naabu", dimension: "category", claim: firma[1], confidence: 0.7, weight: PESO_FIRMA, raw_value: elenco });
    } else {
      const cat = categoryFromLegacyText({ openPorts: ports });
      if (cat) out.push({ source: "ports", phase: "scan_naabu", dimension: "category", claim: cat, confidence: 0.5, raw_value: elenco });
    }

    /* 5b. La VERSIONE dei servizi (`-sV`): è il posto dove un prodotto dice il proprio
     * nome, e fino al 05/11/2026 non la leggeva nessuno — né per l'OS né per la
     * categoria. Il dato è già in archivio su ogni host scansionato: questa lettura
     * vale anche all'indietro.
     *
     * Produttore e categoria vengono dalla PRIMA porta che nomina un prodotto noto (in
     * ordine di porta): è l'apparato, e un apparato è una cosa sola. Il sistema
     * operativo no: si cerca su TUTTE le porte, perché il prodotto che dà la categoria
     * spesso non dice l'OS. Misurato sul PX-NAS `192.168.99.1`: la 3128 dice «Proxmox
     * Virtual Environment» (hypervisor, nessun OS), la 22 «OpenSSH 10.0p2 Debian»
     * (linux) — fermandosi alla prima l'host restava senza famiglia. */
    const porteInOrdine = [...ports].sort((a, b) => a.port - b.port);
    const conProdotto = porteInOrdine
      .map((p) => ({ p, prodotto: prodottoDaVersione(p.version) }))
      .filter((x): x is { p: typeof x.p; prodotto: NonNullable<typeof x.prodotto> } => x.prodotto !== null);

    const primo = conProdotto[0];
    if (primo) {
      const grezzo = `${primo.p.port}/${(primo.p.version ?? "").slice(0, 120)}`;
      if (primo.prodotto.vendor) {
        out.push({ source: "nmap_service", phase: "scan_nmap_base", dimension: "vendor", claim: primo.prodotto.vendor, confidence: 0.8, raw_value: grezzo });
      }
      if (primo.prodotto.category && isValidCategory(primo.prodotto.category)) {
        out.push({ source: "nmap_service", phase: "scan_nmap_base", dimension: "category", claim: primo.prodotto.category, confidence: 0.8, raw_value: grezzo });
      }
    }

    /* Una sola famiglia, non una per porta: due claim uguali di peso si pareggiano e
     * il motore non saprebbe quale preferire. Si prende, in quest'ordine:
     *  1. l'OS **dichiarato** da un prodotto della tabella (ESXi, Windows): è il
     *     prodotto stesso a dirlo, confidenza 0.8;
     *  2. altrimenti la famiglia letta nel testo di un banner qualunque («OpenSSH …
     *     Debian»): è un indizio di contorno, confidenza 0.7 (0.85 × 0.7 = 0.595,
     *     ancora sopra la soglia, e sotto chi parla col sistema operativo). */
    const dichiarato = conProdotto.find((x) => x.prodotto.os);
    const dalBanner = dichiarato ? null : porteInOrdine.find((p) => osFamilyFromText(p.version ?? ""));
    const scelta = dichiarato
      ? { porta: dichiarato.p, famiglia: dichiarato.prodotto.os as string, confidenza: 0.8 }
      : dalBanner
        ? { porta: dalBanner, famiglia: osFamilyFromText(dalBanner.version ?? "") as string, confidenza: 0.7 }
        : null;
    if (scelta) {
      out.push({
        source: "nmap_service", phase: "scan_nmap_base", dimension: "os",
        claim: scelta.famiglia, confidence: scelta.confidenza,
        raw_value: `${scelta.porta.port}/${(scelta.porta.version ?? "").slice(0, 120)}`,
      });
    }
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

  // L'apparato dice di sé: più forte del nome del vicino (0.7) ma non autoritativo, vedi AUTHORITATIVE_SOURCES.
  // Prima chi dice il modello (MNDP, Ubiquiti): un MikroTik in CDP dichiara «router» anche quando è
  // uno switch CRS (hub, 10/11/2026: `CRS504-4XQ` annunciato in CDP come «MikroTik», capacità router).
  const dalModello = (a: { protocollo: string }) => (a.protocollo === "mndp" || a.protocollo === "ubnt" ? 0 : 1);
  for (const a of [...(signals.annunci ?? [])].sort((x, y) => dalModello(x) - dalModello(y))) {
    const cat = categoriaDaAnnuncio(a);
    if (!cat) continue;
    const source = a.protocollo === "cdp" || a.protocollo === "mndp" || a.protocollo === "ubnt" ? a.protocollo : "lldp";
    out.push({ source, phase: "integration", dimension: "category", claim: cat, confidence: confidenzaAnnuncio(a, cat), raw_value: (a.piattaforma ?? a.capacita ?? "").slice(0, 200) });
    // Chi parla MNDP è un MikroTik, chi risponde alla scoperta Ubiquiti è un Ubiquiti: lo dice il protocollo.
    if (source === "mndp" || source === "ubnt") {
      out.push({ source, phase: "integration", dimension: "vendor", claim: source === "mndp" ? "mikrotik" : "ubiquiti", confidence: CONFIDENZA_ANNUNCIO, raw_value: a.protocollo });
    }
    break;
  }

  return out;
}
