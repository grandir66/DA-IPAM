/**
 * Il trasporto HTTPS verso l'hub DA-Vul-can (A-IPAM, Task 5): uno solo per ping,
 * battito, AD Health e inventario.
 *
 * - Verifica TLS normale: l'hub ha un certificato valido (jolly di `domarc.it`) e si
 *   usano le CA di sistema; `ca` serve SOLO alle prove. Mai `rejectUnauthorized: false`.
 * - Il gettone non parte su un socket non verificato: si apre il TLS, si aspetta
 *   l'handshake verificato (nome compreso) e la richiesta HTTP viaggia su quello stesso
 *   socket (`createConnection`), come in `dalink/trasporto.ts`.
 * - Nessun agente (quindi nessun socket condiviso), nessun rimando seguito (un 3xx torna com'è e lo scarta il
 *   giro), risposta letta al massimo 64 KB, un tempo massimo per tutta la chiamata.
 * - Lo stato HTTP lo interpreta il chiamante (`giro.ts`): qui si rifiuta solo per rete,
 *   certificato, tempo o risposta troppo lunga, con frasi nostre senza gettone, indirizzo
 *   o porta.
 */
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

export type TipoErroreHub = "rete" | "cert" | "tempo" | "risposta";

export class ErroreHub extends Error {
  constructor(
    public readonly tipo: TipoErroreHub,
    message: string,
  ) {
    super(message);
    this.name = "ErroreHub";
  }
}

export type PercorsoHub = "/api/ipam/ping" | "/api/ipam/heartbeat" | "/api/ipam/ad-health" | "/api/ipam/inventario";

export interface RichiestaHub {
  /** Origine dell'hub (https), come la rende `leggiConfigVulcan`. */
  url: URL;
  token: string;
  /** Versione di DA-IPAM, in `X-DA-IPAM-Version`. */
  versione: string;
  metodo: "GET" | "POST";
  percorso: PercorsoHub;
  /** Già compresso (dalla coda, o `gzipSync` per il battito); obbligatorio sui POST. */
  corpoGz?: Buffer;
  /** Predefinito 30 s (60 s per l'inventario). */
  timeoutMs?: number;
  /** SOLO per le prove: l'hub vero usa le CA di sistema. */
  ca?: string | Buffer;
}

export interface RispostaHub {
  status: number;
  body: string;
}

/** L'hub risponde con un id o una data: 64 KB sono già mille volte tanto. */
export const MAX_RISPOSTA_HUB = 64 * 1024;
export const TEMPO_PREDEFINITO_MS = 30_000;
export const TEMPO_INVENTARIO_MS = 60_000;

const SENZA_RISPOSTA = "l'hub non ha risposto in tempo";

/** Codici di OpenSSL/Node per un certificato non accettato (catena, scadenza, nome). */
const CODICE_CERT = /CERT|SELF_SIGNED|UNABLE_TO_|ALTNAME|HOSTNAME|ERR_TLS_|ERR_SSL_/;

function erroreDiRete(e: NodeJS.ErrnoException): ErroreHub {
  const code = e.code ?? "";
  if (CODICE_CERT.test(code)) return new ErroreHub("cert", "certificato dell'hub non valido: niente inviato");
  if (code === "ETIMEDOUT") return new ErroreHub("tempo", SENZA_RISPOSTA);
  if (code === "ECONNREFUSED") return new ErroreHub("rete", "hub DA-Vul-can non raggiungibile: connessione rifiutata");
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new ErroreHub("rete", "hub DA-Vul-can non raggiungibile: nome non risolto");
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") return new ErroreHub("rete", "hub DA-Vul-can non raggiungibile: rete assente");
  if (code === "ECONNRESET" || code === "EPIPE") return new ErroreHub("rete", "hub DA-Vul-can: connessione interrotta");
  // Solo il codice, mai il messaggio di Node (può contenere indirizzo e porta).
  return new ErroreHub("rete", `hub DA-Vul-can non raggiungibile (${/^[A-Z0-9_]{1,40}$/.test(code) ? code : "errore di rete"})`);
}

function apriSocketVerificato(host: string, porta: number, ca: string | Buffer | undefined): { sock: TLSSocket; pronto: Promise<void> } {
  const sock = tlsConnect({
    host,
    port: porta,
    rejectUnauthorized: true,
    ...(isIP(host) ? {} : { servername: host }),
    ...(ca !== undefined ? { ca } : {}),
  });
  const pronto = new Promise<void>((resolve, reject) => {
    sock.once("secureConnect", () => {
      // Con rejectUnauthorized il TLS fallito non arriva qui; il controllo resta, a costo zero.
      if (!sock.authorized) {
        sock.destroy();
        reject(new ErroreHub("cert", "certificato dell'hub non valido: niente inviato"));
        return;
      }
      resolve();
    });
    sock.once("error", (e: NodeJS.ErrnoException) => reject(erroreDiRete(e)));
  });
  return { sock, pronto };
}

/**
 * Una chiamata all'hub. Rifiuta con `ErroreHub` per rete, certificato, tempo o risposta
 * troppo lunga; per qualunque stato HTTP (anche 3xx, 4xx, 5xx) restituisce stato e corpo.
 */
export async function chiamaHub(r: RichiestaHub): Promise<RispostaHub> {
  if (r.url.protocol !== "https:") throw new ErroreHub("rete", "l'hub DA-Vul-can si chiama solo in https: niente inviato");
  if (r.metodo === "POST" && !r.corpoGz) throw new ErroreHub("rete", "corpo mancante per l'invio all'hub: niente inviato");
  if (r.metodo === "GET" && r.corpoGz) throw new ErroreHub("rete", "una lettura dall'hub non porta corpo: niente inviato");

  const timeoutMs = r.timeoutMs ?? (r.percorso === "/api/ipam/inventario" ? TEMPO_INVENTARIO_MS : TEMPO_PREDEFINITO_MS);
  // URL.hostname tiene le quadre degli IPv6: tls.connect le vuole senza.
  const host = r.url.hostname.replace(/^\[(.*)\]$/, "$1");
  const porta = r.url.port ? Number(r.url.port) : 443;

  const { sock, pronto } = apriSocketVerificato(host, porta, r.ca);
  let timer: NodeJS.Timeout | undefined;
  const scadenza = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      sock.destroy();
      reject(new ErroreHub("tempo", SENZA_RISPOSTA));
    }, timeoutMs);
  });
  try {
    await Promise.race([pronto, scadenza]);
    return await Promise.race([richiesta(r, host, porta, sock), scadenza]);
  } finally {
    clearTimeout(timer);
    sock.destroy();
  }
}

function richiesta(r: RichiestaHub, host: string, porta: number, sock: TLSSocket): Promise<RispostaHub> {
  return new Promise((resolve, reject) => {
    let finito = false;
    const chiudi = (e: ErroreHub | null, ris?: RispostaHub) => {
      if (finito) return;
      finito = true;
      if (e) reject(e);
      else if (ris) resolve(ris);
    };
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${r.token}`,
      "X-DA-IPAM-Version": r.versione,
      Connection: "close",
    };
    if (r.corpoGz) {
      headers["Content-Type"] = "application/json";
      headers["Content-Encoding"] = "gzip";
      headers["Content-Length"] = String(r.corpoGz.length);
    }
    const req = httpsRequest(
      {
        host,
        port: porta,
        method: r.metodo,
        path: r.percorso,
        headers,
        // Il socket già verificato: niente secondo handshake. Niente `agent` (nemmeno
        // `false`): con un agente Node ignorerebbe `createConnection` e aprirebbe un
        // secondo TLS senza la `ca` delle prove. Senza agente non c'è condivisione.
        createConnection: () => sock,
      },
      (res) => {
        const pezzi: Buffer[] = [];
        let totale = 0;
        res.on("data", (c: Buffer) => {
          if (finito) return;
          totale += c.length;
          if (totale > MAX_RISPOSTA_HUB) {
            req.destroy();
            chiudi(new ErroreHub("risposta", "risposta dell'hub oltre 64 KB: lettura interrotta"));
            return;
          }
          pezzi.push(c);
        });
        res.on("end", () => chiudi(null, { status: res.statusCode ?? 0, body: Buffer.concat(pezzi).toString("utf8") }));
        res.on("error", (e: NodeJS.ErrnoException) => chiudi(erroreDiRete(e)));
      },
    );
    req.on("error", (e: NodeJS.ErrnoException) => chiudi(erroreDiRete(e)));
    req.end(r.corpoGz);
  });
}
