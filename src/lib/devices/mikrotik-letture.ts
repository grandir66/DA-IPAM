/**
 * Le letture in più di un MikroTik via SSH (spec topologia §13.5.2, T2.2): una connessione sola (`withSshClient`), un
 * `exec` per comando, ognuno col suo tempo massimo e il suo esito; un errore si riconosce dal testo (ssh esce con 0). MK2 nel
 * ramo dei router è l'uscita che il giro ha già letto per la tabella del bridge (nessun comando nuovo); nel ramo degli
 * switch MikroTik si legge qui, con MK1 (i vicini, fonte `ssh`). MK7 (istanze MSTP) non si manda finché il suo lettore non
 * è scritto sull'uscita vera (Task 3b, T2-a): fino ad allora lo stato per istanza è «non letto». Sola lettura.
 *
 * Tre esiti per comando (spec §13.5.1): letto (l'uscita, anche vuota); non riuscito, con l'errore riconosciuto dal testo;
 * non so (tempo scaduto, `TEMPO_SCADUTO`; connessione caduta o canale chiuso senza codice d'uscita, `CONNESSIONE_CADUTA`;
 * un'uscita non vuota che il lettore non capisce, `USCITA_NON_CAPITA`; il codice del trasporto). Gli ultimi due danno
 * `null` («non letto»), mai una lista vuota, e nel resoconto il solo codice.
 */
import type { NetworkDevice } from "@/types";
import { codiceErrore } from "@/lib/devices/mikrotik-porte";
import { parseMikrotikNeighbors } from "@/lib/devices/mikrotik-vicini";
import { opzioniSshDiApparato, type NeighborEntry } from "@/lib/devices/router-client";
import { CODICE_CONNESSIONE_CADUTA, SshError, execConTempo, withSshClient, type SshOptions } from "@/lib/devices/ssh-transport";
import {
  erroreRouterOs, parseBridge, parseFasci, parseInterfacce, parseMonitorBridge, parseMonitorFasci, parseMonitorPorte,
  parsePorteBridge, type LetturaMk,
} from "@/lib/devices/mikrotik-stp";

/** Il tempo massimo di un comando nuovo (spec §13.5.1). Sulla rete B 32 comandi in circa un secondo: 20 s è largo. */
export const TEMPO_COMANDO_MS = 20_000;

/** I comandi, esatti, in sola lettura (spec §13.5.2). */
export const COMANDI_MK = {
  interfacce: "/interface print terse",
  vicini: "/ip neighbor print terse",
  bridge: "/interface bridge print terse without-paging",
  porteBridge: "/interface bridge port print terse without-paging",
  monitorBridge: "/interface bridge monitor [find] once",
  monitorPorte: "/interface bridge port monitor [find] once",
  fasci: "/interface bonding print terse without-paging",
  monitorFasci: "/interface bonding monitor [find] once",
} as const;

export type Esegui = (comando: string, tempoMs: number) => Promise<string>;
export type ApriEsecutore = <T>(device: NetworkDevice, fn: (esegui: Esegui) => Promise<T>) => Promise<T>;

/**
 * Il codice di un errore di trasporto. Un `SshError` (la connessione che non si apre) ha un tipo e un messaggio con host e
 * utente, non un codice: qui diventa `SSH_<TIPO>` (`SSH_CONNECT_TIMEOUT`, `SSH_AUTH_FAILED`…). Il resto come `codiceErrore`.
 */
export function codiceTrasporto(err: unknown): string {
  if (err instanceof SshError) return `SSH_${err.kind.toUpperCase()}`;
  return codiceErrore(err);
}

/**
 * I comandi su una connessione sola, aperta con queste opzioni e chiusa alla fine anche se un comando fallisce. Una
 * connessione caduta, o un canale chiuso senza codice d'uscita, dà `CONNESSIONE_CADUTA` («non so»): l'uscita può essere
 * tagliata e non si legge (revisione del Task 4 di T2). Dopo una caduta i comandi successivi non partono.
 */
export async function eseguiSuSsh<T>(opts: SshOptions, fn: (esegui: Esegui) => Promise<T>): Promise<T> {
  const caduta = (): Error => Object.assign(new Error("La connessione SSH è caduta durante il comando"), { code: CODICE_CONNESSIONE_CADUTA });
  try {
    return await withSshClient(opts, (conn) => {
      let chiusa = false;
      conn.once("close", () => { chiusa = true; });
      return fn(async (comando, tempoMs) => {
        if (chiusa) throw caduta();
        const r = await execConTempo(conn, comando, tempoMs);
        if (chiusa || typeof r.code !== "number") throw caduta();
        return r.stdout + r.stderr;
      });
    });
  } catch (err) {
    // Un nuovo errore col solo codice: il messaggio di ssh porta host e utente, e l'esito ne tiene solo il codice.
    if (err instanceof SshError) throw Object.assign(new Error("Connessione SSH non riuscita"), { code: codiceTrasporto(err) });
    throw err;
  }
}

/** La connessione vera: una per apparato e per lettura. */
export const apriEsecutoreSsh: ApriEsecutore = async (device, fn) => {
  const opts = opzioniSshDiApparato(device);
  if (!opts) throw Object.assign(new Error("Credenziali SSH mancanti"), { code: "SENZA_CREDENZIALI" });
  return eseguiSuSsh(opts, fn);
};

/** Un'uscita non vuota da cui il lettore non ricava nessuna riga: «non so», mai «letto e vuoto» (revisione del Task 4). */
export const CODICE_USCITA_NON_CAPITA = "USCITA_NON_CAPITA";
/** Un lettore che lancia su un'uscita: non riuscito, col suo codice (revisione del Task 4). */
export const CODICE_LETTORE_IN_ERRORE = "LETTORE_IN_ERRORE";

/**
 * L'esito di un'uscita già arrivata: un errore di RouterOS riconosciuto dal testo, un lettore che lancia, un'uscita non
 * vuota da cui non si ricava niente (fallisce chiuso: un «vuoto» falso scrive «nessun bridge» nel DB del cliente), oppure
 * le righe lette (anche nessuna, se l'uscita è vuota).
 */
export function interpretaUscita<T>(out: string, leggi: (out: string) => T[]): { valore: T[] } | { codice: string } {
  const errore = erroreRouterOs(out);
  if (errore) return { codice: errore };
  let valore: T[];
  try {
    valore = leggi(out);
  } catch {
    return { codice: CODICE_LETTORE_IN_ERRORE };
  }
  if (valore.length === 0 && out.trim() !== "") return { codice: CODICE_USCITA_NON_CAPITA };
  return { valore };
}

export interface RisultatoMk {
  lettura: LetturaMk;
  vicini: NeighborEntry[] | null;
  comandi: number;
  riusciti: number;
  /** Il primo errore, col solo codice (resoconto ed esito). */
  codice: string | null;
}

export async function leggiMikrotikTopologia(esegui: Esegui, opz: { uscitaInterfacce: string | null; conVicini: boolean }): Promise<RisultatoMk> {
  let comandi = 0, riusciti = 0;
  let codice: string | null = null;
  const prova = async <T>(cmd: string, leggi: (out: string) => T[]): Promise<T[] | null> => {
    comandi++;
    let out: string;
    try {
      out = await esegui(cmd, TEMPO_COMANDO_MS);
    } catch (e) {
      codice ??= codiceTrasporto(e);
      return null;
    }
    // Riuscito solo dopo il lettore (revisione del Task 4): un lettore che lancia, un errore dal testo o un'uscita che non
    // si capisce non contano, e hanno il loro codice.
    const r = interpretaUscita(out, leggi);
    if ("codice" in r) {
      codice ??= r.codice;
      return null;
    }
    riusciti++;
    return r.valore;
  };
  // MK2 già letto dal giro dei router: vale se si capisce; altrimenti si rilegge qui (errore dal testo o uscita strana).
  const daGiro = opz.uscitaInterfacce !== null ? interpretaUscita(opz.uscitaInterfacce, parseInterfacce) : null;
  const interfacce = daGiro !== null && "valore" in daGiro ? daGiro.valore : await prova(COMANDI_MK.interfacce, parseInterfacce);
  const vicini = opz.conVicini ? await prova(COMANDI_MK.vicini, parseMikrotikNeighbors) : null;
  const bridge = await prova(COMANDI_MK.bridge, parseBridge);
  const porteBridge = await prova(COMANDI_MK.porteBridge, parsePorteBridge);
  const monitorBridge = await prova(COMANDI_MK.monitorBridge, parseMonitorBridge);
  const monitorPorte = await prova(COMANDI_MK.monitorPorte, parseMonitorPorte);
  const fasci = await prova(COMANDI_MK.fasci, parseFasci);
  const monitorFasci = await prova(COMANDI_MK.monitorFasci, parseMonitorFasci);
  return { lettura: { interfacce, bridge, porteBridge, monitorBridge, monitorPorte, fasci, monitorFasci }, vicini, comandi, riusciti, codice };
}
