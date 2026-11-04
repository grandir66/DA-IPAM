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
 * Ordine per ogni host:
 * 1. nessuna porta di gestione aperta: `porte_chiuse`, senza login e senza toccare il budget;
 * 2. budget esaurito: `budget_esaurito`, prima della verifica, che è anch'essa un logon;
 * 3. verifica della password, una per voce in tutta l'esecuzione: `errata` ferma qui, zero tentativi su ogni macchina;
 * 4. le strade in ordine, col gate prima di ognuna, un tentativo per strada, ci si ferma alla prima riuscita.
 *
 * `strada` dell'esito: quella del motivo riportato. `null` vuol dire che su questo host non è partito nessun login:
 * chi persiste l'esito non deve registrare un fallimento, altrimenti allungherebbe il backoff di una voce mai provata.
 */
import { MAX_CONSECUTIVE_FAILURES_PER_RUN } from "./credential-anti-lockout";
import type { CredentialRunBudget } from "./credential-run-budget";
import type { EsitoPassword, VerificaPasswordRun } from "./verifica-password-run";
import type { WinrmErrorCode } from "@/lib/devices/winrm-errors";
import { WinrmError } from "@/lib/devices/winrm-run";
import { WmiError } from "@/lib/devices/wmi-run";

export type StradaWindows = "winrm" | "wmi";

export type MotivoAccesso =
  | "ok" | "diritti_mancanti" | "password_errata" | "firewall"
  | "porte_chiuse" | "nessuna_voce" | "budget_esaurito" | "errore";

/** Firma minima per `runWinrmCommand(host, port, username, password, "hostname", false, realm)`. */
export type ProvaWinrm = (
  host: string,
  port: number,
  username: string,
  password: string,
  command: "hostname",
  usePowershell: false,
  realm: string,
) => Promise<string>;

/** Firma minima per `runWmiIdentita(host, username, password)`. */
export type ProvaWmi = (host: string, username: string, password: string) => Promise<{ hostname: string }>;

export interface EsitoAccesso {
  strada: StradaWindows | null;
  motivo: MotivoAccesso;
  /** Per chi legge, mai utente né password. */
  dettaglio: string;
  /** Il nome che la macchina ha dato di sé: solo con `ok`. */
  nomeHost: string | null;
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
 * Codici che escludono un logon rifiutato: la connessione non c'è stata, o manca il bridge, o il servizio ha risposto
 * dopo l'autenticazione. Tutti gli altri, `UNKNOWN` e i codici nuovi compresi, possono nasconderne uno: il bridge
 * WinRM prova più trasporti e riporta l'ultimo errore, per esempio Basic disabilitato dopo un NTLM rifiutato.
 */
const CODICI_SENZA_LOGON_RIFIUTATO: ReadonlySet<string> = new Set<WinrmErrorCode>([
  "TCP_CLOSED", "TCP_TIMEOUT", "BRIDGE_TIMEOUT", "PYWINRM_MISSING", "WSMAN_FAULT",
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

function leggiErrore(err: unknown): { codice: string; messaggio: string } {
  if (err instanceof WinrmError || err instanceof WmiError) return { codice: err.code, messaggio: err.message };
  return { codice: "UNKNOWN", messaggio: err instanceof Error ? err.message : String(err) };
}

interface EsitoStrada {
  strada: StradaWindows;
  motivo: MotivoDiStrada;
  nota: string;
  /** `recordFailure` e stop: la password non è verificata e il logon può essere stato rifiutato. */
  ferma: boolean;
}

function classifica(
  strada: StradaWindows,
  err: unknown,
  password: Exclude<EsitoPassword, "errata">,
  input: InputAccessoWindows,
): EsitoStrada {
  const { codice, messaggio } = leggiErrore(err);
  const nome = NOME_STRADA[strada];
  const esito = (motivo: MotivoDiStrada, nota: string, ferma = false): EsitoStrada => ({
    strada, motivo, nota: `${nome}: ${nota}`, ferma,
  });

  if (!CODICI_SENZA_LOGON_RIFIUTATO.has(codice)) {
    if (password === "non_so") {
      return esito("errore", `accesso non riuscito con password non verificabile [${codice}]`, true);
    }
    if (codice === "AUTH_REJECTED") return esito("diritti_mancanti", "password giusta, accesso negato: mancano i diritti");
  }
  if (codice === "TCP_CLOSED") return esito("porte_chiuse", "porta chiusa");
  if (CODICI_TIMEOUT.has(codice) && input.porteAperte.includes(PORTA_WMI)) {
    return esito("firewall", `nessuna risposta in tempo, firewall da controllare [${codice}]`);
  }
  // Si maschera prima di tagliare: un taglio a metà lascerebbe un pezzo di password che la maschera non riconosce.
  const estratto = maschera(messaggio, input.username, input.password).slice(0, LIMITE_ESTRATTO);
  return esito("errore", estratto);
}

export async function provaAccessoWindows(input: InputAccessoWindows): Promise<EsitoAccesso> {
  const { ip, credId, porteAperte, username, password, budget } = input;

  const strade = stradeDaProvare(porteAperte);
  if (strade.length === 0) {
    return { strada: null, motivo: "porte_chiuse", dettaglio: "Nessuna porta di gestione Windows aperta.", nomeHost: null };
  }

  const ammessa = (backoffUntil: string | null): boolean =>
    budget.gate({ ip, credId, credType: "windows", hasWindowsIndicator: true, backoffUntil, nowIso: input.nowIso });
  const budgetEsaurito = (): boolean => budget.consecutiveFailures(credId) >= MAX_CONSECUTIVE_FAILURES_PER_RUN;
  const fermoBudget = (): EsitoAccesso => ({
    strada: null,
    motivo: "budget_esaurito",
    dettaglio: `Voce esclusa: ${budget.consecutiveFailures(credId)} fallimenti consecutivi in questa esecuzione.`,
    nomeHost: null,
  });

  if (!ammessa(null)) return fermoBudget();

  const esitoPassword = await input.verifica.esito(credId, ip);
  if (esitoPassword === "errata") {
    budget.recordWrongPassword(credId);
    return { strada: null, motivo: "password_errata", dettaglio: "Password errata: nessun tentativo.", nomeHost: null };
  }

  const provate: EsitoStrada[] = [];
  const note: string[] = [];
  let bloccata = false;

  for (const strada of strade) {
    const porta = portaDellaStrada(strada, porteAperte);
    const backoffUntil = input.backoffDi(strada, porta);
    if (!ammessa(backoffUntil)) {
      if (budgetEsaurito()) {
        bloccata = true;
        break;
      }
      note.push(`${NOME_STRADA[strada]}: voce in backoff fino a ${backoffUntil}, nessun tentativo`);
      continue;
    }

    let nomeHost = "";
    try {
      if (strada === "winrm") {
        nomeHost = (await input.prova.winrm(ip, porta, username, password, "hostname", false, input.dominioAd)).trim();
      } else {
        nomeHost = (await input.prova.wmi(ip, username, password)).hostname.trim();
      }
    } catch (err) {
      const esito = classifica(strada, err, esitoPassword, input);
      note.push(esito.nota);
      if (esito.ferma) {
        // Il rifiuto chiude la valutazione: la strada del rifiuto è quella su cui il chiamante registra il fallimento.
        budget.recordFailure(credId);
        return { strada, motivo: esito.motivo, dettaglio: note.join(" · "), nomeHost: null };
      }
      if (esito.motivo === "diritti_mancanti") budget.recordDenied(credId);
      provate.push(esito);
      continue;
    }

    if (nomeHost) {
      budget.recordSuccess(credId);
      note.push(`${NOME_STRADA[strada]}: accesso riuscito`);
      return { strada, motivo: "ok", dettaglio: note.join(" · "), nomeHost };
    }
    const vuota = `${NOME_STRADA[strada]}: risposta vuota`;
    note.push(vuota);
    provate.push({ strada, motivo: "errore", nota: vuota, ferma: false });
  }

  if (provate.length > 0) {
    const motivo = motivoPiuUtile(provate.map((p) => p.motivo));
    const vincente = provate.find((p) => p.motivo === motivo);
    return { strada: vincente?.strada ?? null, motivo, dettaglio: note.join(" · "), nomeHost: null };
  }
  if (bloccata) return fermoBudget();
  return { strada: null, motivo: "errore", dettaglio: note.join(" · "), nomeHost: null };
}
