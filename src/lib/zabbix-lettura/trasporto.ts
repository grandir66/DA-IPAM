/**
 * Il trasporto verso l'API di lettura del centro Zabbix (passo 7.4), con la verifica
 * TLS sempre accesa.
 *
 * Due modi, nessuno dei due spegne la verifica:
 * - **senza impronta**: catena fino a un'autorità fidata e nome del certificato, la
 *   verifica di Node (`rejectUnauthorized: true`);
 * - **con impronta**: il certificato deve essere quello (SPKI `sha256/…` come DA-Link,
 *   oppure SHA-256 del certificato in esadecimale, come la mostra il browser). Serve
 *   quando l'indirizzo è un IP dell'overlay NetBird e il centro presenta un certificato
 *   che nessuna autorità ha firmato (§3 «TLS» del design).
 *
 * La chiave di lettura è un segreto: non parte MAI su un socket non verificato. Il
 * socket TLS si apre qui, si controlla l'impronta prima di scrivere un byte e la
 * richiesta HTTP viaggia sullo stesso socket (`createConnection`), come
 * `dalink/trasporto.ts`.
 *
 * Tempi (§6): 5 s per aprire la connessione (TCP + TLS), 15 s in tutto.
 * Nessun messaggio d'errore contiene la chiave.
 */
import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { improntaDaDer } from "@/lib/dalink/trasporto";

export const TEMPO_CONNESSIONE_MS = 5_000;
export const TEMPO_TOTALE_MS = 15_000;
/** Una pagina di 500 host sta in qualche centinaio di KB: 4 MB sono un tetto largo. */
export const MAX_RISPOSTA = 4 * 1024 * 1024;

export type TipoErroreLettura = "rete" | "tempo" | "certificato" | "http" | "risposta" | "cliente_errato";

export class ErroreLettura extends Error {
  constructor(
    public readonly tipo: TipoErroreLettura,
    message: string,
    public readonly dettagli: { status?: number; codice?: string; riprovaTraS?: number } = {},
  ) {
    super(message);
    this.name = "ErroreLettura";
  }
}

export interface RispostaGrezza {
  status: number;
  body: string;
  /** Intestazione `Retry-After` (secondi), se c'è. */
  retryAfter: string | null;
}

/** Una GET verso un percorso del centro (già con la query). */
export type Trasporto = (percorso: string) => Promise<RispostaGrezza>;

export interface ConnessioneCentro {
  base: URL;
  chiave: string;
  /** Impronta normalizzata (`normalizzaImprontaLettura`) o null = verifica di catena e nome. */
  impronta: string | null;
  /** Autorità in più di cui fidarsi (solo prove). */
  ca?: string[];
  tempoConnessioneMs?: number;
  tempoTotaleMs?: number;
}

const SPKI = /^sha256\/\/?([A-Za-z0-9+/]{43}=)$/;
const HEX = /^[0-9a-f]{64}$/;

/**
 * Impronta accettata in configurazione, in forma normalizzata, o null se malformata:
 * - SPKI come DA-Link (`sha256//<b64>`) o DA-IPAM (`sha256/<b64>`) → `sha256/<b64>`;
 * - SHA-256 del certificato, con o senza i due punti (`AB:CD:…`) → 64 esadecimali minuscoli.
 */
export function normalizzaImprontaLettura(v: string): string | null {
  const t = v.trim();
  const m = SPKI.exec(t);
  if (m) return `sha256/${m[1]}`;
  const hex = t.replace(/:/g, "").toLowerCase();
  return HEX.test(hex) ? hex : null;
}

/** Il certificato presentato corrisponde all'impronta (nell'una o nell'altra forma)? */
export function certificatoCorrisponde(der: Buffer, impronta: string): boolean {
  if (impronta.startsWith("sha256/")) {
    try {
      return improntaDaDer(der) === impronta;
    } catch {
      return false;
    }
  }
  return createHash("sha256").update(der).digest("hex") === impronta;
}

const CODICI_CERTIFICATO = /CERT|SIGNATURE|ALTNAME|ISSUER|SELF_SIGNED|DEPTH_ZERO/;

function erroreDiRete(e: NodeJS.ErrnoException): ErroreLettura {
  const code = e.code ?? "";
  if (CODICI_CERTIFICATO.test(code)) {
    if (code === "ERR_TLS_CERT_ALTNAME_INVALID") {
      return new ErroreLettura("certificato", "il certificato del centro non porta il nome dell'indirizzo configurato");
    }
    if (code === "CERT_HAS_EXPIRED") return new ErroreLettura("certificato", "il certificato del centro è scaduto");
    return new ErroreLettura(
      "certificato",
      "il certificato del centro non è firmato da un'autorità fidata: configura la sua impronta",
    );
  }
  if (code === "ETIMEDOUT") return new ErroreLettura("tempo", "il centro non ha risposto in tempo");
  if (code === "ECONNREFUSED") return new ErroreLettura("rete", "centro non raggiungibile: connessione rifiutata");
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new ErroreLettura("rete", "centro non raggiungibile: nome non risolto");
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") return new ErroreLettura("rete", "centro non raggiungibile: rete assente");
  if (code === "ECONNRESET") return new ErroreLettura("rete", "il centro ha chiuso la connessione");
  return new ErroreLettura("rete", `centro non raggiungibile (${code || "errore di rete"})`);
}

function apriSocket(c: ConnessioneCentro, host: string, porta: number, limiteMs: number): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const sock = tlsConnect({
      host,
      port: porta,
      // Con l'impronta l'autorità è l'impronta, controllata qui sotto prima di
      // scrivere; senza, catena e nome li verifica Node. Mai tutte e due spente.
      rejectUnauthorized: c.impronta === null,
      minVersion: "TLSv1.2",
      ...(c.ca ? { ca: c.ca } : {}),
      ...(isIP(host) ? {} : { servername: host }),
    });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new ErroreLettura("tempo", `il centro non ha aperto la connessione entro ${Math.round(limiteMs / 1000)} s`));
    }, limiteMs);
    sock.once("secureConnect", () => {
      clearTimeout(timer);
      if (c.impronta !== null) {
        const cert = sock.getPeerCertificate(true);
        const der = cert?.raw;
        if (!der?.length || !certificatoCorrisponde(der, c.impronta)) {
          sock.destroy();
          reject(
            new ErroreLettura(
              "certificato",
              "il certificato del centro non corrisponde all'impronta configurata: chiave non inviata",
            ),
          );
          return;
        }
      }
      resolve(sock);
    });
    sock.once("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(erroreDiRete(e));
    });
  });
}

/** Il trasporto TLS vero verso il centro. */
export function trasportoTls(c: ConnessioneCentro): Trasporto {
  const tempoConnessione = c.tempoConnessioneMs ?? TEMPO_CONNESSIONE_MS;
  const tempoTotale = c.tempoTotaleMs ?? TEMPO_TOTALE_MS;
  if (c.base.protocol !== "https:") {
    return () => Promise.reject(new ErroreLettura("rete", "l'indirizzo del centro deve essere https"));
  }
  // URL.hostname tiene le quadre degli IPv6: tls.connect le vuole senza.
  const host = c.base.hostname.replace(/^\[(.*)\]$/, "$1");
  const porta = c.base.port ? Number(c.base.port) : 443;

  return (percorso) =>
    new Promise<RispostaGrezza>((resolve, reject) => {
      let finito = false;
      let sock: TLSSocket | null = null;
      const chiudi = (e: ErroreLettura | null, r?: RispostaGrezza) => {
        if (finito) return;
        finito = true;
        clearTimeout(totale);
        if (e) {
          sock?.destroy();
          reject(e);
        } else if (r) resolve(r);
      };
      const totale = setTimeout(
        () => chiudi(new ErroreLettura("tempo", `il centro non ha risposto entro ${Math.round(tempoTotale / 1000)} s`)),
        tempoTotale,
      );
      apriSocket(c, host, porta, Math.min(tempoConnessione, tempoTotale))
        .then((s) => {
          if (finito) {
            s.destroy();
            return;
          }
          sock = s;
          const req = httpsRequest(
            {
              host,
              port: porta,
              method: "GET",
              path: percorso,
              headers: {
                Accept: "application/json",
                Authorization: `Bearer ${c.chiave}`,
                Connection: "close",
              },
              // Il socket già verificato: niente agent, niente secondo handshake.
              createConnection: () => s,
            },
            (res) => {
              const pezzi: Buffer[] = [];
              let n = 0;
              res.on("data", (b: Buffer) => {
                if (finito) return;
                n += b.length;
                if (n > MAX_RISPOSTA) {
                  req.destroy();
                  chiudi(new ErroreLettura("risposta", "risposta del centro oltre 4 MB: lettura interrotta"));
                  return;
                }
                pezzi.push(b);
              });
              res.on("end", () => {
                const ra = res.headers["retry-after"];
                chiudi(null, {
                  status: res.statusCode ?? 0,
                  body: Buffer.concat(pezzi).toString("utf8"),
                  retryAfter: typeof ra === "string" ? ra : null,
                });
              });
              res.on("error", (e: NodeJS.ErrnoException) => chiudi(erroreDiRete(e)));
            },
          );
          req.on("error", (e: NodeJS.ErrnoException) => chiudi(erroreDiRete(e)));
          req.end();
        })
        .catch((e: unknown) => chiudi(e instanceof ErroreLettura ? e : new ErroreLettura("rete", "centro non raggiungibile")));
    });
}
