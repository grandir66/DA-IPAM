/**
 * Pezzi puri della scheda stampante: striscia dei numeri (pagine, stato, materiali, errori), ordine e
 * colore dei materiali di consumo, etichette. Legge `device_info.printer_inventory` come lo scrive
 * `printer-acquisition.ts`. Niente DB né React. Senza dato: null (la casella/riquadro non si rende).
 */
import type { PrinterInventorySnapshot } from "@/lib/devices/device-info";
import type { Casella } from "@/components/scheda/striscia-numeri";

type Snmp = NonNullable<PrinterInventorySnapshot["snmp"]>;
export type Materiale = NonNullable<Snmp["supplies"]>[number];
export type Vassoio = NonNullable<Snmp["trays"]>[number];

/** Colore della barra per un materiale, dal nome del colorante (nero/ciano/magenta/giallo), altrimenti grigio. */
export function coloreMateriale(m: Materiale): string {
  const c = `${m.colorant ?? ""} ${m.description ?? ""}`.toLowerCase();
  if (/black|nero|\bk\b/.test(c)) return "#1F2937";
  if (/cyan|ciano/.test(c)) return "#06B6D4";
  if (/magenta/.test(c)) return "#D946A6";
  if (/yellow|giallo/.test(c)) return "#EAB308";
  return "#64748B";
}

/** Etichetta leggibile di un materiale: descrizione, altrimenti tipo + colorante. */
export function etichettaMateriale(m: Materiale): string {
  if (m.description && m.description.trim()) return m.description.trim();
  const parti = [m.type, m.colorant].filter((p): p is string => !!p && p.trim() !== "");
  return parti.length ? parti.join(" ") : "materiale";
}

/** Un materiale va evidenziato se è sotto soglia (≤10%) o segnato «quasi esaurito». */
export function materialeInAllarme(m: Materiale): boolean {
  if (m.quasi_esaurito) return true;
  return typeof m.level_pct === "number" && m.level_pct <= 10;
}

/** Materiali con un livello noto prima, i più bassi in cima; quelli senza livello in coda. */
export function materialiOrdinati(snap: PrinterInventorySnapshot | null): Materiale[] {
  const list = snap?.snmp?.supplies ?? [];
  const conLivello = list.filter((m) => typeof m.level_pct === "number");
  const senza = list.filter((m) => typeof m.level_pct !== "number");
  conLivello.sort((a, b) => (a.level_pct ?? 0) - (b.level_pct ?? 0));
  return [...conLivello, ...senza];
}

function fmtPagine(n: number): string {
  return n.toLocaleString("it-IT");
}

/** Caselle della striscia: pagine totali, stato, materiali (col più basso), errori. Solo quelle con dato. */
export function caselleStampante(snap: PrinterInventorySnapshot | null): Casella[] {
  const s = snap?.snmp;
  if (!s) return [];
  const out: Casella[] = [];

  if (typeof s.total_pages === "number" && s.total_pages >= 0) {
    out.push({ etichetta: "Pagine totali", valore: fmtPagine(s.total_pages) });
  }
  if (s.status) {
    const attenzione = /errore|inceppat|offline/.test(s.status.toLowerCase());
    out.push({ etichetta: "Stato", valore: s.status, attenzione });
  }

  const materiali = s.supplies ?? [];
  if (materiali.length > 0) {
    const conLivello = materiali.filter((m) => typeof m.level_pct === "number");
    const minimo = conLivello.length
      ? conLivello.reduce((a, b) => ((a.level_pct ?? 100) <= (b.level_pct ?? 100) ? a : b))
      : null;
    const inAllarme = materiali.some(materialeInAllarme);
    out.push({
      etichetta: "Materiali",
      valore: String(materiali.length),
      sotto: minimo && typeof minimo.level_pct === "number" ? `min ${etichettaMateriale(minimo)} ${minimo.level_pct}%` : undefined,
      attenzione: inAllarme,
      tab: "materiali",
    });
  }

  const errori = s.errors ?? [];
  if (errori.length > 0) {
    out.push({ etichetta: "Errori", valore: String(errori.length), sotto: errori[0], attenzione: true, tab: "materiali" });
  }
  return out;
}
