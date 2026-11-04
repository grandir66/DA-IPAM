/**
 * Verifica della password una volta per esecuzione (piano accesso Windows, Task 3).
 *
 * Perché: il motore di scansione deve distinguere «password errata» da «diritti mancanti». Senza questa verifica,
 * una password sbagliata produce un logon errato per ogni host e per ogni strada: in dominio è il blocco
 * dell'account. Qui si fa UNA domanda per voce in tutta l'esecuzione, con la strada che non lascia effetti:
 * - LDAP sul DC (sulla prima integrazione AD accesa), solo se l'utente è del dominio dell'integrazione: un account
 *   locale su LDAP sarebbe un logon errato inutile sul DC. Solo cifrato: se StartTLS fallisce niente bind in chiaro, la
 *   voce è un amministratore, e sul DC del cliente StartTLS fallisce davvero;
 * - se LDAP non sa rispondere, e solo per lo stesso utente del dominio dell'integrazione, SMB sulla 445 del primo host
 *   (login, nessuna condivisione aperta).
 *
 * Ogni altro account è sempre `non_so`, senza nessun login: utente senza dominio, `DOM\admin` con dominio ignoto, e ogni
 * utente quando non c'è un'integrazione AD accesa. `PC-CONTAB\admin` è locale ma non si distingue da `DOM\admin`: vive su
 * una macchina sola, e `valida` o `errata` lì non dicono nulla delle altre, dove la password può essere diversa. Esteso a
 * tutta l'esecuzione, un rifiuto diventerebbe `diritti_mancanti` e non conterebbe sul limite di 3. Con `non_so` il limite
 * resta (decisione del 04/11/2026).
 *
 * Tre esiti, `errata` SOLO con prova certa: LDAP `InvalidCredentialsError` con `data 52e`, SMB
 * `STATUS_LOGON_FAILURE`. `valida` da SMB solo su una macchina del dominio dell'integrazione. Account disabilitato (533), scaduto (532, 773), bloccato (775), utente ignoto (525),
 * timeout, trasporto: `non_so`. Un errore di trasporto non è una risposta.
 *
 * Il risultato sta in memoria per la vita dell'istanza e non si scrive da nessuna parte. Si memorizza la Promise,
 * non il risultato: due chiamate contemporanee per lo stesso account fanno una verifica sola. Una voce con `non_so`
 * non ritenta su un altro host. Con `account` la verifica è una per account e non per voce, e `errata` si ricorda anche
 * fra un giro e l'altro (`RicordoErrate`): un bind sbagliato a ogni giro è la strada per il blocco.
 */
import { execFile } from "child_process";
import { Client, InvalidCredentialsError } from "ldapts";
import type { NuovoClientLdap } from "@/lib/ad/ad-client";
import { getAdIntegrations, getDb, type AdIntegration } from "@/lib/db";
import { coppiaLoginDb } from "@/lib/credentials/segreti";
import { findBridgePython } from "@/lib/devices/find-bridge-python";
import { probeTcpPort } from "@/lib/devices/tcp-precheck";
import type { DipendenzeWmi } from "@/lib/devices/wmi-run";
import { risolvi } from "@/lib/percorsi";
import type { RicordoErrate } from "./account-windows";

export type EsitoPassword = "valida" | "errata" | "non_so";

/** Tetto di ogni prova: una macchina che non risponde non ferma la scansione. */
export const TETTO_VERIFICA_MS = 15_000;
const TIMEOUT_PORTA_445_MS = 3000;
const SCRIPT_SMB = risolvi(process.cwd(), "src/lib/devices/smb-login.py");

export class VerificaPasswordRun {
  private readonly verifiche = new Map<number | string, Promise<EsitoPassword>>();

  constructor(
    private readonly prove: {
      ldap: (credId: number) => Promise<EsitoPassword>;
      smb: (credId: number, ip: string) => Promise<EsitoPassword>;
    },
    private readonly ricordo?: RicordoErrate,
  ) {}

  /**
   * Una sola verifica per account in tutta l'esecuzione; senza `account`, per voce. `ip` serve solo se LDAP dà non_so.
   * `account` è `chiaveAccount`: due voci con la stessa chiave hanno lo stesso utente e la stessa password.
   */
  esito(credId: number, ip: string, account?: string): Promise<EsitoPassword> {
    const chiave = account ?? credId;
    let verifica = this.verifiche.get(chiave);
    if (!verifica) {
      verifica = this.verifica(credId, ip, account);
      this.verifiche.set(chiave, verifica);
    }
    return verifica;
  }

  private async verifica(credId: number, ip: string, account: string | undefined): Promise<EsitoPassword> {
    if (account && this.ricordo?.ricorda(account)) return "errata";
    const esito = await this.domanda(credId, ip);
    if (esito === "errata" && account) this.ricordo?.segna(account);
    return esito;
  }

  private async domanda(credId: number, ip: string): Promise<EsitoPassword> {
    const ldap = await this.prova(() => this.prove.ldap(credId));
    if (ldap !== "non_so") return ldap;
    return this.prova(() => this.prove.smb(credId, ip));
  }

  /** Una prova che lancia non ha risposto: `non_so`. */
  private async prova(fn: () => Promise<EsitoPassword>): Promise<EsitoPassword> {
    try {
      return await fn();
    } catch {
      return "non_so";
    }
  }
}

/* ------------------------------------------------------------ account e dominio */

export interface AccountVoce {
  username: string;
  password: string;
}

/**
 * L'utente e la password della voce Windows, ripuliti come per il login: si verifica la password che userà il login, non
 * un'altra con uno spazio in coda, che darebbe `errata` su una voce che entra. Voce assente, di altro tipo o senza
 * utente/password → null.
 */
function accountDellaVoce(credId: number): AccountVoce | null {
  try {
    return coppiaLoginDb(getDb(), credId, "windows");
  } catch (err) {
    console.warn(`[verifica-password] voce #${credId} non leggibile: ${err instanceof Error ? err.name : "errore"}`);
    return null;
  }
}

/** Il dominio scritto nel nome: `DOM\utente`, `utente@dom`. Vuoto se non c'è o se indica la macchina stessa (`.`, `localhost`). */
function dominioDelNome(username: string): string {
  let candidato = "";
  const barra = username.indexOf("\\");
  const chiocciola = username.lastIndexOf("@");
  if (barra >= 0) candidato = username.slice(0, barra);
  else if (chiocciola >= 0) candidato = username.slice(chiocciola + 1);
  candidato = candidato.trim().toLowerCase();
  return candidato === "." || candidato === "localhost" ? "" : candidato;
}

/**
 * L'utente è del dominio dell'integrazione? `DOM\utente` e `utente@dom` valgono se `dom` è il dominio intero o il
 * suo primo pezzo (NetBIOS), senza maiuscole/minuscole. Utente nudo, `.\utente`, dominio vuoto, nome del PC, altro
 * suffisso: no. È l'unica domanda che regge: il nome da solo non dice se il prefisso è un dominio o un PC.
 */
export function utenteDelDominio(username: string, dominioIntegrazione: string): boolean {
  const dominio = dominioIntegrazione.trim().toLowerCase();
  if (!dominio) return false;
  const candidato = dominioDelNome(username);
  if (!candidato) return false;
  return candidato === dominio || candidato === dominio.split(".")[0];
}

/* ------------------------------------------------------------------------ LDAP */

export interface DipendenzeLdap {
  account: (credId: number) => AccountVoce | null;
  integrazione: () => AdIntegration | undefined;
  nuovoClient: NuovoClientLdap;
  tettoMs: number;
}

/** La prima integrazione AD accesa: la stessa per LDAP e per SMB. */
function primaIntegrazioneAccesa(): AdIntegration | undefined {
  return getAdIntegrations().filter((i) => i.enabled === 1).sort((a, b) => a.id - b.id)[0];
}

const LDAP_REALI: DipendenzeLdap = {
  account: accountDellaVoce,
  integrazione: primaIntegrazioneAccesa,
  nuovoClient: (opzioni) => new Client(opzioni),
  tettoMs: TETTO_VERIFICA_MS,
};

/** `errata` solo per il rifiuto di AD con `data 52e` (password sbagliata); ogni altro errore è `non_so`. */
export function esitoDaErroreLdap(err: unknown): EsitoPassword {
  if (err instanceof InvalidCredentialsError && /\bdata 52e\b/i.test(err.message)) return "errata";
  return "non_so";
}

async function chiudi(client: Client): Promise<void> {
  try {
    await client.unbind();
  } catch {
    /* connessione già chiusa o mai aperta */
  }
}

/**
 * Bind LDAP con l'account della voce sulla prima integrazione AD accesa. Come `connectLdap` tenta StartTLS, ma se fallisce
 * non fa il bind in chiaro: `non_so`, e tocca a SMB. Un account che non è del dominio non fa nessun logon sul DC: `non_so`.
 */
export async function provaLdapDellaVoce(credId: number, deps: Partial<DipendenzeLdap> = {}): Promise<EsitoPassword> {
  const d: DipendenzeLdap = { ...LDAP_REALI, ...deps };
  const account = d.account(credId);
  if (!account) return "non_so";
  const integrazione = d.integrazione();
  if (!integrazione) return "non_so";
  if (!utenteDelDominio(account.username, integrazione.domain)) return "non_so";

  const ssl = Boolean(integrazione.use_ssl);
  const client = d.nuovoClient({
    url: `${ssl ? "ldaps" : "ldap"}://${integrazione.dc_host}:${integrazione.port}`,
    tlsOptions: ssl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: Math.min(10_000, d.tettoMs),
    timeout: d.tettoMs,
  });

  const lavoro = (async (): Promise<EsitoPassword> => {
    if (!ssl) {
      try {
        await client.startTLS({ rejectUnauthorized: false });
      } catch {
        return "non_so";
      }
    }
    await client.bind(account.username, account.password);
    return "valida";
  })().catch(esitoDaErroreLdap);

  let timer: NodeJS.Timeout | undefined;
  const scaduto = new Promise<EsitoPassword>((resolve) => {
    timer = setTimeout(() => resolve("non_so"), d.tettoMs);
  });
  try {
    return await Promise.race([lavoro, scaduto]);
  } finally {
    clearTimeout(timer);
    void chiudi(client); // su un bind rimasto appeso non si aspetta la chiusura
  }
}

/* ------------------------------------------------------------------------- SMB */

export type DipendenzeSmb = DipendenzeWmi & {
  account: (credId: number) => AccountVoce | null;
  integrazione: () => AdIntegration | undefined;
};

const SMB_REALI: DipendenzeSmb = {
  account: accountDellaVoce,
  integrazione: primaIntegrazioneAccesa,
  execFile: (file, args, opts, cb) => execFile(file, [...args], opts, cb),
  probeTcpPort,
  trovaPython: findBridgePython,
};

const ESITI: readonly EsitoPassword[] = ["valida", "errata", "non_so"];

/** Legge l'esito dall'output dello script; qualunque cosa non sia uno dei tre esiti è `non_so`. */
function esitoDaOutputSmb(stdout: string): EsitoPassword {
  try {
    const parsed: unknown = JSON.parse(stdout.trim());
    if (parsed && typeof parsed === "object") {
      const esito = (parsed as { esito?: unknown }).esito;
      if (typeof esito === "string" && (ESITI as readonly string[]).includes(esito)) return esito as EsitoPassword;
    }
  } catch {
    /* output non JSON */
  }
  return "non_so";
}

/**
 * Login SMB con l'account della voce, senza aprire condivisioni (`smb-login.py`). Solo per un utente del dominio
 * dell'integrazione AD accesa: ogni altro account è `non_so` senza alcun login (vedi in cima). Se la 445 non è aperta: `non_so`.
 * Password solo su stdin. `STATUS_LOGON_FAILURE` = `errata`, sessione vera = `valida`, il resto `non_so`.
 */
export async function provaSmbDellaVoce(credId: number, ip: string, deps: Partial<DipendenzeSmb> = {}): Promise<EsitoPassword> {
  const d: DipendenzeSmb = { ...SMB_REALI, ...deps };
  const account = d.account(credId);
  if (!account) return "non_so";
  const integrazione = d.integrazione();
  if (!integrazione || !utenteDelDominio(account.username, integrazione.domain)) return "non_so";
  const porta = await d.probeTcpPort(ip, 445, TIMEOUT_PORTA_445_MS);
  if (porta.state !== "open") return "non_so";

  return new Promise<EsitoPassword>((resolve) => {
    try {
      const figlio = d.execFile(
        d.trovaPython(),
        [SCRIPT_SMB],
        { timeout: TETTO_VERIFICA_MS, maxBuffer: 1024 * 1024, encoding: "utf-8" },
        (error, stdout) => resolve(error && !stdout ? "non_so" : esitoDaOutputSmb(stdout)),
      );
      figlio.stdin?.write(JSON.stringify({ host: ip, username: account.username, password: account.password, dominio: integrazione.domain, port: 445 }));
      figlio.stdin?.end();
    } catch {
      resolve("non_so");
    }
  });
}
