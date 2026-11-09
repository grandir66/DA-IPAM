/**
 * Acquisizione UPS via SNMP (09/11/2026, Riccardo: «DA-IPAM riconosce un UPS ma non ne legge lo stato»).
 * Due MIB: la UPS-MIB standard (RFC 1628, 1.3.6.1.2.1.33: la espongono Eaton, Riello, Socomec, APC con la scheda giusta,
 * molti altri) e la PowerNet di APC (1.3.6.1.4.1.318.1.1.1), più ricca e l'unica sulle schede APC che non hanno la
 * RFC 1628. Si leggono entrambe; dove tutte e due rispondono vince APC, la standard riempie i buchi.
 *
 * Stesso schema di `printer-acquisition.ts`: walk con `snmpSubwalkLimitedForDevice` (v2c o v3 secondo l'apparato),
 * ognuno protetto, valori come stringhe, niente DB né React. Lo snapshot va in `device_info.ups_inventory`.
 */
import type { NetworkDevice } from "@/types";
import type { DeviceInfo, UpsInventorySnapshot } from "./device-info";
import { snmpSubwalkLimitedForDevice, stringifySnmpValue } from "@/lib/scanner/snmp-query";

type Row = { oid: string; value: unknown };

// UPS-MIB (RFC 1628): gruppi upsIdent .1, upsBattery .2, upsInput .3, upsOutput .4, upsAlarm .6, upsTest .7
const UPS_MIB = "1.3.6.1.2.1.33.1";
// APC PowerNet: upsIdent .1, upsBattery .2, upsInput .3, upsOutput .4, upsTest .7
const APC = "1.3.6.1.4.1.318.1.1.1";

export const BASI_UPS = {
  mibIdent: `${UPS_MIB}.1`,
  mibBattery: `${UPS_MIB}.2`,
  mibInput: `${UPS_MIB}.3`,
  mibOutput: `${UPS_MIB}.4`,
  mibAlarm: `${UPS_MIB}.6.1`,
  mibTest: `${UPS_MIB}.7`,
  apcIdent: `${APC}.1`,
  apcBattery: `${APC}.2`,
  apcInput: `${APC}.3`,
  apcOutput: `${APC}.4`,
  apcTest: `${APC}.7.2`,
} as const;

/** Walk grezzi (per il test e per `getUpsSnmpInventory`). Chiavi come `BASI_UPS`. */
export type UpsWalks = Record<keyof typeof BASI_UPS, Row[]>;

/** Valore dell'OID esatto (scalare `.0` o colonna `.1` di una tabella a una riga), o null. */
function valore(rows: Row[], oid: string): string | null {
  for (const r of rows) {
    const o = r.oid.replace(/^\./, "");
    if (o === oid || o === `${oid}.0` || o === `${oid}.1`) {
      const v = stringifySnmpValue(r.value);
      if (v != null) return v;
    }
  }
  return null;
}

function intero(v: string | null): number | null {
  if (v == null || !/^-?\d+$/.test(v.trim())) return null;
  return parseInt(v.trim(), 10);
}

/** Un numero ammesso solo nel suo intervallo: fuori (o mancante) = non letto. */
function nelRange(n: number | null, min: number, max: number): number | null {
  return n != null && n >= min && n <= max ? n : null;
}

const testo = (v: string | null): string | null => (v && v.trim() ? v.trim() : null);

// ─── Codici → italiano ──────────────────────────────────────────────────────

const BATTERIA_MIB: Record<string, string> = { "2": "normale", "3": "bassa", "4": "esaurita" }; // 1 = unknown
const BATTERIA_APC: Record<string, string> = { "2": "normale", "3": "bassa", "4": "guasta" }; // 4 = batteryInFaultCondition

/** upsOutputSource (RFC 1628). */
const USCITA_MIB: Record<string, string> = {
  "2": "spento", "3": "rete", "4": "bypass", "5": "batteria", "6": "rete (booster)", "7": "rete (riduttore)",
};
/** upsBasicOutputStatus (APC). */
const USCITA_APC: Record<string, string> = {
  "2": "rete", "3": "batteria", "4": "rete (SmartBoost)", "5": "spento", "6": "bypass", "7": "spento", "8": "riavvio",
  "9": "bypass", "10": "bypass (guasto)", "11": "spento", "12": "rete (SmartTrim)",
};
/** Uscite in cui la rete in ingresso c'è; «batteria» = assente. Le altre (bypass, spento) non lo dicono. */
const CON_RETE = new Set(["rete", "rete (booster)", "rete (riduttore)", "rete (SmartBoost)", "rete (SmartTrim)"]);

/** upsTestResultsSummary (RFC 1628). */
const TEST_MIB: Record<string, string> = {
  "1": "superato", "2": "avviso", "3": "errore", "4": "interrotto", "5": "in corso", "6": "mai eseguito",
};
/** upsAdvTestDiagnosticsResults (APC). */
const TEST_APC: Record<string, string> = { "1": "superato", "2": "errore", "3": "non valido", "4": "in corso" };

/** upsAdvInputLineFailCause (APC): perché l'UPS è passato a batteria l'ultima volta. */
const CAUSA_APC: Record<string, string> = {
  "1": "nessun passaggio", "2": "tensione alta", "3": "calo di tensione", "4": "blackout", "5": "picco basso breve",
  "6": "calo profondo", "7": "picco basso", "8": "picco alto", "9": "test automatico", "10": "variazione di tensione",
};

// ─── Assemblaggio ───────────────────────────────────────────────────────────

/** Assembla lo snapshot UPS dai walk grezzi. Funzione pura (niente rete): seam di test. */
export function buildUpsFromWalks(w: UpsWalks): UpsInventorySnapshot {
  /** Il valore della colonna `col` sotto la base `k` (`campo("apcBattery", "2.1")` = upsAdvBatteryCapacity). */
  const campo = (k: keyof UpsWalks, col: string) => valore(w[k], `${BASI_UPS[k]}.${col}`);

  const haMib = [w.mibIdent, w.mibBattery, w.mibInput, w.mibOutput, w.mibTest].some((r) => r.length > 0);
  const haApc = [w.apcIdent, w.apcBattery, w.apcInput, w.apcOutput, w.apcTest].some((r) => r.length > 0);
  const snap: UpsInventorySnapshot = { sources: [...(haMib ? ["ups_mib" as const] : []), ...(haApc ? ["apc" as const] : [])] };

  // Identità — APC: upsBasicIdentModel .1.1.1, upsAdvIdentFirmwareRevision .1.2.1, upsAdvIdentSerialNumber .1.2.3.
  snap.manufacturer = testo(campo("mibIdent", "1")) ?? (haApc ? "APC" : null);
  snap.model = testo(campo("apcIdent", "1.1")) ?? testo(campo("mibIdent", "2"));
  snap.serial = testo(campo("apcIdent", "2.3"));
  snap.firmware = testo(campo("apcIdent", "2.1")) ?? testo(campo("mibIdent", "3"));

  // Batteria — APC: upsBasicBatteryStatus .2.1.1, upsBasicBatteryLastReplaceDate .2.1.3, upsAdvBatteryCapacity .2.2.1,
  // upsAdvBatteryTemperature .2.2.2, upsAdvBatteryRunTimeRemaining .2.2.3 (TimeTicks), upsAdvBatteryReplaceIndicator .2.2.4.
  // RFC 1628: upsBatteryStatus .1, upsSecondsOnBattery .2, upsEstimatedMinutesRemaining .3, upsEstimatedChargeRemaining .4,
  // upsBatteryVoltage .5 (0,1 V), upsBatteryTemperature .7.
  const statoApc = campo("apcBattery", "1.1");
  const statoMib = campo("mibBattery", "1");
  const tickApc = intero(campo("apcBattery", "2.3"));
  const minutiMib = intero(campo("mibBattery", "3"));
  const sostituire = intero(campo("apcBattery", "2.4"));
  const decivolt = intero(campo("mibBattery", "5"));
  snap.battery = {
    status: (statoApc ? BATTERIA_APC[statoApc.trim()] : undefined) ?? (statoMib ? BATTERIA_MIB[statoMib.trim()] : undefined) ?? null,
    charge_pct: nelRange(intero(campo("apcBattery", "2.1")), 0, 100) ?? nelRange(intero(campo("mibBattery", "4")), 0, 100),
    runtime_min: tickApc != null && tickApc >= 0 ? Math.round(tickApc / 6000) : nelRange(minutiMib, 0, 100000),
    temperature_c: nelRange(intero(campo("apcBattery", "2.2")), -40, 120) ?? nelRange(intero(campo("mibBattery", "7")), -40, 120),
    voltage_v: decivolt != null && decivolt > 0 ? decivolt / 10 : null,
    replace_needed: sostituire === 2 ? true : sostituire === 1 ? false : null,
    last_replaced: testo(campo("apcBattery", "1.3")),
    seconds_on_battery: nelRange(intero(campo("mibBattery", "2")), 0, 10_000_000),
  };

  // Ingresso — APC: upsAdvInputLineVoltage .2.1, upsAdvInputFrequency .2.4, upsAdvInputLineFailCause .2.5.
  // RFC 1628: upsInputTable .3.1.2 frequenza (0,1 Hz), .3.1.3 tensione (V) della prima linea.
  const causa = campo("apcInput", "2.5");
  const decihertzIn = intero(campo("mibInput", "3.1.2"));
  snap.input = {
    voltage_v: nelRange(intero(campo("apcInput", "2.1")), 0, 1000) ?? nelRange(intero(campo("mibInput", "3.1.3")), 0, 1000),
    frequency_hz: nelRange(intero(campo("apcInput", "2.4")), 0, 100) ?? (decihertzIn != null && decihertzIn > 0 ? decihertzIn / 10 : null),
    fail_cause: causa ? CAUSA_APC[causa.trim()] ?? null : null,
  };

  // Uscita — APC: upsBasicOutputStatus .1.1, upsAdvOutputVoltage .2.1, upsAdvOutputFrequency .2.2, upsAdvOutputLoad .2.3.
  // RFC 1628: upsOutputSource .1, upsOutputFrequency .2 (0,1 Hz), upsOutputTable .4.1.2 tensione, .4.1.4 potenza (W),
  // .4.1.5 carico %.
  const uscitaApc = campo("apcOutput", "1.1");
  const uscitaMib = campo("mibOutput", "1");
  snap.output_source = (uscitaApc ? USCITA_APC[uscitaApc.trim()] : undefined) ?? (uscitaMib ? USCITA_MIB[uscitaMib.trim()] : undefined) ?? null;
  const decihertzOut = intero(campo("mibOutput", "2"));
  snap.output = {
    voltage_v: nelRange(intero(campo("apcOutput", "2.1")), 0, 1000) ?? nelRange(intero(campo("mibOutput", "4.1.2")), 0, 1000),
    frequency_hz: nelRange(intero(campo("apcOutput", "2.2")), 0, 100) ?? (decihertzOut != null && decihertzOut > 0 ? decihertzOut / 10 : null),
    load_pct: nelRange(intero(campo("apcOutput", "2.3")), 0, 200) ?? nelRange(intero(campo("mibOutput", "4.1.5")), 0, 200),
    power_w: nelRange(intero(campo("mibOutput", "4.1.4")), 0, 1_000_000),
  };
  snap.rete_presente = snap.output_source == null
    ? null
    : snap.output_source === "batteria" ? false : CON_RETE.has(snap.output_source) ? true : null;

  // Ultimo test — APC: upsAdvTestDiagnosticsResults .3, upsAdvTestLastDiagnosticsDate .4 (sotto .7.2).
  // RFC 1628: upsTestResultsSummary .3, upsTestResultsDetail .4.
  const testApc = campo("apcTest", "3");
  const testMib = campo("mibTest", "3");
  snap.last_test = {
    result: (testApc ? TEST_APC[testApc.trim()] : undefined) ?? (testMib ? TEST_MIB[testMib.trim()] : undefined) ?? null,
    detail: testo(campo("mibTest", "4")),
    date: testo(campo("apcTest", "4")),
  };

  snap.alarms = nelRange(intero(valore(w.mibAlarm, BASI_UPS.mibAlarm)), 0, 1000);
  return snap;
}

/**
 * Inventario UPS via SNMP. Se nessun MIB risponde, snapshot con `sources` vuoto (l'apparato non espone né la RFC 1628
 * né la PowerNet). Non lancia: ogni walk è protetto.
 */
export async function getUpsSnmpInventory(device: NetworkDevice): Promise<Partial<DeviceInfo>> {
  const walk = async (base: string): Promise<Row[]> => {
    try {
      return await snmpSubwalkLimitedForDevice(device, base, 60, 5000, 20);
    } catch {
      return [];
    }
  };
  const chiavi = Object.keys(BASI_UPS) as Array<keyof typeof BASI_UPS>;
  const righe = await Promise.all(chiavi.map((k) => walk(BASI_UPS[k])));
  const walks = Object.fromEntries(chiavi.map((k, i) => [k, righe[i]])) as UpsWalks;
  return { ups_inventory: buildUpsFromWalks(walks) };
}
