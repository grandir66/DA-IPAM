/**
 * Chi ha l'archivio degli utenti aperto in questo momento (ADR 0043). La chiave sta solo qui, in memoria del processo:
 * mai sul disco, mai in un cookie. Si richiude da sola dopo `SENZA_GESTI_MS` senza gesti e comunque dopo `MASSIMO_MS`;
 * un riavvio richiude tutti. Lo stato sta su `globalThis`, come quello del vault: `server.ts` e le rotte di Next sono
 * bundle diversi dello stesso processo.
 */
export const SENZA_GESTI_MS = 10 * 60_000;
export const MASSIMO_MS = 60 * 60_000;

interface Sessione {
  chiave: Uint8Array;
  apertaAlle: number;
  ultimoGesto: number;
}

const CHIAVE = Symbol.for("da-ipam.archivio-utenti.sessioni");
function sessioni(): Map<number, Sessione> {
  const g = globalThis as unknown as Record<symbol, Map<number, Sessione> | undefined>;
  return (g[CHIAVE] ??= new Map());
}

/** Quando si richiude questa sessione (millisecondi). */
function scadenza(s: Sessione): number {
  return Math.min(s.ultimoGesto + SENZA_GESTI_MS, s.apertaAlle + MASSIMO_MS);
}

export function apriSessione(utenteId: number, chiave: Uint8Array, ora: number = Date.now()): number {
  chiudiSessione(utenteId);
  const s: Sessione = { chiave: new Uint8Array(chiave), apertaAlle: ora, ultimoGesto: ora };
  sessioni().set(utenteId, s);
  return scadenza(s);
}

/** Azzera la chiave in memoria e toglie la sessione. Dice se c'era. */
export function chiudiSessione(utenteId: number): boolean {
  const s = sessioni().get(utenteId);
  if (!s) return false;
  s.chiave.fill(0);
  sessioni().delete(utenteId);
  return true;
}

/**
 * La chiave dell'utente se la sua sessione vale ancora, e la rinnova (è un gesto); altrimenti `null`, e una sessione
 * scaduta si chiude qui. `tocca: false` guarda soltanto (la barra di stato non allunga la sessione).
 */
export function chiaveAperta(utenteId: number, op: { ora?: number; tocca?: boolean } = {}): { chiave: Uint8Array; scade: number } | null {
  const ora = op.ora ?? Date.now();
  const s = sessioni().get(utenteId);
  if (!s) return null;
  if (ora >= scadenza(s)) {
    chiudiSessione(utenteId);
    return null;
  }
  if (op.tocca !== false) s.ultimoGesto = ora;
  return { chiave: s.chiave, scade: scadenza(s) };
}

/** Chiude le sessioni scadute (giro periodico) e dice a chi. */
export function chiudiScadute(ora: number = Date.now()): number[] {
  const chiuse: number[] = [];
  for (const [id, s] of sessioni()) if (ora >= scadenza(s)) chiuse.push(id);
  for (const id of chiuse) chiudiSessione(id);
  return chiuse;
}

export function chiudiTutte(): void {
  for (const id of [...sessioni().keys()]) chiudiSessione(id);
}
