/**
 * Gli interruttori delle letture in più per la mappa (spec topologia §13.5.6), uno per lettura e per cliente, in
 * tenant_settings del DB del cliente. Chiave assente, valore rovinato o `acceso` diverso da `true` = SPENTO: un ambiente
 * che non dichiara niente non legge (D4). Accanto, l'esito di ogni lettura per apparato: serve alla cadenza propria
 * (cadenza.ts) e alla riga «ultima lettura ed esito» di «Dati della mappa». Ore in UTC, come nel DB.
 */
import { getTenantSetting, runInTenantTransaction, setTenantSetting, type CampiViciniCavi } from "@/lib/db-tenant";

/** `mikrotik_scheda` (scheda MikroTik, Task 10, ADR 0027): VLAN, DNS e utenti dei router, per la scheda e non per la mappa.
 *  `switch_vlan` (accorpamento e VLAN, Task 9, ADR 0029): le VLAN degli switch via SNMP, per la scheda e non per la mappa.
 *  `librenms` (piano 2026-10-22 LibreNMS, task 4; spec `specs/2026-10-22-librenms-fonte-dati-design.md`): i dati degli
 *  apparati letti dall'API di LibreNMS locale nelle tabelle `librenms_*`, per la scheda e non per la mappa (spec §4.3). */
export const LETTURE = ["mikrotik", "controller", "snmp", "host", "mikrotik_scheda", "switch_vlan", "librenms"] as const;
export type Lettura = (typeof LETTURE)[number];

/** Le letture che questa versione sa fare. `host` è arrivata col Task 7 del piano di T2, scritta sull'uscita vera T2-b. */
export const LETTURE_DISPONIBILI: ReadonlySet<Lettura> = new Set<Lettura>(["mikrotik", "controller", "snmp", "host", "mikrotik_scheda", "switch_vlan", "librenms"]);

export function eLettura(x: unknown): x is Lettura {
  return typeof x === "string" && (LETTURE as readonly string[]).includes(x);
}

export const chiaveLettura = (l: Lettura): string => `topologia.lettura.${l}`;
export const chiaveEsito = (l: Lettura): string => `topologia.lettura.${l}.esito`;

export interface StatoInterruttore { acceso: boolean; da: string | null; il: string | null }
export interface EsitoApparato { il: string; comandi: number; riusciti: number; codice: string | null }

/** L'ora come la scrive il DB: UTC, «AAAA-MM-GG HH:MM:SS». */
export function oraUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function leggiJson(chiave: string): unknown {
  let testo: string | null;
  try {
    testo = getTenantSetting(chiave);
  } catch {
    return null; // impostazione illeggibile: come assente, quindi spenta
  }
  if (testo === null) return null;
  try {
    return JSON.parse(testo) as unknown;
  } catch {
    return null;
  }
}

const oggetto = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Lo stato di un interruttore qualsiasi della topologia (letture di T2, mappa nuova di T3: stessa forma, §13.5.6). */
export function leggiStatoChiave(chiave: string): StatoInterruttore {
  const o = oggetto(leggiJson(chiave));
  return { acceso: o?.acceso === true, da: typeof o?.da === "string" ? o.da : null, il: typeof o?.il === "string" ? o.il : null };
}

export function leggiInterruttore(l: Lettura): StatoInterruttore {
  return leggiStatoChiave(chiaveLettura(l));
}

export function letturaAccesa(l: Lettura): boolean {
  return leggiInterruttore(l).acceso;
}

/** Accende o spegne (solo un admin, dalla rotta PUT). Spento si scrive comunque, con chi e quando: resta la storia. */
export function scriviInterruttore(l: Lettura, acceso: boolean, da: string, adesso: Date = new Date()): StatoInterruttore {
  return scriviStatoChiave(chiaveLettura(l), acceso, da, adesso);
}

/** La scrittura comune agli interruttori (letture di T2, mappa nuova di T3): chi e quando, anche quando si spegne. */
export function scriviStatoChiave(chiave: string, acceso: boolean, da: string, adesso: Date = new Date()): StatoInterruttore {
  const s: StatoInterruttore = { acceso, da, il: oraUtc(adesso) };
  setTenantSetting(chiave, JSON.stringify(s));
  return s;
}

function esitoValido(x: unknown): x is EsitoApparato {
  const o = oggetto(x);
  return !!o && typeof o.il === "string" && typeof o.comandi === "number" && typeof o.riusciti === "number"
    && (o.codice === null || typeof o.codice === "string");
}

export function leggiEsiti(l: Lettura): Record<string, EsitoApparato> {
  const o = oggetto(leggiJson(chiaveEsito(l)));
  if (!o) return {};
  const out: Record<string, EsitoApparato> = {};
  for (const [k, e] of Object.entries(o)) if (/^\d+$/.test(k) && esitoValido(e)) out[k] = e;
  return out;
}

/** Leggi, unisci e riscrivi in una transazione: due apparati dello stesso giro non si tolgono l'esito a vicenda. */
export function scriviEsito(l: Lettura, deviceId: number, e: EsitoApparato): void {
  runInTenantTransaction(() => {
    const tutti = leggiEsiti(l);
    tutti[String(deviceId)] = e;
    setTenantSetting(chiaveEsito(l), JSON.stringify(tutti));
  });
}

/** Con la lettura spenta le colonne nuove dei vicini non si scrivono (I33): chi chiama le toglie qui. */
export function senzaCampiCavi<T extends CampiViciniCavi>(n: T): T {
  const c = { ...n };
  delete c.discoveredBy;
  delete c.localPortIndex;
  delete c.remotePortIndex;
  delete c.remoteCaps;
  return c;
}
