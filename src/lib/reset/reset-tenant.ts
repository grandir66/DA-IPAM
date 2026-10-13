/**
 * «Reset configurazione» di un tenant: cancella i dati del cliente (reti, host,
 * apparati, credenziali, AD, inventario, job) dopo una copia del suo database.
 *
 * Fino alla fusione delle copie del database (T3-07) il pulsante rispondeva 500 e
 * non cancellava niente; dalla fusione cancella davvero. Decisione di Riccardo
 * (13/10): funziona, ma con doppia conferma — solo superadmin (nella rotta), il
 * codice del cliente scritto per esteso, e una copia del database fatta PRIMA:
 * se la copia non riesce non si cancella niente.
 */
import fs from "node:fs";
import path from "node:path";
import { getTenantDb, resetConfiguration } from "@/lib/db-tenant";
import { resolveDataDir } from "@/lib/data-dir";

export class ResetRifiutato extends Error {}

function marca(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Cartella delle copie fatte prima di un reset: `<data>/backups`. */
export function cartellaCopieReset(): string {
  return path.join(resolveDataDir(), "backups");
}

/**
 * Copia il database del tenant e poi lo svuota. `conferma` deve essere il codice
 * del tenant, identico. Ritorna il nome del file di copia.
 */
export async function resetTenantConCopia(tenantCode: string, conferma: string, ora: Date = new Date()): Promise<string> {
  if (!tenantCode) throw new ResetRifiutato("Nessun cliente scelto");
  if (conferma.trim() !== tenantCode) {
    throw new ResetRifiutato("Il codice scritto non corrisponde al cliente: niente è stato cancellato");
  }
  const cartella = cartellaCopieReset();
  fs.mkdirSync(cartella, { recursive: true });
  const nome = `${tenantCode}-pre-reset-${marca(ora)}.db`;
  const destinazione = path.join(cartella, nome);
  await getTenantDb(tenantCode).backup(destinazione);
  const st = fs.statSync(destinazione, { throwIfNoEntry: false });
  if (!st || st.size === 0) {
    throw new Error("Copia del database non riuscita: niente è stato cancellato");
  }
  resetConfiguration();
  return nome;
}
