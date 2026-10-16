/**
 * I testi di «Mappa nuova (una linea per cavo)» (spec topologia §13.11.4, T3.7), puri (nessun import di db-tenant: li
 * legge anche la pagina nel browser): lo stato in parole e il dialogo di accensione o spegnimento. Orari in ora italiana.
 */
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";
import type { StatoInterruttore } from "./interruttori";

export const TITOLO_MAPPA = "Mappa nuova (una linea per cavo)";

function giornoOra(utc: string | null): string {
  if (!utc) return "—";
  const d = parseDbDate(utc);
  if (Number.isNaN(d.getTime())) return "—";
  const p = new Intl.DateTimeFormat("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("day")}/${v("month")} alle ${v("hour")}:${v("minute")}`;
}

export function testoStatoMappa(s: StatoInterruttore): string {
  return s.acceso ? `Accesa dal ${giornoOra(s.il)} da ${s.da ?? "utente non noto"}.` : "Spenta: si vede la mappa di prima.";
}

export function testoDialogoMappa(accendi: boolean): string {
  return accendi
    ? "Con la mappa nuova ogni cavo è una linea sua, con la sua parola (bloccato, instradato, giù, fascio, tunnel, ponte radio); un segmento non gestito è un oggetto; l'albero segue lo spanning tree. Vale solo per questo cliente. Prima di accendere, ogni differenza di «Cosa cambierebbe con la mappa nuova» dovrebbe essere spiegata. Si spegne da qui: torna la mappa di prima, nessun dato si perde."
    : "Torna la mappa di prima (una linea per coppia). Le correzioni fatte con la mappa nuova restano salvate.";
}
