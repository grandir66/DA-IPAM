import { readFile, readdir } from "fs/promises";
import { risolvi, unisci } from "@/lib/percorsi";
import { leggiGuida, type GuidaLetta } from "./formato";

/** La cartella delle guide per pagina, dentro `docs/` (sull'appliance c'è: il codice arriva col clone git). */
export function cartellaGuide(): string {
  return risolvi(process.cwd(), "docs", "manuale", "pagine");
}

/** Tutte le guide valide, lette dal disco a ogni chiamata: una guida corretta si vede senza ricompilare. */
export async function elencoGuide(): Promise<GuidaLetta[]> {
  const cartella = cartellaGuide();
  let file: string[];
  try {
    file = await readdir(cartella);
  } catch {
    return [];
  }
  const guide: GuidaLetta[] = [];
  for (const f of file.sort()) {
    if (!/^[a-z0-9-]+\.md$/.test(f)) continue;
    try {
      const g = leggiGuida(f.replace(/\.md$/, ""), await readFile(unisci(cartella, f), "utf-8"));
      if (g) guide.push(g);
    } catch { /* un file illeggibile non ferma le altre guide */ }
  }
  return guide;
}
