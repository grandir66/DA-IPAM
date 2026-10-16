// src/lib/attribution/mac-product.ts
//
// Linea di prodotto per prefisso MAC (Attribution v2 Fase 2, Task 3): risolve
// vendor + famiglia prodotto + categoria usando `mac_product_map` (hub, dato
// uguale per tutti i tenant — regola 11 CLAUDE.md), che completa l'OUI puro
// (`kb.ts`) quando lo stesso vendor produce più famiglie indistinguibili dal
// solo MAC (es. Ubiquiti: AP/switch/gateway condividono gli stessi OUI).
//
// Apertura DB via `require` dinamico (come `snmp-sysobj-lookup.ts`, per evitare
// dipendenze circolari e problemi di build) + cache in-memoria con TTL, stesso
// pattern di `invalidateSysObjLookupCache`. `invalidateMacProductCache` è
// esportata per la UI del Task 4 (dopo create/update/delete via API).
import { normalizeMacHex } from "./kb";
import { isValidCategory } from "./taxonomy";
import type { CategorySlug } from "./taxonomy";
import type { MacProductMapRow } from "@/lib/db-hub";

export interface MacProductMatch {
  vendor: string;
  product_family: string | null;
  category: CategorySlug | null;
  confidence: number;
}

// ── Cache in-memoria (TTL 60s), stesso schema di snmp-sysobj-lookup.ts ──
let _cachedEntries: MacProductMapRow[] | null = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 60000;

/** Invalida la cache in-memoria. Usata dalla UI (Task 4) dopo create/update/delete. */
export function invalidateMacProductCache(): void {
  _cachedEntries = null;
  _cacheTimestamp = 0;
}

function loadEntries(): MacProductMapRow[] {
  const now = Date.now();
  if (_cachedEntries && now - _cacheTimestamp < CACHE_TTL_MS) {
    return _cachedEntries;
  }
  try {
    // Dynamic require per evitare circular dependency e problemi di build
    // (stesso pattern di getEntriesFromDb in snmp-sysobj-lookup.ts).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const hub = require("@/lib/db-hub");
    const rows: MacProductMapRow[] = hub.getMacProductMap();
    _cachedEntries = Array.isArray(rows) ? rows : [];
  } catch {
    // Hub DB non disponibile (build time, test, ecc.): nessuna entry, nessuna eccezione.
    _cachedEntries = [];
  }
  _cacheTimestamp = now;
  return _cachedEntries;
}

// Un solo warning per riga con pattern non compilabile (mai uno spam ad ogni lookup).
const warnedInvalidPatternIds = new Set<number>();

function compileHostnamePattern(row: MacProductMapRow): RegExp | null {
  if (!row.hostname_pattern) return null;
  try {
    return new RegExp(row.hostname_pattern, "i");
  } catch {
    if (!warnedInvalidPatternIds.has(row.id)) {
      warnedInvalidPatternIds.add(row.id);
      console.warn(
        `[mac-product] hostname_pattern non valido ignorato (id=${row.id}): "${row.hostname_pattern}"`
      );
    }
    return null;
  }
}

function toMatch(row: MacProductMapRow): MacProductMatch {
  const category = row.category && isValidCategory(row.category) ? row.category : null;
  return {
    vendor: row.vendor,
    product_family: row.product_family,
    category,
    confidence: row.confidence,
  };
}

/**
 * Risolve la entry applicabile fra `entries` per un MAC già normalizzato
 * (`hex`: esadecimale maiuscolo senza separatori) ed un hostname opzionale.
 * Longest-prefix MAC: prova 9 → 7 → 6 cifre. A parità di prefisso, una riga
 * con `hostname_pattern` che matcha l'hostname vince su una riga "generica"
 * (senza pattern, valida per qualunque host con quel prefisso); pattern non
 * compilabile → riga ignorata (mai eccezione); righe `enabled=0` ignorate.
 *
 * Pura (nessun I/O): esportata per i test, che passano fixture di righe senza
 * toccare il DB hub.
 */
export function resolveMacProductMatch(
  entries: MacProductMapRow[],
  hex: string,
  hostname: string | null
): MacProductMatch | null {
  for (const len of [9, 7, 6] as const) {
    if (hex.length < len) continue;
    const candidate = hex.slice(0, len);
    const rowsAtLen = entries.filter((r) => r.enabled === 1 && r.mac_prefix === candidate);
    if (rowsAtLen.length === 0) continue;

    let genericRow: MacProductMapRow | null = null;
    for (const row of rowsAtLen) {
      if (!row.hostname_pattern) {
        if (!genericRow) genericRow = row;
        continue;
      }
      const re = compileHostnamePattern(row);
      if (!re) continue; // pattern non compilabile → riga ignorata
      if (hostname && re.test(hostname)) return toMatch(row);
    }
    if (genericRow) return toMatch(genericRow);
    // Nessuna riga applicabile a questa lunghezza di prefisso: prova la successiva più corta.
  }
  return null;
}

/**
 * Risolve vendor/famiglia prodotto/categoria per un host da `mac_product_map`
 * (hub, cache 60s). `null` se il MAC non è normalizzabile, l'hub non ha entry
 * (o non è disponibile), o nessuna entry è applicabile.
 */
export function matchMacProduct(mac: string, hostname: string | null): MacProductMatch | null {
  if (!mac) return null;
  const hex = normalizeMacHex(mac);
  if (!hex) return null;
  const entries = loadEntries();
  if (entries.length === 0) return null;
  return resolveMacProductMatch(entries, hex, hostname);
}
