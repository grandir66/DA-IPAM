/**
 * Motore di accesso Windows (piano accesso Windows, Task 4): per ogni host sceglie la strada, WinRM e poi WMI, e dà
 * all'esito un motivo preciso, senza bloccare account.
 *
 * Puro rispetto al database: non scrive e non chiama discovery. Le prove di rete sono iniettate (`ProvaWinrm`,
 * `ProvaWmi`), la persistenza è del chiamante.
 *
 * Perché: una password sbagliata fa un logon errato per host e per strada, ed è il blocco dell'account; i diritti
 * mancanti invece non bloccano niente e non devono fermare la scansione. Incidente 72729, 04/11/2026: 12 PC che
 * rifiutano un account di dominio con password giusta, e il budget avrebbe fermato la scansione dopo 3.
 *
 * Il limite conta i logon errati veri, non le voci e non le chiamate. Per questo una strada è un logon solo: con la
 * password non verificata WinRM parte con `unSoloLogon` (NTLM, niente kinit), altrimenti il bridge ne farebbe fino a
 * quattro; WMI ne fa uno da solo. E il conto è per account, cioè per utente: due voci dello stesso utente hanno un limite
 * solo, anche con password diverse. La verifica invece è per utente e password (`chiaveAccount`).
 *
 * Ordine per ogni host:
 * 1. nessuna porta di gestione aperta: `porte_chiuse`, senza login e senza toccare il budget;
 * 2. budget esaurito: `budget_esaurito`, prima della verifica, che è anch'essa un logon;
 * 3. tutte le strade in fermo: nessun login, e nemmeno il bind della verifica;
 * 4. verifica della password, una per utente e password in tutta l'esecuzione: `errata` ferma qui, zero tentativi su ogni macchina;
 * 5. le strade in ordine, prima quella già validata, col gate prima di ognuna, un tentativo per strada, ci si ferma alla
 *    prima riuscita.
 *
 * `strada` dell'esito: quella del motivo riportato. `null` vuol dire che su questo host non è partito nessun login:
 * chi persiste l'esito non deve registrare un fallimento, altrimenti allungherebbe il backoff di una voce mai provata.
 * `strade` riporta ogni strada provata, perché un rifiuto su WinRM resta vero anche se poi WMI entra.
 */
import { chiaveAccount, utenteNormalizzato } from "./account-windows";
import type { CredentialRunBudget } from "./credential-run-budget";
import type { EsitoPassword, VerificaPasswordRun } from "./verifica-password-run";
import type { WinrmErrorCode } from "@/lib/devices/winrm-errors";
import { WinrmError, type OpzioniWinrm } from "@/lib/devices/winrm-run";
import { WmiError } from "@/lib/devices/wmi-run";

export type StradaWindows = "winrm" | "wmi";

export type MotivoAccesso =
  | "ok" | "diritti_mancanti" | "password_errata" | "firewall"
  | "porte_chiuse" | "nessuna_voce" | "budget_esaurito" | "errore";

/** Firma minima per `runWinrmCommand(host, port, username, password, "hostname", false, realm, opzioni)`. */
export type ProvaWinrm = (
  host: string,
  port: number,
  username: string,
  password: string,
  command: "hostname",
  usePowershell: false,
  realm: string,
  opzioni?: OpzioniWinrm,
) => Promise<string>;

/** Firma minima per `runWmiIdentita(host, username, password)`. */
export type ProvaWmi = (host: string, username: string, password: string) => Promise<{ hostname: string }>;

/**
 * Che cosa si sa del logon di una strada: `riuscito` (anche con una risposta inutile), `rifiutato` (è il solo caso che
 * vale un fallimento pieno: la riga e il legame perdono la validazione), `ignoto` (timeout, firewall, errori).
 */
export type EsitoLogon = "riuscito" | "rifiutato" | "ignoto";

/** Una strada provata. */
export interface EsitoDiStrada {
  strada: StradaWindows;
  porta: number;
  motivo: MotivoDiStrada;
  /** Per chi legge, mai utente né password. */
  dettaglio: string;
  logon: EsitoLogon;
}

export interface EsitoAccesso {
  strada: StradaWindows | null;
  motivo: MotivoAccesso;
  /** Per chi legge, mai utente né password. */
  dettaglio: string;
  /** Il nome che la macchina ha dato di sé: solo con `ok`. */
  nomeHost: string | null;
  /** Tutte le strade provate, nell'ordine. Vuoto se non è partito nessun login. */
  strade: EsitoDiStrada[];
}

export interface InputAccessoWindows {
  ip: string;
  hostId: number;
  credId: number;
  porteAperte: readonly number[];
  username: string;
  password: string;
  dominioAd: string;
  verifica: VerificaPasswordRun;
  budget: CredentialRunBudget;
  /** `host_credentials.backoff_until` di questa voce per strada e porta, o null. */
  backoffDi: (strada: StradaWindows, porta: number) => string | null;
  /** "now" ISO-8601 iniettabile; di serie l'ora vera. */
  nowIso?: string;
  /** La strada già validata di questa voce su questo host: si prova per prima. */
  stradaValidata?: StradaWindows | null;
  prova: { winrm: ProvaWinrm; wmi: ProvaWmi };
}

const PORTE_WINRM: readonly number[] = [5985, 5986];
const PORTA_WMI = 135;

const NOME_STRADA: Record<StradaWindows, string> = { winrm: "WinRM", wmi: "WMI" };

/**
 * Quale motivo tiene chi ha due strade: vince `ok`, poi il più utile a chi legge. Una password errata o i diritti
 * dicono cosa fare; firewall dice dove guardare; errore è generico; porte chiuse è il meno informativo, perché su quella
 * strada non c'è servizio.
 */
export const ORDINE_MOTIVI = ["ok", "password_errata", "diritti_mancanti", "firewall", "errore", "porte_chiuse"] as const;

export type MotivoDiStrada = (typeof ORDINE_MOTIVI)[number];

/** Il motivo che vince fra quelli delle strade provate. Con zero motivi non c'è niente da scegliere: `errore`. */
export function motivoPiuUtile(motivi: readonly MotivoDiStrada[]): MotivoDiStrada {
  for (const motivo of ORDINE_MOTIVI) {
    if (motivi.includes(motivo)) return motivo;
  }
  return "errore";
}

/**
 * Codici che non nascondono un logon rifiutato: il bridge non è partito, la richiesta non era valida, o il servizio ha
 * risposto dopo l'autenticazione. Tutti gli altri, `UNKNOWN` e i codici nuovi compresi, possono farlo. Gli errori di rete
 * no: un timeout del bridge può venire dopo un rifiuto, e l'unico timeout certo è quello del controllo TCP fatto prima
 * del bridge (`primaDelBridge`).
 */
const CODICI_SENZA_LOGON_RIFIUTATO: ReadonlySet<string> = new Set<WinrmErrorCode>([
  "PYWINRM_MISSING", "IMPACKET_MISSING", "BRIDGE_INPUT", "WSMAN_FAULT",
]);

const CODICI_TIMEOUT: ReadonlySet<string> = new Set<WinrmErrorCode>(["TCP_TIMEOUT", "BRIDGE_TIMEOUT"]);

/** Limite dell'estratto dell'errore nel dettaglio, applicato dopo la maschera. */
const LIMITE_ESTRATTO = 200;

/** 5985 → `["winrm","wmi"]` se c'è anche la 135, altrimenti `["winrm"]`; solo 135 → `["wmi"]`; nessuna → `[]`. */
export function stradeDaProvare(porteAperte: readonly number[]): StradaWindows[] {
  const strade: StradaWindows[] = [];
  if (porteAperte.some((p) => PORTE_WINRM.includes(p))) strade.push("winrm");
  if (porteAperte.includes(PORTA_WMI)) strade.push("wmi");
  return strade;
}

/** La porta usata da una strada: per WinRM la 5986 solo se la 5985 non c'è, come `pickWinrmPort` di discovery. */
export function portaDellaStrada(strada: StradaWindows, porteAperte: readonly number[]): number {
  if (strada === "wmi") return PORTA_WMI;
  return porteAperte.includes(5986) && !porteAperte.includes(5985) ? 5986 : 5985;
}

function escapeRegex(testo: string): string {
  return testo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Il testo come appare dentro un JSON: una barra o un apice cambiano forma, e un bridge riporta anche quello. */
function comeInJson(testo: string): string {
  return JSON.stringify(testo).slice(1, -1);
}

/** Nasconde utente e password in ogni forma nota: intera, nuda (`DOM\u`, `u@dom`, `.\u`), dentro un JSON, in ogni caso. */
function maschera(testo: string, username: string, password: string): string {
  const nudo = (username.split("\\").pop() ?? "").split("@")[0];
  const varianti = [password, comeInJson(password), username, comeInJson(username), nudo]
    .filter((v) => v.length > 0)
    .sort((a, b) => b.length - a.length);
  let risultato = testo;
  for (const variante of varianti) {
    risultato = risultato.replace(new RegExp(escapeRegex(variante), "gi"), "***");
  }
  return risultato;
}

/** L'errore come lo legge il motore. Un rifiuto dichiarato dal bridge è `AUTH_REJECTED`, qualunque sia l'ultimo errore. */
function leggiErrore(err: unknown): { codice: string; messaggio: string; primaDelBridge: boolean } {
  if (err instanceof WinrmError) {
    return { codice: err.rifiutato ? "AUTH_REJECTED" : err.code, messaggio: err.message, primaDelBridge: err.primaDelBridge };
  }
  if (err instanceof WmiError) return { codice: err.code, messaggio: err.message, primaDelBridge: err.primaDelBridge };
  return { codice: "UNKNOWN", messaggio: err instanceof Error ? err.message : String(err), primaDelBridge: false };
}

interface Classificato {
  motivo: MotivoDiStrada;
  dettaglio: string;
  logon: EsitoLogon;
  /** `recordFailure` e stop: la password non è verificata e il logon può essere stato rifiutato. */
  ferma: boolean;
}

function classifica(
  strada: StradaWindows,
  err: unknown,
  password: Exclude<EsitoPassword, "errata">,
  input: InputAccessoWindows,
): Classificato {
  const { codice, messaggio, primaDelBridge } = leggiErrore(err);
  const nome = NOME_STRADA[strada];
  const logon: EsitoLogon = codice === "AUTH_REJECTED" ? "rifiutato" : "ignoto";
  const esito = (motivo: MotivoDiStrada, nota: string, ferma = false): Classificato => ({
    motivo, dettaglio: `${nome}: ${nota}`, logon, ferma,
  });

  if (!primaDelBridge && !CODICI_SENZA_LOGON_RIFIUTATO.has(codice) && password === "non_so") {
    return esito("errore", `accesso non riuscito con password non verificabile [${codice}]`, true);
  }
  if (codice === "AUTH_REJECTED") return esito("diritti_mancanti", "password giusta, accesso negato: mancano i diritti");
  if (codice === "TCP_CLOSED") return esito("porte_chiuse", "porta chiusa");
  if (CODICI_TIMEOUT.has(codice) && input.porteAperte.includes(PORTA_WMI)) {
    return esito("firewall", `nessuna risposta in tempo, firewall da controllare [${codice}]`);
  }
  // Si maschera prima di tagliare: un taglio a metà lascerebbe un pezzo di password che la maschera non riconosce.
  const estratto = maschera(messaggio, input.username, input.password).slice(0, LIMITE_ESTRATTO);
  return esito("errore", estratto);
}

/** La strada validata per prima, se su questo host si può provare. */
function primaLaValidata(strade: StradaWindows[], validata: StradaWindows | null | undefined): StradaWindows[] {
  return validata && strade.includes(validata) ? [validata, ...strade.filter((s) => s !== validata)] : strade;
}

export async function provaAccessoWindows(input: InputAccessoWindows): Promise<EsitoAccesso> {
  const { ip, credId, porteAperte, username, password, budget } = input;

  const strade = primaLaValidata(stradeDaProvare(porteAperte), input.stradaValidata);
  if (strade.length === 0) {
    return { strada: null, motivo: "porte_chiuse", dettaglio: "Nessuna porta di gestione Windows aperta.", nomeHost: null, strade: [] };
  }

  const account = chiaveAccount(username, password);
  budget.legaAccount(credId, utenteNormalizzato(username), account);

  const ammessa = (backoffUntil: string | null): boolean =>
    budget.gate({ ip, credId, credType: "windows", hasWindowsIndicator: true, backoffUntil, nowIso: input.nowIso });
  const fermoBudget = (): EsitoAccesso => ({
    strada: null,
    motivo: "budget_esaurito",
    dettaglio: `Voce esclusa: ${budget.consecutiveFailures(credId)} fallimenti consecutivi in questa esecuzione.`,
    nomeHost: null,
    strade: [],
  });

  if (!ammessa(null)) return fermoBudget();

  // Il fermo si legge prima della verifica: se nessuna strada può partire, anche il bind sarebbe un logon per niente.
  const note: string[] = [];
  const libere: Array<{ strada: StradaWindows; porta: number; backoffUntil: string | null }> = [];
  for (const strada of strade) {
    const porta = portaDellaStrada(strada, porteAperte);
    const backoffUntil = input.backoffDi(strada, porta);
    if (ammessa(backoffUntil)) libere.push({ strada, porta, backoffUntil });
    else note.push(`${NOME_STRADA[strada]}: voce in backoff fino a ${backoffUntil}, nessun tentativo`);
  }
  if (libere.length === 0) return { strada: null, motivo: "errore", dettaglio: note.join(" · "), nomeHost: null, strade: [] };

  const esitoPassword = await input.verifica.esito(credId, ip, account);
  if (esitoPassword === "errata") {
    budget.recordWrongPassword(credId);
    return { strada: null, motivo: "password_errata", dettaglio: "Password errata: nessun tentativo.", nomeHost: null, strade: [] };
  }

  const provate: EsitoDiStrada[] = [];
  // Con la password giusta la catena del bridge non fa logon errati; senza, ogni trasporto in più è un logon errato.
  const opzioniWinrm: [] | [OpzioniWinrm] = esitoPassword === "valida" ? [] : [{ unSoloLogon: true }];

  for (const { strada, porta, backoffUntil } of libere) {
    // Il gate si richiede prima di ogni strada: il budget può essere finito sulla strada di prima.
    if (!ammessa(backoffUntil)) break;

    let nomeHost = "";
    try {
      if (strada === "winrm") {
        nomeHost = (await input.prova.winrm(ip, porta, username, password, "hostname", false, input.dominioAd, ...opzioniWinrm)).trim();
      } else {
        nomeHost = (await input.prova.wmi(ip, username, password)).hostname.trim();
      }
    } catch (err) {
      const { ferma, ...esito } = classifica(strada, err, esitoPassword, input);
      note.push(esito.dettaglio);
      provate.push({ strada, porta, ...esito });
      if (ferma) {
        // Il rifiuto chiude la valutazione: la strada del rifiuto è quella su cui il chiamante registra il fallimento.
        budget.recordFailure(credId);
        return { strada, motivo: esito.motivo, dettaglio: note.join(" · "), nomeHost: null, strade: provate };
      }
      if (esito.motivo === "diritti_mancanti") budget.recordDenied(credId);
      continue;
    }

    if (nomeHost) {
      budget.recordSuccess(credId);
      const riuscita = `${NOME_STRADA[strada]}: accesso riuscito`;
      note.push(riuscita);
      provate.push({ strada, porta, motivo: "ok", dettaglio: riuscita, logon: "riuscito" });
      return { strada, motivo: "ok", dettaglio: note.join(" · "), nomeHost, strade: provate };
    }
    const vuota = `${NOME_STRADA[strada]}: risposta vuota`;
    note.push(vuota);
    provate.push({ strada, porta, motivo: "errore", dettaglio: vuota, logon: "riuscito" });
  }

  if (provate.length === 0) return fermoBudget();
  const motivo = motivoPiuUtile(provate.map((p) => p.motivo));
  const vincente = provate.find((p) => p.motivo === motivo);
  return { strada: vincente?.strada ?? null, motivo, dettaglio: note.join(" · "), nomeHost: null, strade: provate };
}
