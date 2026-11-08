/**
 * Se il modulo «Inventario NIS2» è acceso. Regola unica: la usano il registro dei moduli, Opzioni e
 * la rotta del modulo. Prova: `__tests__/nis2-di-serie.test.ts`.
 *
 * - Una scelta fatta in Opzioni (`nis2_inventory_enabled` del tenant) vince sempre.
 * - Mai toccato: spento sulla ridotta (Riccardo, 08/11/2026), acceso altrove, com'era.
 *   La ridotta si riconosce da `/etc/da-appliance/versione.json` (`"variante": "snella"`), che
 *   Deploy-Appliance scrive all'installazione e rinnova a ogni aggiornamento.
 * - File illeggibile: non si sa che immagine è, resta acceso come prima (e si dice nel log).
 */
import fs from "node:fs";
import { unisci } from "@/lib/percorsi";
import { percorsiAppliance } from "@/lib/azzeramento-appliance";
import { getTenantSetting } from "@/lib/db-tenant";

export type VarianteImmagine = "snella" | "piena" | "illeggibile" | null;

export const CHIAVE_NIS2 = "nis2_inventory_enabled";

/** La variante dell'immagine; `null` = nessun versione.json, cioè non è un'appliance da immagine. */
export function varianteImmagine(conf: string = percorsiAppliance().conf): VarianteImmagine {
  const file = unisci(conf, "versione.json");
  let testo: string;
  try {
    testo = fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.warn(`[nis2] ${file} non si legge: NIS2 resta acceso di serie`);
    return "illeggibile";
  }
  try {
    const v: unknown = JSON.parse(testo);
    if (!v || typeof v !== "object") throw new Error("non è un oggetto");
    return (v as { variante?: unknown }).variante === "snella" ? "snella" : "piena";
  } catch {
    console.warn(`[nis2] ${file} non è JSON valido: NIS2 resta acceso di serie`);
    return "illeggibile";
  }
}

export function nis2DiSerie(variante: VarianteImmagine): boolean {
  return variante !== "snella";
}

export function nis2Acceso(raw: string | null, variante: VarianteImmagine): boolean {
  if (raw === null) return nis2DiSerie(variante);
  return raw === "1" || raw === "true";
}

/** Per il tenant corrente (va chiamata dentro un contesto tenant). */
export function leggiNis2(): boolean {
  return nis2Acceso(getTenantSetting(CHIAVE_NIS2), varianteImmagine());
}
