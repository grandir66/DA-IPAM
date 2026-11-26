/**
 * L'elenco «mai bloccati»: indirizzi e reti che una persona ha deciso di non bloccare mai (i nostri scanner, il
 * server di monitoraggio…). Sta nelle impostazioni dell'hub. NetBird, la macchina e i «sempre ammessi» del filtro
 * non servono qui: non si bloccano già.
 */
import { getSetting, setSetting } from "@/lib/db-hub";
import { tipoIndirizzo } from "./politica";

const CHIAVE = "protezione_mai_bloccati";

export function maiBloccati(): string[] {
  try {
    const dati = JSON.parse(getSetting(CHIAVE) ?? "[]") as unknown;
    return Array.isArray(dati) ? dati.filter((v): v is string => typeof v === "string" && tipoIndirizzo(v) !== null) : [];
  } catch {
    return [];
  }
}

export function impostaMaiBloccati(elenco: readonly string[]): void {
  const pulito = [...new Set(elenco)];
  if (pulito.length > 128) throw new Error("Più di 128 voci");
  for (const v of pulito) if (tipoIndirizzo(v) === null) throw new Error(`«${v}» non è un indirizzo né una rete ammessa`);
  setSetting(CHIAVE, JSON.stringify(pulito));
}
