/**
 * Chiamate al collector di traffico: HTTPS con certificato autofirmato, riconosciuto
 * dall'impronta SHA-256 salvata alla registrazione. L'impronta si controlla PRIMA di
 * mandare il gettone: a un certificato diverso non arriva niente, e non c'è ripiego.
 */
import { request as httpRequest } from "node:http";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

export class ImprontaCambiata extends Error {
  constructor() {
    super("Il certificato del collector non è quello registrato (impronta diversa)");
    this.name = "ImprontaCambiata";
  }
}
export class CollectorErrore extends Error {
  constructor(messaggio: string, readonly stato?: number) {
    super(messaggio);
    this.name = "CollectorErrore";
  }
}

export interface CollectorAccesso {
  url: string;
  gettone: string;
  impronta: string;
}

export const TEMPO_MASSIMO_MS = 15_000;

/** «6D:8F:…» e «6d8f…» sono la stessa impronta. */
export function normalizzaImpronta(i: string): string {
  return i.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

/** `https://host:porta` del collector, senza percorso. Null se non è un indirizzo https valido. */
export function urlCollector(testo: string): URL | null {
  try {
    const u = new URL(testo.trim());
    if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

function apri(u: URL, impronta: string, scadenza: number): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const s = tlsConnect({
      host: u.hostname,
      port: Number(u.port || 8477),
      // Autofirmato: la fiducia viene dall'impronta controllata qui sotto, non da una CA.
      rejectUnauthorized: false,
      timeout: Math.max(1, scadenza - Date.now()),
    });
    s.once("secureConnect", () => {
      const vista = normalizzaImpronta(s.getPeerCertificate().fingerprint256 ?? "");
      if (!vista || vista !== normalizzaImpronta(impronta)) {
        s.destroy();
        reject(new ImprontaCambiata());
        return;
      }
      resolve(s);
    });
    s.once("timeout", () => s.destroy(new CollectorErrore("Il collector non risponde")));
    s.once("error", (e) => reject(e instanceof CollectorErrore ? e : new CollectorErrore(`Collector non raggiungibile: ${e.message}`)));
  });
}

export async function collectorGet<T>(c: CollectorAccesso, percorso: string): Promise<T> {
  const u = urlCollector(c.url);
  if (!u) throw new CollectorErrore("Indirizzo del collector non valido");
  const scadenza = Date.now() + TEMPO_MASSIMO_MS;
  const socket = await apri(u, c.impronta, scadenza);
  return new Promise<T>((resolve, reject) => {
    const fine = setTimeout(() => req.destroy(new CollectorErrore("Il collector non risponde")), Math.max(1, scadenza - Date.now()));
    const req = httpRequest(
      {
        createConnection: () => socket,
        host: u.hostname,
        path: percorso,
        method: "GET",
        headers: { Authorization: `Bearer ${c.gettone}`, Accept: "application/json", Connection: "close" },
      },
      (res) => {
        const pezzi: Buffer[] = [];
        let lungo = 0;
        res.on("data", (p: Buffer) => {
          lungo += p.length;
          if (lungo > 8 * 1024 * 1024) req.destroy(new CollectorErrore("Risposta del collector troppo grande"));
          else pezzi.push(p);
        });
        res.on("end", () => {
          clearTimeout(fine);
          if (res.statusCode === 401) return reject(new CollectorErrore("Il collector rifiuta il gettone", 401));
          if (res.statusCode !== 200) return reject(new CollectorErrore(`Il collector risponde ${res.statusCode}`, res.statusCode));
          try {
            resolve(JSON.parse(Buffer.concat(pezzi).toString("utf8")) as T);
          } catch {
            reject(new CollectorErrore("Risposta del collector illeggibile"));
          }
        });
      },
    );
    req.on("error", (e) => {
      clearTimeout(fine);
      socket.destroy();
      reject(e instanceof CollectorErrore ? e : new CollectorErrore(`Collector non raggiungibile: ${e.message}`));
    });
    req.end();
  });
}
