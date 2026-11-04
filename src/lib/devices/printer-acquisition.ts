/**
 * Acquisizione estesa stampanti via SNMP (Printer-MIB, RFC 3805 + Host Resources).
 * Legge modello, seriale, contatore pagine, materiali di consumo (toner/inchiostro/tamburo)
 * coi livelli, i vassoi e lo stato/errori. Stesso schema di `nas-acquisition.ts`:
 * walk con `snmpSubwalkLimitedForDevice` (v2c community o v3 secondo l'apparato), valori come
 * stringhe, niente DB né React. Lo snapshot va in `device_info.printer_inventory`.
 *
 * Perché serve: la lettura SNMP generica (`getDeviceInfoFromSnmp`) prende solo sysDescr/modello/
 * seriale; le stampanti classificate restavano con soli dati generici. La Printer-MIB è standard,
 * non vendor: funziona su HP/Epson/Canon/Brother/Kyocera/Lexmark che espongono SNMP.
 */

import type { NetworkDevice } from "@/types";
import type { DeviceInfo, PrinterInventorySnapshot } from "./device-info";
import { snmpSubwalkLimitedForDevice, stringifySnmpValue } from "@/lib/scanner/snmp-query";

// Printer-MIB (1.3.6.1.2.1.43) e Host Resources (1.3.6.1.2.1.25)
const PRT_GENERAL_BASE = "1.3.6.1.2.1.43.5.1.1"; // .16 prtGeneralPrinterName, .17 prtGeneralSerialNumber
const PRT_MARKER_LIFE = "1.3.6.1.2.1.43.10.2.1.4"; // prtMarkerLifeCount (pagine totali)
const PRT_SUPPLIES_BASE = "1.3.6.1.2.1.43.11.1.1"; // .5 type .6 desc .7 unit .8 max .9 level .10 colorantIndex
const PRT_COLORANT_BASE = "1.3.6.1.2.1.43.12.1.1"; // .4 prtMarkerColorantValue
const PRT_INPUT_BASE = "1.3.6.1.2.1.43.8.2.1"; // .9 max .10 current .12 mediaName .13 name
const PRT_ALERT_DESC = "1.3.6.1.2.1.43.18.1.1.8"; // prtAlertDescription
const HR_PRINTER_STATUS = "1.3.6.1.2.1.25.3.5.1.1"; // hrPrinterStatus
const HR_PRINTER_ERRORS = "1.3.6.1.2.1.25.3.5.1.2"; // hrPrinterDetectedErrorState (OCTET STRING, bitmask)

type Supply = NonNullable<PrinterInventorySnapshot["snmp"]>["supplies"];
type Tray = NonNullable<PrinterInventorySnapshot["snmp"]>["trays"];
type Row = { oid: string; value: unknown };

/** Mappa un indice colorante → nome colore leggibile (prtMarkerColorantValue). */
function colorantByIndex(rows: Row[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    const m = r.oid.match(/\.43\.12\.1\.1\.4\.\d+\.(\d+)$/);
    if (!m) continue;
    const val = stringifySnmpValue(r.value);
    if (val) out.set(m[1], val);
  }
  return out;
}

const HR_PRINTER_STATUS_IT: Record<string, string> = {
  "1": "altro", "2": "sconosciuto", "3": "pronta", "4": "in stampa", "5": "riscaldamento",
};

/** prtMarkerSuppliesType (43.11.1.1.5): i tipi più comuni → etichetta. */
const SUPPLY_TYPE_IT: Record<string, string> = {
  "3": "toner", "4": "cartuccia inchiostro", "6": "cartuccia", "9": "toner",
  "10": "tamburo", "11": "fusore", "12": "cinghia", "13": "vaschetta recupero",
  "15": "testina", "21": "stagno", "1": "altro", "2": "sconosciuto",
};

function toInt(v: string | undefined): number | null {
  if (v == null || !/^-?\d+$/.test(v.trim())) return null;
  return parseInt(v.trim(), 10);
}

/** % residua di un materiale: level/max·100 quando entrambi sono positivi. Negativi = ignoti (null). */
function levelPct(level: number | null, max: number | null): number | null {
  if (level == null || max == null || max <= 0 || level < 0) return null;
  return Math.max(0, Math.min(100, Math.round((level / max) * 100)));
}

function parseSupplies(rows: Row[], colorant: Map<string, string>): Supply {
  const byIdx = new Map<string, Record<string, string>>();
  for (const r of rows) {
    const m = r.oid.match(/\.43\.11\.1\.1\.(\d+)\.\d+\.(\d+)$/); // col . markerIndex . suppliesIndex
    if (!m) continue;
    const [, col, idx] = m;
    const val = stringifySnmpValue(r.value);
    if (val == null) continue;
    if (!byIdx.has(idx)) byIdx.set(idx, {});
    byIdx.get(idx)![col] = val;
  }
  const out: NonNullable<Supply> = [];
  for (const [, row] of byIdx) {
    const level = toInt(row["9"]);
    const max = toInt(row["8"]);
    const typeCode = (row["5"] ?? "").trim();
    out.push({
      description: row["6"] || undefined,
      type: SUPPLY_TYPE_IT[typeCode] ?? (typeCode ? `tipo ${typeCode}` : null),
      colorant: row["10"] ? colorant.get(row["10"]) ?? null : null,
      level_raw: level,
      max_raw: max,
      level_pct: level === -3 ? null : levelPct(level, max),
      quasi_esaurito: level === -3 ? false : (() => { const p = levelPct(level, max); return p != null && p <= 10; })(),
    });
  }
  return out.length ? out : undefined;
}

function parseTrays(rows: Row[]): Tray {
  const byIdx = new Map<string, Record<string, string>>();
  for (const r of rows) {
    const m = r.oid.match(/\.43\.8\.2\.1\.(\d+)\.\d+\.(\d+)$/);
    if (!m) continue;
    const [, col, idx] = m;
    const val = stringifySnmpValue(r.value);
    if (val == null) continue;
    if (!byIdx.has(idx)) byIdx.set(idx, {});
    byIdx.get(idx)![col] = val;
  }
  const out: NonNullable<Tray> = [];
  for (const [, row] of byIdx) {
    const level = toInt(row["10"]);
    const max = toInt(row["9"]);
    out.push({
      name: row["13"] || undefined,
      media: row["12"] || null,
      level_raw: level,
      max_raw: max,
      level_pct: levelPct(level, max),
    });
  }
  return out.length ? out : undefined;
}

/** hrPrinterDetectedErrorState: OCTET STRING, bitmask (byte 0 e 1). Ritorna le etichette degli errori attivi. */
const ERROR_BITS: Array<[number, number, string]> = [
  [0, 0x80, "poca carta"], [0, 0x40, "carta esaurita"], [0, 0x20, "poco toner"], [0, 0x10, "toner esaurito"],
  [0, 0x08, "sportello aperto"], [0, 0x04, "inceppata"], [0, 0x02, "offline"], [0, 0x01, "assistenza richiesta"],
  [1, 0x80, "vassoio uscita pieno"], [1, 0x40, "vassoio ingresso mancante"], [1, 0x20, "vassoio uscita mancante"],
  [1, 0x10, "marcatore mancante"], [1, 0x02, "poco materiale"], [1, 0x01, "materiale esaurito"],
];

function parseErrorState(rows: Row[]): string[] {
  const errs = new Set<string>();
  for (const r of rows) {
    const bytes = toBytes(r.value);
    if (!bytes) continue;
    for (const [i, mask, label] of ERROR_BITS) {
      if (i < bytes.length && (bytes[i] & mask) !== 0) errs.add(label);
    }
  }
  return [...errs];
}

/** OCTET STRING in byte: Buffer, array o stringa esadecimale «AA BB». */
function toBytes(value: unknown): number[] | null {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return [...value];
  if (Array.isArray(value)) return value.filter((n): n is number => typeof n === "number");
  const s = String(value).trim();
  const hex = s.match(/^[0-9a-fA-F\s]+$/) ? s.replace(/\s+/g, "") : null;
  if (hex && hex.length % 2 === 0) {
    const out: number[] = [];
    for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
    return out;
  }
  return null;
}

function firstCol(rows: Row[], base: string, col: string): string | null {
  const re = new RegExp(`\\.${base.split(".").slice(-3).join("\\.")}\\.${col}\\.\\d+$`);
  for (const r of rows) {
    if (re.test(r.oid)) {
      const v = stringifySnmpValue(r.value);
      if (v) return v;
    }
  }
  return null;
}

/**
 * Inventario stampante via SNMP. Walk delle tabelle Printer-MIB; se nessuna risponde, snapshot con
 * solo la fonte «snmp» vuota (l'apparato non espone la Printer-MIB). Non lancia: ogni walk è protetto.
 */
export async function getPrinterSnmpInventory(device: NetworkDevice): Promise<Partial<DeviceInfo>> {
  const walk = async (base: string, max: number, timeout: number, rep = 20): Promise<Row[]> => {
    try {
      return await snmpSubwalkLimitedForDevice(device, base, max, timeout, rep);
    } catch {
      return [];
    }
  };

  const [generalRows, lifeRows, supplyRows, colorantRows, inputRows, statusRows, errorRows, alertRows] =
    await Promise.all([
      walk(PRT_GENERAL_BASE, 40, 5000, 15),
      walk(PRT_MARKER_LIFE, 20, 4000, 12),
      walk(PRT_SUPPLIES_BASE, 160, 8000, 20),
      walk(PRT_COLORANT_BASE, 60, 5000, 18),
      walk(PRT_INPUT_BASE, 120, 6000, 18),
      walk(HR_PRINTER_STATUS, 20, 4000, 12),
      walk(HR_PRINTER_ERRORS, 20, 4000, 12),
      walk(PRT_ALERT_DESC, 40, 5000, 15),
    ]);

  return {
    printer_inventory: buildPrinterSnmpFromWalks({
      generalRows, lifeRows, supplyRows, colorantRows, inputRows, statusRows, errorRows, alertRows,
    }),
  };
}

/** Walk grezzi delle tabelle Printer-MIB (per il test e per `getPrinterSnmpInventory`). */
export interface PrinterWalks {
  generalRows: Row[];
  lifeRows: Row[];
  supplyRows: Row[];
  colorantRows: Row[];
  inputRows: Row[];
  statusRows: Row[];
  errorRows: Row[];
  alertRows: Row[];
}

/** Assembla lo snapshot stampante dai walk grezzi. Funzione pura (niente rete): seam di test. */
export function buildPrinterSnmpFromWalks(w: PrinterWalks): PrinterInventorySnapshot {
  const snap: PrinterInventorySnapshot = { sources: ["snmp"], snmp: {} };
  const s = snap.snmp!;
  s.model = firstCol(w.generalRows, PRT_GENERAL_BASE, "16");
  s.serial = firstCol(w.generalRows, PRT_GENERAL_BASE, "17");

  const life = w.lifeRows.map((r) => toInt(stringifySnmpValue(r.value) ?? undefined)).find((n) => n != null && n >= 0);
  s.total_pages = life ?? null;

  s.supplies = parseSupplies(w.supplyRows, colorantByIndex(w.colorantRows));
  s.trays = parseTrays(w.inputRows);

  const statusCode = w.statusRows.map((r) => stringifySnmpValue(r.value)).find(Boolean);
  s.status = statusCode ? HR_PRINTER_STATUS_IT[statusCode.trim()] ?? `stato ${statusCode.trim()}` : null;

  const errs = parseErrorState(w.errorRows);
  const alerts = w.alertRows.map((r) => stringifySnmpValue(r.value)).filter((v): v is string => !!v && v.trim() !== "");
  s.errors = [...new Set([...errs, ...alerts])];

  return snap;
}
