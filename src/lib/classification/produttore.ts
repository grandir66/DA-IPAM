/**
 * Filtro per produttore (Riccardo, 12/11/2026): l'elenco è quello dei produttori trovati dal MAC nelle righe
 * a schermo, col numero di righe, dal più frequente. Modulo puro.
 */
export const PRODUTTORE_IGNOTO = "__ignoto__";

export interface ProduttoreTrovato { valore: string; quanti: number }

const pulito = (v: string | null | undefined): string => (v ?? "").trim();

export function produttoriTrovati(righe: ReadonlyArray<{ vendor?: string | null }>): { trovati: ProduttoreTrovato[]; ignoti: number } {
  const conta = new Map<string, number>();
  let ignoti = 0;
  for (const r of righe) {
    const v = pulito(r.vendor);
    if (!v) ignoti++;
    else conta.set(v, (conta.get(v) ?? 0) + 1);
  }
  const trovati = [...conta.entries()]
    .map(([valore, quanti]) => ({ valore, quanti }))
    .sort((a, b) => b.quanti - a.quanti || a.valore.localeCompare(b.valore, "it"));
  return { trovati, ignoti };
}

export function passaFiltroProduttore(filtro: string | null | undefined, vendor: string | null | undefined): boolean {
  if (!filtro) return true;
  const v = pulito(vendor);
  return filtro === PRODUTTORE_IGNOTO ? v === "" : v === filtro;
}
