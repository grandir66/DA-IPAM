/**
 * Il manuale per pagina (Riccardo, 26/11/2026: «quando si cambia un modulo si cambia solo quella pagina del manuale»).
 * Una guida = un file `docs/manuale/pagine/<nome>.md` che comincia con un'intestazione fra due righe `---`:
 *
 *   ---
 *   percorso: /devices/[id]
 *   titolo: Scheda di un apparato
 *   versione: 0.9.1363
 *   aggiornata: 2026-11-26
 *   ---
 *
 * `percorso` è l'indirizzo della pagina come sta in `src/app` (i tratti `[id]` valgono qualunque valore); più
 * percorsi si separano con la virgola. Modulo puro: niente file, si prova da solo.
 */

export interface Intestazione {
  percorsi: string[];
  titolo: string;
  versione: string;
  aggiornata: string;
}

export interface GuidaLetta extends Intestazione {
  nome: string;
  testo: string;
}

/** Separa l'intestazione dal testo. Senza intestazione valida dà null: un file così non è una guida. */
export function leggiGuida(nome: string, sorgente: string): GuidaLetta | null {
  const m = sorgente.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const campi: Record<string, string> = {};
  for (const riga of m[1].split(/\r?\n/)) {
    const i = riga.indexOf(":");
    if (i > 0) campi[riga.slice(0, i).trim()] = riga.slice(i + 1).trim();
  }
  const percorsi = (campi.percorso ?? "").split(",").map((p) => p.trim()).filter((p) => p.startsWith("/"));
  if (percorsi.length === 0 || !campi.titolo) return null;
  return {
    nome,
    percorsi,
    titolo: campi.titolo,
    versione: campi.versione ?? "",
    aggiornata: campi.aggiornata ?? "",
    testo: m[2].trim(),
  };
}

/** Il percorso di `src/app` (`/devices/[id]`) come espressione che riconosce gli indirizzi veri (`/devices/42`). */
function comeEspressione(percorso: string): RegExp {
  const pezzi = percorso
    .replace(/\/+$/, "")
    .split("/")
    .map((t) => (/^\[\.\.\..+\]$/.test(t) ? ".+" : /^\[.+\]$/.test(t) ? "[^/]+" : t.replace(/[.*+?^${}()|\\]/g, "\\$&")));
  return new RegExp(`^${pezzi.join("/") || ""}/?$`);
}

/** La guida dell'indirizzo aperto. A parità vince il percorso senza tratti variabili (`/devices/nuovo` su `/devices/[id]`). */
export function guidaDelPercorso<T extends Intestazione>(guide: readonly T[], indirizzo: string): T | null {
  const pulito = indirizzo.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  let migliore: { g: T; variabili: number } | null = null;
  for (const g of guide) {
    for (const p of g.percorsi) {
      if (!comeEspressione(p).test(pulito)) continue;
      const variabili = (p.match(/\[/g) ?? []).length;
      if (!migliore || variabili < migliore.variabili) migliore = { g, variabili };
    }
  }
  return migliore?.g ?? null;
}

/** Titolo con àncora esplicita: `Rete × rete {#matrice}` → testo e id. Senza àncora l'id è null. */
export function titoloConAncora(testo: string): { testo: string; id: string | null } {
  const m = testo.match(/^(.*?)\s*\{#([\w-]+)\}\s*$/);
  return m ? { testo: m[1], id: m[2] } : { testo, id: null };
}
