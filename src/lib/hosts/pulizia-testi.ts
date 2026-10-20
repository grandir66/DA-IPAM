/**
 * Le parole dell'interfaccia della pulizia degli host (piano 2026-10-20, Task 6). Modulo puro: lo importano i
 * componenti client e le prove. Niente DB.
 */
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";

export interface HostNominato { id: number; ip: string; nome: string }

export type RispostaApplica =
  | { tipo: "ok"; archiviati: HostNominato[]; nonPiuCandidati: HostNominato[]; cancellatiDallArchivio: HostNominato[] }
  /** 500: gli host sono stati archiviati, ma la cancellazione dell'archivio scaduto no (nessun host rimasto indietro). */
  | { tipo: "archivio_scaduto_fallito"; messaggio: string; archiviati: HostNominato[]; nonPiuCandidati: HostNominato[] }
  /** 500 a metà elenco: i primi sono archiviati, gli altri sono rimasti fra gli host. */
  | { tipo: "interrotta"; messaggio: string; archiviati: HostNominato[]; nonArchiviati: HostNominato[]; nonPiuCandidati: HostNominato[] }
  /** 400 o altro rifiuto con un messaggio: non si è toccato niente. */
  | { tipo: "rifiutata"; messaggio: string }
  | { tipo: "illeggibile" };

const eObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function elencoHost(v: unknown): HostNominato[] | null {
  if (!Array.isArray(v)) return null;
  const out: HostNominato[] = [];
  for (const x of v) {
    if (!eObj(x) || typeof x.id !== "number" || typeof x.ip !== "string" || typeof x.nome !== "string") return null;
    out.push({ id: x.id, ip: x.ip, nome: x.nome });
  }
  return out;
}

/** Legge la risposta di POST /api/hosts/pulizia. Un corpo che non ha la forma attesa è «illeggibile», mai un esito. */
export function leggiRispostaApplica(status: number, body: unknown): RispostaApplica {
  if (!eObj(body)) return { tipo: "illeggibile" };
  if (status === 200) {
    const archiviati = elencoHost(body.archiviati);
    const nonPiu = elencoHost(body.nonPiuCandidati);
    const cancellati = elencoHost(body.cancellatiDallArchivio);
    if (!archiviati || !nonPiu || !cancellati) return { tipo: "illeggibile" };
    return { tipo: "ok", archiviati, nonPiuCandidati: nonPiu, cancellatiDallArchivio: cancellati };
  }
  const messaggio = typeof body.error === "string" ? body.error : null;
  if (status === 500) {
    const archiviati = elencoHost(body.archiviati);
    const nonArchiviati = elencoHost(body.nonArchiviati);
    const nonPiu = elencoHost(body.nonPiuCandidati);
    if (messaggio && archiviati && nonArchiviati && nonPiu) {
      return nonArchiviati.length === 0
        ? { tipo: "archivio_scaduto_fallito", messaggio, archiviati, nonPiuCandidati: nonPiu }
        : { tipo: "interrotta", messaggio, archiviati, nonArchiviati, nonPiuCandidati: nonPiu };
    }
  }
  return messaggio ? { tipo: "rifiutata", messaggio } : { tipo: "illeggibile" };
}

/**
 * Come si dice la data di un IP precedente. Nello storico (`mac_ip_history`) la data è quando il MAC è ARRIVATO su
 * quell'IP, non quando se n'è andato; nell'archivio è l'ultima volta che l'host è stato visto.
 */
export function dataIpPrecedente(fonte: "storico" | "archivio", data: string): string {
  return fonte === "storico" ? `arrivato il ${data}` : `ultima vista il ${data}`;
}

/** Quando una riga d'archivio viene cancellata: `giorni` dopo l'archiviazione. Null se la data non si legge. */
export function scadenzaArchivio(archiviatoIl: string, giorni: number): Date | null {
  const t = parseDbDate(archiviatoIl);
  if (Number.isNaN(t.getTime())) return null;
  return new Date(t.getTime() + giorni * 86_400_000);
}

/** Data e ora nel fuso degli utenti; un valore illeggibile si mostra com'è. */
export function dataOra(valore: string | Date | null | undefined): string {
  if (valore === null || valore === undefined || valore === "") return "—";
  const t = typeof valore === "string" ? parseDbDate(valore) : valore;
  if (Number.isNaN(t.getTime())) return String(valore);
  return t.toLocaleString("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Solo la data, nel fuso degli utenti. */
export function soloData(valore: string | Date | null | undefined): string {
  if (valore === null || valore === undefined || valore === "") return "—";
  const t = typeof valore === "string" ? parseDbDate(valore) : valore;
  if (Number.isNaN(t.getTime())) return String(valore);
  return t.toLocaleDateString("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit", year: "numeric" });
}

/** «AABBCCDDEEFF» → «AA:BB:CC:DD:EE:FF»; tutto il resto com'è. */
export function macLeggibile(hex: string | null): string {
  if (!hex) return "—";
  return /^[0-9A-Fa-f]{12}$/.test(hex) ? hex.toUpperCase().match(/../g)!.join(":") : hex;
}

/** Il motivo come si legge in tabella: «Assente da 100 giorni», «IP cambiato: ora 10.0.1.81». */
export function motivoLeggibile(motivo: "assente" | "cambio_ip", dettaglio: string | null): string {
  const d = (dettaglio ?? "").trim();
  if (motivo === "cambio_ip") return d ? `IP cambiato: ${d}` : "IP cambiato";
  return d ? d.charAt(0).toUpperCase() + d.slice(1) : "Assente";
}
