/**
 * Il lucchetto per apparato (piano 2026-10-22 scansione automatica, decisione 10b): il giro ARP, il job `apparati_scelti`
 * e «Interroga» non leggono mai lo stesso apparato insieme. In memoria, per processo, come i lucchetti di ADR 0006; la
 * chiave porta il tenant (`tenant|deviceId`): lo stesso id in due clienti è due apparati. Non aspetta: chi trova
 * l'apparato occupato passa oltre (il giro, il job: «saltato: lettura già in corso») o risponde 409 («Interroga»).
 * Si libera quando la lettura finisce davvero, anche se lancia.
 */
import { getCurrentTenantCode, withTenant } from "@/lib/db-tenant";

export const MESSAGGIO_OCCUPATO = "Lettura già in corso su questo apparato";

// Sul processo, non sul modulo (ADR 0006, punto 2, come `network-scan-lock.ts`): lo scheduler (server.ts sotto tsx) e il
// bundle delle rotte di Next caricano due copie di questo file; con un Set del modulo il giro e «Interroga» non si
// vedrebbero mai (revisione del Task 4).
const CHIAVE_STATO = Symbol.for("da-ipam.devices.lucchetto-apparato");
function occupatiDelProcesso(): Set<string> {
  const g = globalThis as unknown as Record<symbol, Set<string> | undefined>;
  return (g[CHIAVE_STATO] ??= new Set<string>());
}

const chiave = (deviceId: number): string => `${getCurrentTenantCode() ?? ""}|${deviceId}`;

export function apparatoOccupato(deviceId: number): boolean {
  return occupatiDelProcesso().has(chiave(deviceId));
}

/**
 * `fn` sotto il lucchetto dell'apparato. Il controllo e la presa avvengono prima di ogni `await` (non si intrecciano con
 * un altro chiamante). Un errore di `fn` arriva a chi chiama, col lucchetto già libero.
 */
export async function conLucchettoApparato<T>(deviceId: number, fn: () => Promise<T>): Promise<{ stato: "fatto"; valore: T } | { stato: "occupato" }> {
  const occupati = occupatiDelProcesso();
  const k = chiave(deviceId);
  if (occupati.has(k)) return { stato: "occupato" };
  occupati.add(k);
  try {
    return { stato: "fatto", valore: await fn() };
  } finally {
    occupati.delete(k);
  }
}

/**
 * «Interroga»: la lettura in sottofondo nel contesto del tenant (null = quello corrente), sotto il lucchetto per tutta la
 * sua durata. La rotta guarda prima `apparatoOccupato` e risponde 409; «occupato» qui resta per la corsa (impossibile
 * senza `await` in mezzo, ma la rotta lo chiude comunque come fallito).
 */
export function avviaConLucchetto(deviceId: number, tenantCode: string | null, fn: () => Promise<void>): Promise<"fatto" | "occupato"> {
  const corri = () => conLucchettoApparato(deviceId, fn).then((r) => r.stato);
  return tenantCode ? withTenant(tenantCode, corri) : corri();
}

/** Il tempo massimo di una lettura per apparato (decisione 10d del piano: ≈1 min misurato nei casi peggiori). */
export const TEMPO_APPARATO_MS = 5 * 60_000;

/**
 * La lettura, oppure un errore `TEMPO_SCADUTO` dopo `ms`: chi la chiama sotto il lucchetto lo libera e passa oltre,
 * invece di tenerlo per sempre su un apparato che non risponde più. La lettura rimasta appesa non si ferma (le sue
 * sessioni hanno i loro tempi); un suo errore tardivo non resta senza gestore.
 */
export async function entroTempoApparato<T>(p: Promise<T>, ms: number = TEMPO_APPARATO_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scadenza = new Promise<never>((_, rifiuta) => {
    timer = setTimeout(() => rifiuta(Object.assign(new Error("Lettura dell'apparato oltre il tempo massimo"), { code: "TEMPO_SCADUTO" })), Math.max(0, ms));
  });
  try {
    return await Promise.race([p, scadenza]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
