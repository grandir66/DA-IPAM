/** Le parole e i conti dei dialoghi «Unisci con…» e «Separa…» (piano 2026-10-16, Task 4). Puro: nessun DB, nessuna rete. */
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";
import type { MapNode } from "@/lib/topology/model-types";
import { PAROLA_COME, type MembroDelNodo } from "@/lib/topology/unioni-tipi";

/** Come `TESTO_OGGETTO_SOLO` di unioni.ts (che non si importa da un componente client): il nodo è già un oggetto solo. */
export const TESTO_NIENTE_DA_SEPARARE = "Questo indirizzo sulla mappa è un oggetto solo: non c'è niente da separare.";

/** «16/10» (fuso d'Italia) da una data-ora del DB; null se non si legge. */
export function giornoItaliano(il: string): string | null {
  const t = parseDbDate(il).getTime();
  if (Number.isNaN(t)) return null;
  return new Intl.DateTimeFormat("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit" }).format(new Date(t));
}

/** Perché un membro sta nell'oggetto, a parole. «unito a mano» porta la data italiana e chi l'ha fatto. */
export function parolaCome(m: Pick<MembroDelNodo, "come" | "aMano">): string {
  if (m.come === "oggetto") return "l'oggetto stesso";
  if (m.come !== "a_mano") return PAROLA_COME[m.come];
  if (!m.aMano) return PAROLA_COME.a_mano;
  const giorno = giornoItaliano(m.aMano.il);
  return giorno === null ? `${PAROLA_COME.a_mano} da ${m.aMano.da}` : `${PAROLA_COME.a_mano} il ${giorno} da ${m.aMano.da}`;
}

/**
 * Stima di quanti indirizzi si possono separare dal nodo, per decidere se mostrare «Separa…» (il dialogo dice il resto).
 * Apparato: i fusi meno l'host con l'IP di gestione (è l'apparato stesso). Nodo di soli host: i fusi + 1 (il rappresentante
 * esce anch'esso). Host solo o segmento: 0.
 */
export function membriSeparabili(n: Pick<MapNode, "kind" | "mgmtIp" | "fusedHostIds" | "addresses">): number {
  if (n.kind === "segmento") return 0;
  if (n.kind === "host") return n.fusedHostIds.length > 0 ? n.fusedHostIds.length + 1 : 0;
  const hostDiGestione = new Set(n.addresses.filter((a) => a.ip === n.mgmtIp && a.hostId !== null).map((a) => a.hostId));
  return n.fusedHostIds.filter((id) => !hostDiGestione.has(id)).length;
}

export function titoloUnisci(nome: string): string {
  return `Unisci «${nome}» con…`;
}
export function titoloSepara(nome: string): string {
  return `Separa da «${nome}»…`;
}
