/**
 * Codice di primo avvio (piano di sicurezza 14/11, P0-2 tappa D; Riccardo: lo genera l'installatore, lo vede il
 * tecnico, una copia va anche su DA-Link). Finché non esiste un utente `POST /api/setup` crea il primo
 * amministratore: senza un segreto, lo crea chiunque raggiunga l'appliance per primo.
 *
 * Il codice sta in un file accanto alle chiavi (`primo-avvio.codice`, permessi 600), scritto dall'installatore.
 * - File presente: il primo avvio chiede il codice; creato l'utente, il file si cancella.
 * - File assente: come prima (installazioni fatte a mano, e quelle già configurate dove il setup è già chiuso).
 * L'appliance lo legge dal proprio disco, mai da DA-Link: deve potersi configurare scollegata.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { resolveEnvSecretsPath } from "@/lib/env-secrets";

export function percorsoCodicePrimoAvvio(): string {
  const esplicito = process.env.DA_INVENT_PRIMO_AVVIO_FILE?.trim();
  return esplicito ? path.resolve(esplicito) : path.join(path.dirname(resolveEnvSecretsPath()), "primo-avvio.codice");
}

const normalizza = (v: string): string => v.replace(/[\s-]/g, "").toUpperCase();

export function codicePrimoAvvioRichiesto(): boolean {
  return fs.existsSync(percorsoCodicePrimoAvvio());
}

/**
 * Senza file: vero (non c'è niente da chiedere). Col file: vero solo col codice giusto, confronto a tempo
 * costante. Un file vuoto o illeggibile non apre a tutti: nessun valore passa.
 */
export function verificaCodicePrimoAvvio(dato: string | null | undefined): boolean {
  const file = percorsoCodicePrimoAvvio();
  if (!fs.existsSync(file)) return true;
  let atteso = "";
  try {
    atteso = normalizza(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error("[primo-avvio] file del codice non leggibile:", e);
    return false;
  }
  const scritto = normalizza(dato ?? "");
  if (!atteso || !scritto) return false;
  const a = createHash("sha256").update(atteso).digest();
  const b = createHash("sha256").update(scritto).digest();
  return timingSafeEqual(a, b);
}

/** Creato il primo utente il codice non serve più. Non lancia: il setup è già chiuso perché l'utente esiste. */
export function consumaCodicePrimoAvvio(): void {
  try {
    fs.rmSync(percorsoCodicePrimoAvvio(), { force: true });
  } catch (e) {
    console.error("[primo-avvio] file del codice non cancellato (il setup resta chiuso comunque):", e);
  }
}
