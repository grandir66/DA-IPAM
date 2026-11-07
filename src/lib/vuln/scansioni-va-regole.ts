/**
 * Pagina Scansioni VA (tavola approvata il 06/11/2026): si parte dal profilo, poi si scelgono le reti.
 *
 * Solo regole pure: le importano sia il server sia la pagina. Non esiste un oggetto «scansione»: la
 * pagina lancia su più reti e scrive le impostazioni di ciascuna, come il pannello VA Scan.
 *
 * Il profilo della pagina unisce le due scelte del pannello: la profondità Greenbone e il profilo
 * assessment di Edge. I profili assessment si leggono sempre da Edge: una voce il cui profilo manca
 * sulla sonda resta visibile e non si sceglie.
 */
import type { EdgeAssessmentProfile } from "@/lib/vuln/edge-profiles";
import type { EdgeScanProfile, EdgeTargetingMode } from "@/lib/vuln/edge-subnet-bridge";
import { contaModuli, vocePaginaDelProfilo, type VoceScansione } from "@/lib/vuln/profili-assessment-testi";
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";

export type IdVoce = "veloce" | "bilanciato" | "profondo" | "formale";
export type ModoScansione = "immediata" | "pianificata" | "finestra";

interface VoceBase {
  id: IdVoce;
  nome: string;
  serve: string;
  greenbone: EdgeScanProfile;
  greenboneNome: string;
  tempo: string;
  moduli: VoceScansione;
}

export const VOCI_BASE: readonly VoceBase[] = [
  { id: "veloce", nome: "Veloce", serve: "Primo passaggio su una rete interna.", greenbone: "fast", greenboneNome: "Veloce", tempo: "~15–30 min", moduli: "moduli-base" },
  { id: "bilanciato", nome: "Bilanciato", serve: "Tutte le letture su una subnet del cliente.", greenbone: "balanced", greenboneNome: "Bilanciato", tempo: "~1–3 h", moduli: "moduli-completi" },
  { id: "profondo", nome: "Profondo", serve: "Stesse letture, Greenbone al massimo.", greenbone: "deep", greenboneNome: "Profondo", tempo: "~8–24 h", moduli: "moduli-completi" },
  { id: "formale", nome: "Verifica formale", serve: "Con credenziali e autorizzazione scritta del cliente.", greenbone: "balanced", greenboneNome: "Bilanciato", tempo: "~1–3 h", moduli: "moduli-verifica" },
];

export interface VoceRisolta extends Omit<VoceBase, "moduli"> {
  /** Id del profilo sulla sonda; `null` = la sonda non ce l'ha: la voce non si sceglie. */
  assessmentId: string | null;
  moduliNome: string | null;
  autorizzazione: boolean;
}

/** Le quattro voci, ognuna col profilo che la sonda ha davvero. */
export function risolviVoci(catalogo: readonly EdgeAssessmentProfile[]): VoceRisolta[] {
  return VOCI_BASE.map(({ moduli, ...v }) => {
    const p = catalogo.find((c) => vocePaginaDelProfilo(c.id) === moduli) ?? null;
    return {
      ...v,
      assessmentId: p?.id ?? null,
      moduliNome: p ? `${p.label}, ${contaModuli(p)}` : null,
      autorizzazione: p?.requires_authorization ?? false,
    };
  });
}

/** Quanti profili della sonda non stanno nelle voci: si scelgono dal pannello VA Scan della rete. */
export function profiliFuoriDalleVoci(catalogo: readonly EdgeAssessmentProfile[]): number {
  return catalogo.filter((c) => vocePaginaDelProfilo(c.id) === null).length;
}

export const AMBITI: ReadonlyArray<{ id: EdgeTargetingMode; nome: string }> = [
  { id: "full_subnet", nome: "Tutto il CIDR" },
  { id: "populated_24", nome: "Solo /24 popolati" },
  { id: "found_ips", nome: "Solo IP che rispondono" },
];

export type Attivita = "in_corso" | "in_coda" | null;

/**
 * Cosa fa la sonda su quella rete. Una scansione Greenbone alla volta (Edge, 28/10/2026): le altre
 * restano `pending` col messaggio di coda e partono da sole quando la prima finisce.
 */
export function attivitaDaScansione(s: { status: string; error_message?: string | null } | null | undefined): Attivita {
  if (!s) return null;
  if (s.status === "running") return "in_corso";
  if (s.status !== "pending") return null;
  return (s.error_message ?? "").startsWith("in coda") ? "in_coda" : "in_corso";
}

export interface PianoRete {
  modo: "orario" | "finestra";
  testo: string;
}

/** Consenso valido a scansionare gli impianti della rete: lo tiene Edge, che applica la scadenza. */
export interface ConsensoRete {
  id: number;
  chi: string;
  riferimento: string;
  ips: string[];
  dato_il: string;
  scade_il: string;
}

export interface ReteScansione {
  id: number;
  nome: string;
  cidr: string;
  vlan: number | null;
  hostOnline: number;
  /** `errore` = la sonda non ha risposto per questa rete: non si sa, e non è «mai». */
  sonda: "nota" | "sconosciuta" | "errore";
  /** Data dell'ultima VA come la scrive la sonda (UTC); `null` = nessuna. */
  ultimaVa: string | null;
  ultimaVaStato: string | null;
  attivita: Attivita;
  piano: PianoRete | null;
  assessmentId: string | null;
  /** Host della rete che sono o possono essere impianti: la rete non si scansiona da questa pagina. */
  impianti: number;
  impiantiEsempi: string[];
  consenso?: ConsensoRete | null;
  /** La sonda sa del consenso. Falso = versione vecchia: il comando non c'è. */
  consensoNoto?: boolean;
}

export interface Scelta {
  modo: ModoScansione;
  /** Profilo assessment della voce scelta. */
  assessmentId: string | null;
}

export type TonoCambio = "nessuno" | "avviso" | "in_corso" | "impianto" | "consenso";

export interface Cambio {
  tono: TonoCambio;
  testo: string;
  /** La rete non si può scegliere. */
  blocca: boolean;
  /** Cambia qualcosa che resta salvato: la rete entra nel riepilogo prima del pulsante. */
  tocca: boolean;
}

/**
 * Colonna «Cosa cambia». Anche il lancio immediato lascia il profilo assessment sulla rete: la sonda
 * lo legge dalla sua riga a fine scansione, quindi una pianificazione esistente lo usa dal giro dopo.
 */
export function cosaCambia(rete: ReteScansione, s: Scelta): Cambio {
  // Il consenso vale per il lancio immediato: una pianificata o una finestra girano senza una persona davanti.
  const consenso = s.modo === "immediata" ? rete.consenso : null;
  if (rete.impianti > 0 && !consenso) {
    return { tono: "impianto", testo: `✕ Impianto in rete: ${rete.impianti === 1 ? "1 host" : `${rete.impianti} host`}`, blocca: true, tocca: false };
  }
  if (rete.attivita === "in_corso") return { tono: "in_corso", testo: "▶ In corso", blocca: true, tocca: false };
  if (rete.attivita === "in_coda") return { tono: "in_corso", testo: "… In coda", blocca: true, tocca: false };

  const moduliDiversi = !!rete.assessmentId && rete.assessmentId !== s.assessmentId;
  if (rete.impianti > 0 && consenso) {
    return { tono: "consenso", testo: testoConsenso(consenso), blocca: false, tocca: moduliDiversi };
  }
  if (s.modo === "immediata") {
    if (rete.piano?.modo === "finestra") return { tono: "avviso", testo: "▲ Parte fuori dalla finestra", blocca: false, tocca: moduliDiversi };
    if (rete.piano && rete.assessmentId !== s.assessmentId) return { tono: "avviso", testo: "▲ Cambia i moduli del piano attuale", blocca: false, tocca: true };
    if (moduliDiversi) return { tono: "avviso", testo: "▲ Cambia il profilo salvato", blocca: false, tocca: true };
    return { tono: "nessuno", testo: rete.piano ? "Il piano resta com'è" : "Nessun piano da cambiare", blocca: false, tocca: false };
  }
  if (!rete.piano) return { tono: "nessuno", testo: "Nessun piano da cambiare", blocca: false, tocca: false };
  if (rete.piano.modo === "finestra" && s.modo === "pianificata") {
    return { tono: "avviso", testo: "▲ Sostituisce il piano: la finestra si annulla", blocca: false, tocca: true };
  }
  return { tono: "avviso", testo: "▲ Sostituisce il piano attuale", blocca: false, tocca: true };
}

export function oraConsenso(scadeIl: string): string {
  return parseDbDate(scadeIl).toLocaleTimeString("it-IT", { timeZone: FUSO_UTENTI, hour: "2-digit", minute: "2-digit" });
}

export function testoConsenso(c: ConsensoRete): string {
  return `▲ Anche ${c.ips.length === 1 ? "1 impianto" : `${c.ips.length} impianti`}, fino alle ${oraConsenso(c.scade_il)}`;
}

const EVENTI: Record<string, { nome: string; segno: string; tono: "ok" | "in_corso" | "avviso" | "spento" | "errore" }> = {
  consenso_dato: { nome: "Consenso dato", segno: "▲", tono: "avviso" },
  consenso_revocato: { nome: "Consenso revocato", segno: "●", tono: "spento" },
  scansione_partita: { nome: "Scansione partita", segno: "▶", tono: "in_corso" },
  scansione_finita: { nome: "Scansione finita", segno: "✓", tono: "ok" },
  scansione_non_partita: { nome: "Scansione non partita", segno: "●", tono: "spento" },
  scansione_rifiutata: { nome: "Scansione rifiutata", segno: "●", tono: "spento" },
  impianto_muto: { nome: "Impianto muto, giro fermato", segno: "✕", tono: "errore" },
  giro_fermato: { nome: "Giro fermato", segno: "✕", tono: "errore" },
  rete_sbloccata: { nome: "Rete sbloccata", segno: "●", tono: "ok" },
};

/** Una parola nuova della sonda si mostra com'è: un evento del registro non si nasconde. */
export function eventoRegistro(evento: string) {
  return EVENTI[evento] ?? { nome: evento, segno: "●", tono: "spento" as const };
}

export function nomeEvento(evento: string): string {
  return eventoRegistro(evento).nome;
}

/** Il registro si legge in ora italiana, con i secondi: la sonda scrive UTC. */
export function dataRegistro(at: string): string {
  return parseDbDate(at).toLocaleString("it-IT", {
    timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

const PROFILI: Record<string, string> = { fast: "Veloce", balanced: "Bilanciato", deep: "Profondo" };

export function profiloRegistro(p: string | null): string {
  return p ? (PROFILI[p] ?? p) : "—";
}

export function dettaglioRegistro(d: string | null): string {
  return (d ?? "").replace(/vale fino al (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) UTC/, (_t, q: string) => `vale fino al ${dataRegistro(q)}`);
}

export interface Conteggi {
  inCorso: number;
  inCoda: number;
  pianificate: number;
  aFinestra: number;
}

export function conteggi(reti: readonly ReteScansione[]): Conteggi {
  return {
    inCorso: reti.filter((r) => r.attivita === "in_corso").length,
    inCoda: reti.filter((r) => r.attivita === "in_coda").length,
    pianificate: reti.filter((r) => r.piano?.modo === "orario").length,
    aFinestra: reti.filter((r) => r.piano?.modo === "finestra").length,
  };
}

export interface EsitoRete {
  id: number;
  nome: string;
  esito: "avviata" | "salvata" | "saltata" | "errore";
  motivo?: string;
}

export interface QuadroScansioni {
  edge: {
    stato: "acceso" | "spento" | "non_risponde";
    nome: string | null;
    versione: string | null;
    messaggio: string | null;
  };
  voci: VoceRisolta[];
  /** `null` = letto bene; altrimenti perché non si è potuto leggere il catalogo della sonda. */
  catalogoErrore: string | null;
  altriProfili: number;
  /** False solo se la sonda ha risposto che non ha la finestra. */
  finestraDisponibile: boolean;
  reti: ReteScansione[];
}
