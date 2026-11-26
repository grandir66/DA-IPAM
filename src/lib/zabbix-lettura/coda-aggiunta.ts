/**
 * La coda dell'aggiunta in massa a Zabbix (26/11/2026, tappa 3 del punto d'ingresso; Riccardo sul tetto: «va bene
 * 100»). Il centro accetta 10 scritture al minuto e 100 apparati al giorno per chiave: chi ne aggiunge di più si
 * ferma al tetto e riprende il giorno dopo. Qui c'è la parte pura: cosa resta in coda, quanti ne sono entrati oggi,
 * quanto ci vuole. La coda vive nel browser di chi l'ha lanciata (la pagina deve restare aperta): niente parte da sola.
 */
export const TETTO_GIORNO = 100;
export const PER_MINUTO = 10;
/** Le prime chiamate passano subito (il secchiello del centro è pieno), poi una ogni tanto così da non svuotarlo. */
export const SUBITO = 8;
export const PASSO_MS = 6500;

export interface Coda {
  /** Le chiavi degli apparati accettati dal centro e non ancora aggiunti (`i:<id>`). */
  chiavi: string[];
  /** Il giorno UTC a cui si riferisce il contatore: il tetto del centro si azzera a mezzanotte UTC. */
  giorno: string;
  aggiuntiOggi: number;
}

export const giornoUtc = (adesso: Date): string => adesso.toISOString().slice(0, 10);

/** La coda salvata, ripulita; un giorno nuovo azzera il contatore ma non la coda. */
export function leggiCoda(salvata: string | null | undefined, adesso: Date): Coda {
  const vuota: Coda = { chiavi: [], giorno: giornoUtc(adesso), aggiuntiOggi: 0 };
  if (!salvata) return vuota;
  let v: unknown;
  try {
    v = JSON.parse(salvata);
  } catch {
    return vuota;
  }
  if (!v || typeof v !== "object") return vuota;
  const o = v as { chiavi?: unknown; giorno?: unknown; aggiuntiOggi?: unknown };
  const chiavi = Array.isArray(o.chiavi) ? [...new Set(o.chiavi.filter((x): x is string => typeof x === "string" && /^i:\d+$/.test(x)))] : [];
  const stesso = o.giorno === vuota.giorno;
  const n = typeof o.aggiuntiOggi === "number" && Number.isInteger(o.aggiuntiOggi) && o.aggiuntiOggi > 0 ? o.aggiuntiOggi : 0;
  return { chiavi, giorno: vuota.giorno, aggiuntiOggi: stesso ? n : 0 };
}

/** Un apparato è uscito dalla coda: `entrato` dice se conta nel tetto del giorno (aggiunto davvero). */
export function tolto(c: Coda, chiave: string, entrato: boolean, adesso: Date): Coda {
  const oggi = giornoUtc(adesso);
  const base = c.giorno === oggi ? c.aggiuntiOggi : 0;
  return { chiavi: c.chiavi.filter((x) => x !== chiave), giorno: oggi, aggiuntiOggi: base + (entrato ? 1 : 0) };
}

/** Il centro ha detto «basta per oggi»: il testo è quello di `TESTO_SCRITTURA.tetto_giornaliero`. */
export const eTettoDelGiorno = (messaggio: string): boolean => /massimo di oggetti per oggi|tetto del giorno|tetto_giornaliero/i.test(messaggio);

/** Quanto ci vuole a fare `chiamate` scritture al passo della coda, detto a parole. */
export function durata(chiamate: number): string {
  const s = Math.max(0, chiamate - SUBITO) * (PASSO_MS / 1000);
  if (s < 50) return "meno di un minuto";
  const m = Math.round(s / 60);
  return m < 90 ? `circa ${m} minuti` : `circa ${Math.round(m / 60)} ore`;
}

/** In quanti giorni entra una coda di `n` apparati, col tetto e con quelli già entrati oggi. */
export function giorniPer(n: number, aggiuntiOggi: number): number {
  const oggi = Math.max(0, TETTO_GIORNO - aggiuntiOggi);
  return n <= oggi ? 1 : 1 + Math.ceil((n - oggi) / TETTO_GIORNO);
}
