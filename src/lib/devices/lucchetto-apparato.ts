/**
 * Il lucchetto per apparato (piano 2026-10-22 scansione automatica, decisione 10b): il giro ARP, il job `apparati_scelti`
 * e «Interroga» non leggono mai lo stesso apparato insieme. In memoria, per processo, come i lucchetti di ADR 0006; la
 * chiave porta il tenant (`tenant|deviceId`): lo stesso id in due clienti è due apparati. Non aspetta: chi trova
 * l'apparato occupato passa oltre (il giro, il job: «saltato: lettura già in corso») o risponde 409 («Interroga»).
 * Si libera quando la lettura finisce davvero, anche se lancia.
 */
import { getCurrentTenantCode, withTenant } from "@/lib/db-tenant";

export const MESSAGGIO_OCCUPATO = "Lettura già in corso su questo apparato";

const occupati = new Set<string>();

const chiave = (deviceId: number): string => `${getCurrentTenantCode() ?? ""}|${deviceId}`;

export function apparatoOccupato(deviceId: number): boolean {
  return occupati.has(chiave(deviceId));
}

/**
 * `fn` sotto il lucchetto dell'apparato. Il controllo e la presa avvengono prima di ogni `await` (non si intrecciano con
 * un altro chiamante). Un errore di `fn` arriva a chi chiama, col lucchetto già libero.
 */
export async function conLucchettoApparato<T>(deviceId: number, fn: () => Promise<T>): Promise<{ stato: "fatto"; valore: T } | { stato: "occupato" }> {
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
