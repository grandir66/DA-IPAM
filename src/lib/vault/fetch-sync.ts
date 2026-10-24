/**
 * Una richiesta HTTP SINCRONA (da-vault, scrittura dei segreti dall'hub, ADR 0035).
 *
 * Perché esiste: `creaVoceDb` / `modificaVoceDb` (l'unico punto che scrive una voce delle credenziali) sono chiamate da
 * una ventina di funzioni sincrone, molte dentro una `db.transaction()` di better-sqlite3 (apparati, binding, AD,
 * controller). Una transazione di better-sqlite3 non può contenere un `await`: per scrivere in OpenBao "subito", dentro la
 * stessa transazione, e far fallire tutto se OpenBao rifiuta, la richiesta deve essere sincrona.
 *
 * Come: un worker thread fa il `fetch`, il thread principale aspetta con `Atomics.wait` e legge la risposta con
 * `receiveMessageOnPort`. Il thread principale è fermo per la durata della richiesta (millisecondi sulla rete interna; al
 * massimo `timeoutMs` se OpenBao non risponde): va bene per una scrittura rara fatta da un amministratore, non per un
 * percorso caldo. Le LETTURE dei segreti restano sulla cache asincrona (`openbao.ts`).
 *
 * Il worker è un testo (`eval`), non un file: così funziona uguale sotto tsx, nel build di Next e nelle prove, senza
 * dipendere da dove un bundler mette i file. `NODE_EXTRA_CA_CERTS` vale anche per i worker (è del processo).
 *
 * Nessun messaggio contiene intestazioni, corpo o token: solo il tipo di errore.
 */
import { MessageChannel, receiveMessageOnPort, Worker } from "node:worker_threads";
import { ErroreVault } from "./tipi";

export interface RichiestaSync {
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export interface RispostaSync {
  status: number;
  testo: string;
}

export type FetchSync = (url: string, richiesta: RichiestaSync) => RispostaSync;

/** Margine oltre il timeout della richiesta per l'avvio del worker prima di dichiararlo perso. */
const MARGINE_AVVIO_MS = 4_000;

const CODICE_WORKER = `
const { workerData } = require("node:worker_threads");
const { flag, porta, url, metodo, intestazioni, corpo, timeoutMs } = workerData;
const segnale = new Int32Array(flag);
(async () => {
  let esito;
  try {
    const r = await fetch(url, { method: metodo, headers: intestazioni, body: corpo, signal: AbortSignal.timeout(timeoutMs) });
    esito = { status: r.status, testo: await r.text() };
  } catch (e) {
    esito = { errore: e && e.name ? String(e.name) : "errore" };
  }
  porta.postMessage(esito);
  Atomics.store(segnale, 0, 1);
  Atomics.notify(segnale, 0);
})();
`;

export const fetchSync: FetchSync = (url, richiesta) => {
  const flag = new SharedArrayBuffer(4);
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(CODICE_WORKER, {
    eval: true,
    workerData: {
      flag,
      porta: port2,
      url,
      metodo: richiesta.method,
      intestazioni: richiesta.headers,
      corpo: richiesta.body,
      timeoutMs: richiesta.timeoutMs,
    },
    transferList: [port2],
  });
  try {
    const attesa = Atomics.wait(new Int32Array(flag), 0, 0, richiesta.timeoutMs + MARGINE_AVVIO_MS);
    const msg = receiveMessageOnPort(port1)?.message as { status?: number; testo?: string; errore?: string } | undefined;
    if (attesa === "timed-out" || !msg) throw new ErroreVault("non_raggiungibile", "OpenBao non risponde (nessuna risposta dal worker)");
    if (msg.errore !== undefined) throw new ErroreVault("non_raggiungibile", `OpenBao non risponde (${msg.errore})`);
    return { status: msg.status ?? 0, testo: msg.testo ?? "" };
  } finally {
    port1.close();
    void worker.terminate();
  }
};
