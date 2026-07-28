// Lookup runtime sulla KB vendorizzata (Task 1: `data/attribution-kb.sqlite`,
// 57.778 prefissi OUI incl. MA-M/28 e MA-S/36, 9.554 sysObjectID GLPI).
//
// L'artefatto è un ASSET READ-ONLY del deploy (arriva col checkout, come
// oui-data / custom_oui.txt in mac-vendor.ts), NON un dato persistente
// utente: per costruzione NON usa `resolveDataDir()` (che onora
// `DA_INVENT_DATA_DIR` per i volumi dati esterni) ma resta ancorato a
// `<cwd>/data`, esattamente come fa lo script che lo genera
// (`scripts/build-attribution-kb.ts`) e come da commento esplicito in
// `src/lib/data-dir.ts` ("ASSET read-only del deploy ... restano in
// <cwd>/data, non nel volume dati").
//
// Apertura lazy + cache di modulo: un solo handle `readonly: true` per
// tutta la vita del processo. Se l'artefatto manca (checkout incompleto,
// ambiente di test senza `data/`) `kbAvailable()` torna false e OGNI
// lookup torna `null` — mai un'eccezione che possa rompere lo scan.
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { isValidCategory } from "./taxonomy";
import type { CategorySlug } from "./taxonomy";

export interface KbOuiMatch {
  vendor_name: string;
  vendor_short: string | null;
  bits: 24 | 28 | 36;
}

export interface KbSysObjMatch {
  vendor: string;
  model: string | null;
  category: CategorySlug | null;
}

const KB_PATH = path.join(process.cwd(), "data", "attribution-kb.sqlite");

/** Mappa TYPE GLPI → categoria v2 (spec Task 1, tabella nel piano). Il tipo
 *  NETWORKING non distingue router/switch/access_point: livello 1 soltanto
 *  (la tassonomia più fine arriva da sysDescr/altre fonti, vedi emitters.ts). */
const GLPI_TYPE_TO_CATEGORY: Record<string, CategorySlug> = {
  NETWORKING: "network",
  PRINTER: "peripheral.printer",
  POWER: "power.ups",
  STORAGE: "storage",
  COMPUTER: "compute",
  PHONE: "voip.phone",
  KVM: "compute",
  VIDEO: "av.display",
};

// undefined = non ancora tentata l'apertura; null = tentata e fallita/assente.
let dbHandle: Database.Database | null | undefined;

function getDb(): Database.Database | null {
  if (dbHandle !== undefined) return dbHandle;
  try {
    if (!fs.existsSync(KB_PATH)) {
      dbHandle = null;
      return dbHandle;
    }
    dbHandle = new Database(KB_PATH, { readonly: true, fileMustExist: true });
    return dbHandle;
  } catch {
    dbHandle = null;
    return dbHandle;
  }
}

/** true se l'artefatto KB è presente e apribile. false → l'app continua con
 *  oui-data / LOOKUP_TABLE hardcoded, nessun crash. */
export function kbAvailable(): boolean {
  return getDb() !== null;
}

/** Versione della KB (data ISO di generazione), da `kb_meta.version`. Per la UI. */
export function kbVersion(): string | null {
  const db = getDb();
  if (!db) return null;
  try {
    const row = db.prepare("SELECT value FROM kb_meta WHERE key = 'version'").get() as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function normalizeMacHex(mac: string): string | null {
  const hex = mac.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  return hex.length >= 6 ? hex : null;
}

/**
 * Longest-prefix MAC → vendor: prova 36 bit (9 cifre hex), poi 28 (7 cifre),
 * poi 24 (6 cifre). `prefix` è PRIMARY KEY nella tabella `oui`: tre lookup
 * indicizzati diretti, niente scansione.
 */
export function kbLookupMac(mac: string): KbOuiMatch | null {
  if (!mac) return null;
  const db = getDb();
  if (!db) return null;
  const hex = normalizeMacHex(mac);
  if (!hex) return null;
  try {
    const stmt = db.prepare(
      "SELECT vendor_name, vendor_short, bits FROM oui WHERE prefix = ?"
    );
    for (const len of [9, 7, 6]) {
      if (hex.length < len) continue;
      const candidate = hex.slice(0, len);
      const row = stmt.get(candidate) as
        | { vendor_name: string; vendor_short: string | null; bits: number }
        | undefined;
      if (row) {
        return { vendor_name: row.vendor_name, vendor_short: row.vendor_short, bits: row.bits as 24 | 28 | 36 };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Normalizza l'OID in ingresso: stessa logica di `snmp-sysobj-lookup.ts`
 *  (righe 220-225) — gestisce prefissi `MIB::`, `enterprises.`, `iso.`. */
function normalizeOidInput(raw: string): string | null {
  let oid = raw.trim().replace(/^\.+/, "");
  oid = oid.replace(/^[A-Za-z0-9_-]+::/g, "").trim();
  if (/^enterprises\b/i.test(oid)) oid = oid.replace(/^enterprises\.?/i, "1.3.6.1.4.1.");
  if (/^iso\b/i.test(oid)) oid = oid.replace(/^iso\.?/i, "1.");
  oid = oid.replace(/^\.+/, "").replace(/\.{2,}/g, ".").replace(/\.$/, "");
  if (!oid || !/^[0-9]+(\.[0-9]+)*$/.test(oid)) return null;
  return oid;
}

/** Tutti i prefissi dell'OID dal più lungo (l'OID stesso) alla radice. */
function oidPrefixCandidates(oid: string): string[] {
  const parts = oid.split(".");
  const out: string[] = [];
  for (let i = parts.length; i > 0; i--) out.push(parts.slice(0, i).join("."));
  return out;
}

function findSysObjRow(
  db: Database.Database,
  oid: string
): { vendor: string; glpi_type: string | null; model: string | null } | undefined {
  const stmt = db.prepare("SELECT vendor, glpi_type, model FROM sysobj WHERE oid = ?");
  for (const candidate of oidPrefixCandidates(oid)) {
    const row = stmt.get(candidate) as
      | { vendor: string; glpi_type: string | null; model: string | null }
      | undefined;
    if (row) return row;
  }
  return undefined;
}

/**
 * Longest-prefix sysObjectID → vendor/modello/categoria. Prova prima l'OID
 * così com'è normalizzato (copre sia OID già assoluti sia l'arco iso.member-body
 * `1.2.*`), poi — se non trova nulla — la forma relativa con l'arco
 * enterprise anteposto (`1.3.6.1.4.1.<id>`, es. `14988` MikroTik).
 */
export function kbLookupSysObjectId(oid: string): KbSysObjMatch | null {
  if (!oid) return null;
  const db = getDb();
  if (!db) return null;
  const normalized = normalizeOidInput(oid);
  if (!normalized) return null;
  try {
    let row = findSysObjRow(db, normalized);
    if (!row && !normalized.startsWith("1.3.6.1.4.1.")) {
      row = findSysObjRow(db, `1.3.6.1.4.1.${normalized}`);
    }
    if (!row) return null;
    const mapped = row.glpi_type ? GLPI_TYPE_TO_CATEGORY[row.glpi_type] : undefined;
    const category = mapped && isValidCategory(mapped) ? mapped : null;
    return { vendor: row.vendor, model: row.model ?? null, category };
  } catch {
    return null;
  }
}
