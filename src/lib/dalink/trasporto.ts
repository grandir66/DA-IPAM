/**
 * Il trasporto del segnale verso DA-Link, con l'impronta del certificato (tappa C1).
 *
 * DA-Link presenta un certificato auto-firmato fino alla CA della tappa B: l'autorità è
 * l'impronta SPKI che DA-Link stesso ha scritto in `/etc/dalink/oggetto.env`. Niente CA,
 * niente verifica del nome: conta solo l'impronta. La verifica TLS non si spegne mai.
 *
 * Il token è il segreto dell'istanza: non parte MAI su un socket non verificato. Si apre
 * la connessione TLS, si controlla l'impronta PRIMA di scrivere un byte, e la richiesta
 * HTTP viaggia sullo stesso socket (`createConnection`). È il modello del client UniFi
 * (`integrations/unifi-api.ts`), non quello di `scanner-edge-client.ts`, che verifica e
 * poi apre un secondo socket accettando qualunque certificato.
 *
 * Nessun messaggio d'errore contiene il token o l'indirizzo.
 */
import { X509Certificate, createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

export type TipoErrore = "rete" | "cert" | "tempo" | "risposta";

export class ErroreDalink extends Error {
  constructor(
    public readonly tipo: TipoErrore,
    message: string,
  ) {
    super(message);
    this.name = "ErroreDalink";
  }
}

export interface RispostaDalink {
  status: number;
  body: string;
}

/** DA-Link risponde con due date: 64 KB sono già mille volte tanto. */
export const MAX_RISPOSTA = 64 * 1024;
const PERCORSO = "/api/v1/segnale";

/** Impronta SPKI nella forma di DA-IPAM (`sha256/<base64>`), come `spkiPinFromDer`. */
export function improntaDaDer(der: Buffer): string {
  const spki = new X509Certificate(der).publicKey.export({ type: "spki", format: "der" });
  return "sha256/" + createHash("sha256").update(spki).digest("base64");
}

function erroreDiRete(e: NodeJS.ErrnoException): ErroreDalink {
  if (e.code === "ETIMEDOUT") return new ErroreDalink("tempo", "DA-Link non ha risposto in tempo");
  if (e.code === "ECONNREFUSED") return new ErroreDalink("rete", "DA-Link non raggiungibile: connessione rifiutata");
  if (e.code === "ENOTFOUND" || e.code === "EAI_AGAIN") return new ErroreDalink("rete", "DA-Link non raggiungibile: nome non risolto");
  if (e.code === "EHOSTUNREACH" || e.code === "ENETUNREACH") return new ErroreDalink("rete", "DA-Link non raggiungibile: rete assente");
  return new ErroreDalink("rete", `DA-Link non raggiungibile (${e.code ?? "errore di rete"})`);
}

function apriSocketVerificato(host: string, porta: number, impronta: string, timeoutMs: number): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const sock = tlsConnect({
      host,
      port: porta,
      // Niente CA (auto-firmato fino alla tappa B): l'autorità è l'impronta, sotto.
      rejectUnauthorized: false,
      ...(isIP(host) ? {} : { servername: host }),
    });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new ErroreDalink("tempo", "DA-Link non ha completato il TLS in tempo"));
    }, timeoutMs);
    sock.once("secureConnect", () => {
      clearTimeout(timer);
      const cert = sock.getPeerCertificate(true);
      let vista: string;
      try {
        if (!cert?.raw?.length) throw new Error("vuoto");
        vista = improntaDaDer(cert.raw);
      } catch {
        sock.destroy();
        reject(new ErroreDalink("cert", "DA-Link non ha presentato un certificato leggibile"));
        return;
      }
      if (vista !== impronta) {
        sock.destroy();
        reject(new ErroreDalink("cert", "il certificato di DA-Link non corrisponde all'impronta della configurazione: niente inviato"));
        return;
      }
      resolve(sock);
    });
    sock.once("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(erroreDiRete(e));
    });
  });
}

/**
 * POST del segnale. Rifiuta con `ErroreDalink` per rete, certificato, tempo o risposta
 * troppo lunga; per un errore HTTP restituisce lo stato (lo interpreta il chiamante).
 */
export async function postSegnale(
  url: URL,
  impronta: string,
  token: string,
  corpo: string,
  opz: { timeoutMs?: number } = {},
): Promise<RispostaDalink> {
  const timeoutMs = opz.timeoutMs ?? 15_000;
  // URL.hostname tiene le quadre degli IPv6: tls.connect le vuole senza.
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  const porta = url.port ? Number(url.port) : 443;
  const percorso = url.pathname.replace(/\/+$/, "") + PERCORSO;
  const sock = await apriSocketVerificato(host, porta, impronta, timeoutMs);

  return new Promise((resolve, reject) => {
    let finito = false;
    const chiudi = (e: ErroreDalink | null, r?: RispostaDalink) => {
      if (finito) return;
      finito = true;
      if (e) reject(e);
      else if (r) resolve(r);
    };
    const req = httpsRequest(
      {
        host,
        port: porta,
        method: "POST",
        path: percorso,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(corpo)),
          Authorization: `Bearer ${token}`,
          Connection: "close",
        },
        // Il socket già verificato: niente agent, niente secondo handshake.
        createConnection: () => sock,
      },
      (res) => {
        const pezzi: Buffer[] = [];
        let totale = 0;
        res.on("data", (c: Buffer) => {
          if (finito) return;
          totale += c.length;
          if (totale > MAX_RISPOSTA) {
            req.destroy();
            chiudi(new ErroreDalink("risposta", "risposta di DA-Link oltre 64 KB: lettura interrotta"));
            return;
          }
          pezzi.push(c);
        });
        res.on("end", () => chiudi(null, { status: res.statusCode ?? 0, body: Buffer.concat(pezzi).toString("utf8") }));
        res.on("error", (e: NodeJS.ErrnoException) => chiudi(erroreDiRete(e)));
      },
    );
    req.on("error", (e: NodeJS.ErrnoException) => chiudi(erroreDiRete(e)));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      chiudi(new ErroreDalink("tempo", "DA-Link non ha risposto in tempo"));
    });
    req.end(corpo);
  });
}

/**
 * Una richiesta qualunque verso DA-Link sullo stesso socket verificato del segnale (vault semplice, passo 6: le rotte
 * `/api/v1/vault/…` col gettone dell'app). `url` è l'indirizzo completo, percorso e query compresi; le intestazioni
 * (gettone incluso) le dà il chiamante e partono solo dopo il controllo dell'impronta.
 *
 * Rifiuta con `ErroreDalink` per rete, certificato, tempo o risposta oltre `maxRisposta` (di serie 64 KB: il giro
 * dell'ambito del vault chiede di più); per un errore HTTP restituisce lo stato e il corpo, che interpreta il
 * chiamante (e che non deve finire nei suoi messaggi).
 */
export async function richiestaDalink(
  url: URL,
  impronta: string,
  metodo: string,
  intestazioni: Record<string, string>,
  corpo?: string,
  opz: { timeoutMs?: number; maxRisposta?: number } = {},
): Promise<RispostaDalink> {
  const timeoutMs = opz.timeoutMs ?? 15_000;
  const maxRisposta = opz.maxRisposta ?? MAX_RISPOSTA;
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  const porta = url.port ? Number(url.port) : 443;
  const sock = await apriSocketVerificato(host, porta, impronta, timeoutMs);

  return new Promise((resolve, reject) => {
    let finito = false;
    const chiudi = (e: ErroreDalink | null, r?: RispostaDalink) => {
      if (finito) return;
      finito = true;
      if (e) reject(e);
      else if (r) resolve(r);
    };
    const testa: Record<string, string> = { ...intestazioni, Connection: "close" };
    if (corpo !== undefined) testa["Content-Length"] = String(Buffer.byteLength(corpo));
    let req: ReturnType<typeof httpsRequest>;
    try {
      req = httpsRequest(
        {
          host,
          port: porta,
          method: metodo,
          path: url.pathname + url.search,
          headers: testa,
          // Il socket già verificato: niente agent, niente secondo handshake.
          createConnection: () => sock,
        },
        (res) => {
          const pezzi: Buffer[] = [];
          let totale = 0;
          res.on("data", (c: Buffer) => {
            if (finito) return;
            totale += c.length;
            if (totale > maxRisposta) {
              req.destroy();
              chiudi(new ErroreDalink("risposta", `risposta di DA-Link oltre ${Math.round(maxRisposta / 1024)} KB: lettura interrotta`));
              return;
            }
            pezzi.push(c);
          });
          res.on("end", () => chiudi(null, { status: res.statusCode ?? 0, body: Buffer.concat(pezzi).toString("utf8") }));
          res.on("error", (e: NodeJS.ErrnoException) => chiudi(erroreDiRete(e)));
        },
      );
    } catch {
      // Intestazione non valida (Node lancia prima di scrivere): il messaggio grezzo non si propaga.
      sock.destroy();
      chiudi(new ErroreDalink("risposta", "richiesta verso DA-Link non costruita: intestazioni non valide"));
      return;
    }
    req.on("error", (e: NodeJS.ErrnoException) => chiudi(erroreDiRete(e)));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      chiudi(new ErroreDalink("tempo", "DA-Link non ha risposto in tempo"));
    });
    req.end(corpo);
  });
}
