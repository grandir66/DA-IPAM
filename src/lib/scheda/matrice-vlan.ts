/**
 * Modello puro della matrice porte × VLAN, condiviso fra la scheda MikroTik (bridge) e la tab VLAN degli switch
 * (Task 10 del piano «accorpamento IP e matrice VLAN degli switch»). Niente DB, niente React.
 */

export type CellaVlan = "U" | "T" | null;
/** id null = intervallo non espanso («100-200»). */
export interface ColonnaVlan { id: number | null; etichetta: string; nome: string | null }
export type StatoPortaMatrice = "attiva" | "inattiva" | "disabilitata";
/** `nota`: testo in coda al nome della porta (per i MikroTik il bond, per gli switch quello che serve). */
export interface RigaMatrice { porta: string; stato: StatoPortaMatrice; pvid: number | null; nota: string | null; celle: CellaVlan[] }
export interface MatriceVlanBase { colonne: ColonnaVlan[]; righe: RigaMatrice[] }

const VLAN_MIN = 1;
const VLAN_MAX = 4094;

/**
 * `vlan-ids` di `/interface bridge vlan` → colonne: «10,20» due colonne, «100-110» undici. Un intervallo più largo di `max`
 * resta UNA colonna con l'etichetta dell'intervallo (id null): 4093 colonne non si leggono (caso 4 del piano). Un pezzo
 * illeggibile o fuori 1-4094 non diventa una colonna.
 */
export function espandiVlanIds(s: string, max = 64): { id: number | null; etichetta: string }[] {
  const out: { id: number | null; etichetta: string }[] = [];
  const valido = (n: number) => Number.isInteger(n) && n >= VLAN_MIN && n <= VLAN_MAX;
  for (const pezzo of s.split(",").map((x) => x.trim()).filter(Boolean)) {
    const intervallo = pezzo.match(/^(\d+)\s*-\s*(\d+)$/);
    if (intervallo) {
      const a = Number(intervallo[1]), b = Number(intervallo[2]);
      if (!valido(a) || !valido(b) || b < a) continue;
      if (b - a + 1 > max) out.push({ id: null, etichetta: `${a}-${b}` });
      else for (let n = a; n <= b; n++) out.push({ id: n, etichetta: String(n) });
    } else if (/^\d+$/.test(pezzo) && valido(Number(pezzo))) {
      out.push({ id: Number(pezzo), etichetta: pezzo });
    }
  }
  return out;
}
