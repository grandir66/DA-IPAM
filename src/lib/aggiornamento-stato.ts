/**
 * Lo stato dell'aggiornamento automatico, come lo scrive
 * `scripts/stato-aggiornamento.mjs` in `data/aggiornamento.json`, e come lo legge
 * l'interfaccia (Impostazioni → Aggiornamenti, banner) dopo «Aggiorna ora».
 *
 * Solo funzioni pure, senza moduli di Node: le usano anche i componenti client.
 * La lettura del file e l'avvio del servizio stanno in `aggiornamento-servizio.ts`.
 */

/** «pronto_non_avviato» (19/10, F03): build pronta, servizio fermo, avvio e salute non provati. */
export type EsitoTentativo = "in_corso" | "riuscito" | "fallito" | "interrotto" | "pronto_non_avviato";

export type EsitoControllo =
  | "gia_aggiornato"
  | "commit_fallito_attendo"
  | "solo_documentazione"
  | "aggiornamento_avviato"
  | "fetch_fallito"
  | "servizio_fermo"
  | "retrocessione_rifiutata";

export interface TentativoAggiornamento {
  commit: string;
  daCommit: string | null;
  iniziatoIl: string | null;
  finitoIl: string | null;
  fase: string | null;
  esito: EsitoTentativo | null;
  messaggio: string | null;
  avvisi: string[];
  tentativi: number | null;
}

export interface StatoAggiornamento {
  /** Il commit costruito e avviato con salute buona. */
  commitAvviato: string | null;
  ultimoTentativo: TentativoAggiornamento | null;
  ultimoSuccesso: { commit: string; il: string; nota: string | null } | null;
  /** Com'è finito l'ultimo giro di auto-update.sh, anche quando non c'era niente da fare. */
  ultimoControllo: { il: string; esito: EsitoControllo; richiestoDaInterfaccia: boolean } | null;
}

export const STATO_VUOTO: StatoAggiornamento = {
  commitAvviato: null,
  ultimoTentativo: null,
  ultimoSuccesso: null,
  ultimoControllo: null,
};

const ESITI_TENTATIVO: readonly EsitoTentativo[] = ["in_corso", "riuscito", "fallito", "interrotto", "pronto_non_avviato"];
const ESITI_CONTROLLO: readonly EsitoControllo[] = [
  "gia_aggiornato",
  "commit_fallito_attendo",
  "solo_documentazione",
  "aggiornamento_avviato",
  "fetch_fallito",
  "servizio_fermo",
  "retrocessione_rifiutata",
];

function oggetto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function testo(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function uno<T extends string>(v: unknown, ammessi: readonly T[]): T | null {
  return typeof v === "string" && (ammessi as readonly string[]).includes(v) ? (v as T) : null;
}

/**
 * Dal JSON del file allo stato tipizzato. Un campo strano diventa null invece di
 * un errore: lo stato è un resoconto, e un file a metà non deve rompere la pagina.
 */
export function interpretaStatoAggiornamento(dati: unknown): StatoAggiornamento {
  const radice = oggetto(dati);
  if (!radice) return STATO_VUOTO;

  const t = oggetto(radice.ultimo_tentativo);
  const commitTentato = t ? testo(t.commit) : null;
  const ultimoTentativo: TentativoAggiornamento | null =
    t && commitTentato
      ? {
          commit: commitTentato,
          daCommit: testo(t.da_commit),
          iniziatoIl: testo(t.iniziato_il),
          finitoIl: testo(t.finito_il),
          fase: testo(t.fase),
          esito: uno(t.esito, ESITI_TENTATIVO),
          messaggio: testo(t.messaggio),
          avvisi: Array.isArray(t.avvisi) ? t.avvisi.filter((a): a is string => typeof a === "string") : [],
          tentativi: typeof t.tentativi === "number" && Number.isFinite(t.tentativi) ? t.tentativi : null,
        }
      : null;

  const s = oggetto(radice.ultimo_successo);
  const commitSuccesso = s ? testo(s.commit) : null;
  const ilSuccesso = s ? testo(s.il) : null;

  const c = oggetto(radice.ultimo_controllo);
  const ilControllo = c ? testo(c.il) : null;
  const esitoControllo = c ? uno(c.esito, ESITI_CONTROLLO) : null;

  return {
    commitAvviato: testo(radice.commit_avviato),
    ultimoTentativo,
    ultimoSuccesso:
      s && commitSuccesso && ilSuccesso ? { commit: commitSuccesso, il: ilSuccesso, nota: testo(s.nota) } : null,
    ultimoControllo:
      c && ilControllo && esitoControllo
        ? { il: ilControllo, esito: esitoControllo, richiestoDaInterfaccia: c.richiesto_da_interfaccia === true }
        : null,
  };
}

/** Come sta andando l'aggiornamento chiesto all'ora `richiestoIl` (ISO, orologio del server). */
export type Avanzamento =
  | { tipo: "in_attesa" }
  | { tipo: "in_corso"; fase: string | null }
  | { tipo: "riuscito"; nota: string | null }
  | { tipo: "nessuna_novita" }
  | { tipo: "fallito"; messaggio: string; nonAvviata?: true };

/** Servizio fermo con la build pronta (19/10, F03): la build è cambiata, il processo non è partito. */
const NON_AVVIATA = "il servizio non è attivo: la build nuova è pronta e parte quando lo avvii";

/**
 * Le date sono ISO 8601 in UTC scritte dallo stesso server (`toISOString`), quindi
 * il confronto fra stringhe basta. Conta solo ciò che è successo DOPO la richiesta:
 * l'esito di un giro vecchio non risponde al pulsante appena premuto.
 */
export function valutaAvanzamento(stato: StatoAggiornamento, richiestoIl: string): Avanzamento {
  const t = stato.ultimoTentativo;
  if (t && t.iniziatoIl && t.iniziatoIl >= richiestoIl) {
    switch (t.esito) {
      case "riuscito":
        // Un controllo d'installazione fallito (verify-install) non è un «tutto bene» (19/10, F04).
        return { tipo: "riuscito", nota: t.avvisi.length > 0 ? `con avvisi: ${t.avvisi.join("; ")}` : null };
      case "pronto_non_avviato":
        return { tipo: "fallito", messaggio: NON_AVVIATA, nonAvviata: true };
      case "fallito":
      case "interrotto":
        return {
          tipo: "fallito",
          messaggio: t.messaggio ?? `aggiornamento ${t.esito === "interrotto" ? "interrotto" : "fallito"} (fase: ${t.fase ?? "sconosciuta"})`,
        };
      default:
        return { tipo: "in_corso", fase: t.fase };
    }
  }
  const c = stato.ultimoControllo;
  if (c && c.il >= richiestoIl) {
    switch (c.esito) {
      case "gia_aggiornato":
        return { tipo: "nessuna_novita" };
      case "solo_documentazione":
        return { tipo: "riuscito", nota: "solo documentazione: nessun riavvio" };
      case "fetch_fallito":
        return { tipo: "fallito", messaggio: "impossibile scaricare da GitHub (git fetch fallito)" };
      case "commit_fallito_attendo":
        return { tipo: "fallito", messaggio: "commit già fallito più volte: si aspetta un commit nuovo" };
      case "aggiornamento_avviato":
        return { tipo: "in_corso", fase: "inizio" };
      case "servizio_fermo":
        return { tipo: "fallito", messaggio: NON_AVVIATA, nonAvviata: true };
      case "retrocessione_rifiutata":
        return { tipo: "fallito", messaggio: "il ramo scelto ha una versione più vecchia di quella installata: aggiornamento rifiutato (scegli il canale giusto)" };
    }
  }
  return { tipo: "in_attesa" };
}

/** Le fasi di scripts/update.sh, in parole. */
export const NOMI_FASI: Record<string, string> = {
  inizio: "preparazione",
  pull: "scaricamento del codice",
  install: "installazione delle dipendenze",
  build: "build dell'applicazione",
  scambio: "passaggio alla build nuova",
  riavvio: "riavvio del servizio",
  salute: "controllo che l'app risponda",
};

export function nomeFase(fase: string | null): string {
  if (!fase) return "sconosciuta";
  return NOMI_FASI[fase] ?? fase;
}

export function commitBreve(commit: string | null | undefined): string {
  return commit ? commit.slice(0, 8) : "—";
}

/** Risposta di GET /api/system/update?action=aggiornamento. */
export interface RispostaStatoAggiornamento {
  stato: StatoAggiornamento;
  /** HEAD su disco: il codice scaricato, che gira solo dopo build e riavvio. */
  commitScaricato: string | null;
  /** Il servizio d'aggiornamento di systemd, o null se l'app non gira sotto systemd. */
  unita: string | null;
  /** Ora in cui è stato premuto «Aggiorna ora», se il servizio non l'ha ancora presa. */
  richiestaInAttesa: string | null;
}

/** Ogni quanto la pagina rilegge lo stato mentre l'aggiornamento è in corso. */
export const INTERVALLO_SEGUITO_MS = 3_000;
/**
 * Errori di rete o 502/503/504 di fila tollerati: durante il riavvio l'app non
 * risponde per un po' (fino a 90 s di salute più l'avvio). 100 × 3 s = 5 minuti.
 */
export const ERRORI_DI_FILA_MAX = 100;
/** Oltre questo tempo si smette di seguire: il build più lungo visto dura minuti. */
export const SEGUITO_MAX_MS = 30 * 60_000;

export type DecisioneSeguito =
  | { azione: "continua"; erroriDiFila: number }
  | { azione: "ferma"; motivo: "riuscito" | "fallito" | "nessuna_novita" | "sessione" | "irraggiungibile" | "tempo" };

/**
 * Che cosa fare dopo una lettura dello stato mentre si segue un aggiornamento.
 * `status` null = rete giù; 502/503/504 = nginx col servizio fermo (riavvio).
 */
export function decidiSeguito(input: {
  status: number | null;
  avanzamento: Avanzamento | null;
  erroriDiFila: number;
  trascorsiMs: number;
}): DecisioneSeguito {
  if (input.trascorsiMs > SEGUITO_MAX_MS) return { azione: "ferma", motivo: "tempo" };
  if (input.status === 401) return { azione: "ferma", motivo: "sessione" };
  if (!input.avanzamento) {
    const errori = input.erroriDiFila + 1;
    return errori > ERRORI_DI_FILA_MAX
      ? { azione: "ferma", motivo: "irraggiungibile" }
      : { azione: "continua", erroriDiFila: errori };
  }
  switch (input.avanzamento.tipo) {
    case "riuscito":
      return { azione: "ferma", motivo: "riuscito" };
    case "fallito":
      return { azione: "ferma", motivo: "fallito" };
    case "nessuna_novita":
      return { azione: "ferma", motivo: "nessuna_novita" };
    default:
      return { azione: "continua", erroriDiFila: 0 };
  }
}
