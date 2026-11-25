/**
 * Da dove è entrato ogni utente l'ultima volta, dal registro degli accessi (Protezione › Utenti). Sola lettura.
 * L'indirizzo c'è nelle righe scritte dal 25/11/2026 in poi; prima il registro non lo scriveva.
 */
import fs from "node:fs";
import { resolveDataDir } from "../data-dir";
import { unisci } from "../percorsi";

export interface UltimoAccesso {
  il: string;
  ip: string | null;
}

/** Per nome utente, l'ultimo accesso riuscito negli ultimi `giorni`. */
export function ultimiAccessi(giorni = 60, adesso = new Date()): Map<string, UltimoAccesso> {
  const dir = unisci(resolveDataDir(), "audit");
  const soglia = new Date(adesso.getTime() - giorni * 86_400_000).toISOString().slice(0, 10);
  const mappa = new Map<string, UltimoAccesso>();
  let file: string[];
  try {
    file = fs.readdirSync(dir).filter((f) => /^accessi-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(8, 18) >= soglia).sort();
  } catch {
    return mappa;
  }
  for (const f of file) {
    for (const r of fs.readFileSync(unisci(dir, f), "utf8").split("\n")) {
      if (!r.includes('"accesso_riuscito"')) continue;
      try {
        const riga = JSON.parse(r) as { il?: string; azione?: string; utente?: string; ip?: string };
        if (riga.azione === "accesso_riuscito" && riga.utente && riga.il) mappa.set(riga.utente, { il: riga.il, ip: riga.ip ?? null });
      } catch {
        // una riga rotta non ferma le altre
      }
    }
  }
  return mappa;
}
