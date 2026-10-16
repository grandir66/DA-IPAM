/**
 * Verifica «apertura per il browser» di un'interfaccia (passo 4b del piano di
 * solidità, 16/10/2026).
 *
 * «Verifica» provava solo l'URL dell'API; qui si prova l'URL che usa il browser,
 * come lo vedrebbe il browser: il certificato (fidato? col nome giusto? valido?),
 * dove porta la pagina (interfaccia, login, un'API) e, per le interfacce mostrate
 * in un riquadro, se si lasciano incorporare (X-Frame-Options, CSP
 * frame-ancestors) dall'origine con cui è aperto DA-IPAM.
 *
 * Come si legge il certificato senza spegnere la verifica TLS: la connessione si
 * apre senza rifiutare il certificato, se ne leggono i dati e lo si giudica QUI
 * (catena, nome, date), poi sulla stessa connessione parte una GET senza
 * credenziali né cookie, come fa il browser dopo che l'utente ha accettato
 * l'avviso. Nessun segreto passa da questa connessione: l'unica eccezione è il
 * cookie dell'accesso automatico di LibreNMS (`cookie`), che il login automatico
 * esistente manda già allo stesso server senza verifica (vedi
 * `librenms-proxy-auth.ts`), e qui almeno se ne mostra il certificato.
 *
 * Il giudizio usa i certificati di fiducia del SERVER DA-IPAM (più `ca`), non
 * quelli del PC del tecnico: fino alla CA interna di DA-Link (ADR 0013/0014) un
 * certificato autofirmato risulta «non fidato» ovunque, e la pagina dice di
 * accettarlo una volta confrontando l'impronta SHA-256.
 *
 * Prove: `__tests__/apertura-browser.test.ts`, con server HTTPS finti e
 * certificati generati sul momento.
 */
import * as http from "node:http";
import * as tls from "node:tls";
import { isIP } from "node:net";
import { htmlConLogin, percorsoDiLogin } from "@/lib/integrations/pagina-login";

export type EsitoApertura =
  | "ok"
  | "certificato_non_fidato"
  | "nome_errato"
  | "scaduto"
  | "login_richiesto"
  | "iframe_bloccato"
  | "risposta_api"
  | "errore_http"
  | "non_raggiungibile"
  | "senza_url";

/** Gli esiti che riguardano il certificato: il browser mostra un avviso, si accetta una volta. */
export const ESITI_CERTIFICATO: readonly EsitoApertura[] = ["certificato_non_fidato", "nome_errato", "scaduto"];

/** Etichetta breve di ogni esito, per la pagina. */
export const ETICHETTA_ESITO: Record<EsitoApertura, string> = {
  ok: "Si apre",
  certificato_non_fidato: "Certificato non fidato",
  nome_errato: "Nome del certificato errato",
  scaduto: "Certificato scaduto",
  login_richiesto: "Chiede il login",
  iframe_bloccato: "Riquadro bloccato",
  risposta_api: "Risponde un'API, non l'interfaccia",
  errore_http: "Errore HTTP",
  non_raggiungibile: "Non raggiungibile",
  senza_url: "Nessun indirizzo",
};

/** Ordine di gravità per scegliere l'esito principale fra i problemi trovati. */
const PRIORITA: readonly EsitoApertura[] = [
  "senza_url",
  "non_raggiungibile",
  "scaduto",
  "nome_errato",
  "certificato_non_fidato",
  "risposta_api",
  "errore_http",
  "login_richiesto",
  "iframe_bloccato",
];

export interface CertificatoVisto {
  /** Impronta SHA-256 come la mostra il browser (`AB:CD:…`). */
  impronta256: string;
  soggetto: string;
  emittente: string;
  autofirmato: boolean;
  /** Date ISO. */
  validoDal: string;
  validoAl: string;
  /** Nomi e IP nel certificato (subjectAltName). */
  nomi: string[];
  /** Codice OpenSSL della catena non fidata, se c'è (es. DEPTH_ZERO_SELF_SIGNED_CERT). */
  erroreCatena: string | null;
}

export interface VerificaApertura {
  etichetta: string;
  url: string;
  modo: "scheda" | "riquadro";
  /** Esito principale (il più grave fra `problemi`, oppure `ok`). */
  esito: EsitoApertura;
  /** Tutti i problemi trovati: un certificato può essere autofirmato E col nome sbagliato. */
  problemi: EsitoApertura[];
  /** Spiegazione in italiano, una frase per problema. */
  spiegazione: string;
  certificato?: CertificatoVisto;
  /** Istruzione per accettare il certificato una volta, finché non c'è la CA di DA-Link. */
  istruzioneCertificato?: string;
  /** HTTP della risposta finale, se arrivata. */
  stato?: number;
  /** Dove porta la pagina, se rimanda altrove. */
  rimandaA?: string;
  /** Il modulo ha chiesto il suo login (normale per chi ha un login proprio). */
  paginaDiLogin?: boolean;
  /** Origini ammesse a incorporare l'interfaccia (da frame-ancestors / X-Frame-Options). */
  originiAmmesse?: string[];
  /** Origine con cui il browser apre DA-IPAM (quella confrontata). */
  origineDaIpam?: string;
  /** Origini che l'interfaccia dovrebbe ammettere perché il riquadro funzioni (MeshCentral). */
  originiDaAmmettere?: string[];
}

export interface OpzioniApertura {
  etichetta: string;
  url: string;
  /** `riquadro` = l'interfaccia si mostra in un iframe dentro DA-IPAM. */
  modo: "scheda" | "riquadro";
  /** Origine di DA-IPAM come la vede il browser (`https://nome[:porta]`). */
  origineDaIpam?: string | null;
  /** Il modulo ha un suo login: arrivarci è normale. Falso = ci si aspetta di entrare (accesso automatico). */
  loginProprio: boolean;
  /** Cookie da mandare (solo per l'accesso automatico di LibreNMS). */
  cookie?: string;
  /**
   * Il certificato si legge ma non conta nell'esito: per una seconda verifica
   * sullo stesso server (l'accesso automatico) il certificato l'ha già giudicato
   * la prima, e qui interessa solo dove porta la pagina.
   */
  ignoraCertificato?: boolean;
  /** Autorità in più di cui fidarsi (prove; in futuro la CA di DA-Link). */
  ca?: string[];
  timeoutMs?: number;
  /** Ora del giudizio sulle date (prove). */
  adesso?: Date;
}

const MAX_CORPO = 256 * 1024;
const MAX_RINVII = 5;

interface Risposta {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface Connessione {
  socket: tls.TLSSocket | null;
  certificato?: CertificatoVisto;
  problemiCert: EsitoApertura[];
}

// ── Certificato ──────────────────────────────────────────────────────────────

function nomeDistinto(n: tls.PeerCertificate["subject"] | undefined): string {
  if (!n) return "";
  const cn = n.CN;
  if (cn) return Array.isArray(cn) ? cn.join(", ") : cn;
  return Object.entries(n)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("+") : v}`)
    .join(", ");
}

function nomiDelCertificato(san: string | undefined): string[] {
  if (!san) return [];
  return san
    .split(/,\s*/)
    .map((p) => p.replace(/^(DNS|IP Address):/i, "").trim())
    .filter(Boolean);
}

const CATENA_NON_FIDATA = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_UNTRUSTED",
  "CERT_SIGNATURE_FAILURE",
  "CERT_REJECTED",
  "INVALID_CA",
]);

/**
 * Giudizio sul certificato presentato: catena, nome, date. Tre controlli
 * indipendenti: OpenSSL si ferma al primo errore (autofirmato), il browser li
 * segnala tutti.
 */
export function giudicaCertificato(
  peer: tls.PeerCertificate,
  hostname: string,
  erroreCatena: string | null,
  adesso: Date,
): { certificato: CertificatoVisto; problemi: EsitoApertura[] } {
  const problemi: EsitoApertura[] = [];
  const dal = new Date(peer.valid_from);
  const al = new Date(peer.valid_to);
  const autofirmato =
    erroreCatena === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    JSON.stringify(peer.subject) === JSON.stringify(peer.issuer);

  // Le date le giudichiamo noi: con un certificato non fidato OpenSSL non arriva a guardarle.
  if (Number.isNaN(al.getTime()) || Number.isNaN(dal.getTime()) || adesso > al || adesso < dal) {
    problemi.push("scaduto");
  }
  if (tls.checkServerIdentity(hostname, peer) !== undefined) problemi.push("nome_errato");
  if (erroreCatena && CATENA_NON_FIDATA.has(erroreCatena)) problemi.push("certificato_non_fidato");

  return {
    certificato: {
      impronta256: peer.fingerprint256 ?? "",
      soggetto: nomeDistinto(peer.subject),
      emittente: nomeDistinto(peer.issuer),
      autofirmato,
      validoDal: Number.isNaN(dal.getTime()) ? peer.valid_from : dal.toISOString(),
      validoAl: Number.isNaN(al.getTime()) ? peer.valid_to : al.toISOString(),
      nomi: nomiDelCertificato(peer.subjectaltname),
      erroreCatena,
    },
    problemi,
  };
}

/**
 * Apre la connessione TLS senza rifiutare il certificato, per poterlo leggere e
 * giudicare (vedi testa del file). Non manda niente: il chiamante decide se
 * proseguire con la GET.
 */
function apriTls(u: URL, opts: OpzioniApertura): Promise<Connessione> {
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const port = Number(u.port || 443);
  const timeoutMs = opts.timeoutMs ?? 8_000;
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      servername: isIP(host) ? undefined : host,
      // Lettura del certificato, giudicato da giudicaCertificato(): nessun dato
      // parte prima del giudizio.
      rejectUnauthorized: false,
      ca: opts.ca?.length ? [...tls.rootCertificates, ...opts.ca] : undefined,
      ALPNProtocols: ["http/1.1"],
      timeout: timeoutMs,
    });
    const fallisci = (e: Error) => {
      socket.destroy();
      reject(e);
    };
    socket.once("error", fallisci);
    socket.once("timeout", () => fallisci(new Error(`timeout dopo ${timeoutMs} ms`)));
    socket.once("secureConnect", () => {
      socket.removeListener("error", fallisci);
      socket.setTimeout(0);
      const peer = socket.getPeerCertificate(false);
      if (!peer || !peer.fingerprint256) {
        fallisci(new Error("nessun certificato presentato"));
        return;
      }
      const err = socket.authorizationError;
      const codice = err ? (typeof err === "string" ? err : (err as Error & { code?: string }).code ?? err.message) : null;
      const { certificato, problemi } = giudicaCertificato(peer, host, codice, opts.adesso ?? new Date());
      resolve({ socket, certificato, problemiCert: problemi });
    });
  });
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

function richiesta(u: URL, opts: OpzioniApertura, socket: tls.TLSSocket | null): Promise<Risposta> {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const headers: Record<string, string> = {
    Host: u.host,
    Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    "User-Agent": "DA-IPAM (verifica apertura per il browser)",
  };
  if (opts.cookie) headers.Cookie = opts.cookie;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: "GET",
        host: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        headers,
        timeout: timeoutMs,
        ...(socket ? { createConnection: () => socket } : {}),
      },
      (res) => {
        const parti: Buffer[] = [];
        let n = 0;
        res.on("data", (c: Buffer) => {
          if (n < MAX_CORPO) parti.push(c);
          n += c.length;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parti).toString("utf-8") }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error(`timeout dopo ${timeoutMs} ms`)));
    req.end();
  });
}

// ── Riquadro: X-Frame-Options e CSP frame-ancestors ──────────────────────────

function portaDi(u: URL): string {
  return u.port || (u.protocol === "https:" ? "443" : u.protocol === "http:" ? "80" : "");
}

/**
 * Una sorgente di `frame-ancestors` ammette `origine`? `self` = l'origine
 * dell'interfaccia. Regole CSP3 essenziali: `*`, schema (`https:`), host con
 * `*.` e porta (anche `:*`); senza porta vale quella dello schema.
 */
export function sorgenteAmmette(sorgente: string, origine: URL, origineInterfaccia: URL): boolean {
  const s = sorgente.trim();
  const low = s.toLowerCase();
  if (low === "'none'") return false;
  if (low === "'self'") return origine.origin === origineInterfaccia.origin;
  if (low === "*") return origine.protocol === "https:" || origine.protocol === "http:";
  if (/^[a-z][a-z0-9+.-]*:$/.test(low)) {
    return origine.protocol === low || (low === "http:" && origine.protocol === "https:");
  }
  const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:]+|\*)(?::(\d+|\*))?(?:\/.*)?$/i.exec(s);
  if (!m) return false;
  const [, schema, jolly, hostSorgente, porta] = m;
  if (schema) {
    const sch = `${schema.toLowerCase()}:`;
    if (sch !== origine.protocol && !(sch === "http:" && origine.protocol === "https:")) return false;
  } else if (origine.protocol !== origineInterfaccia.protocol && !(origineInterfaccia.protocol === "http:" && origine.protocol === "https:")) {
    return false;
  }
  const h = origine.hostname.toLowerCase();
  const hs = hostSorgente.toLowerCase();
  if (hs !== "*") {
    if (jolly) {
      if (!h.endsWith(`.${hs}`)) return false;
    } else if (h !== hs) {
      return false;
    }
  }
  if (porta === "*") return true;
  const portaAttesa = porta ?? (schema ? (schema.toLowerCase() === "https" ? "443" : "80") : portaDi(origine));
  return portaDi(origine) === portaAttesa;
}

/** Elenco delle sorgenti di `frame-ancestors` per ogni policy che ne ha una. */
export function frameAncestors(csp: string | string[] | undefined): string[][] {
  if (!csp) return [];
  const politiche = (Array.isArray(csp) ? csp : [csp]).flatMap((v) => v.split(","));
  const out: string[][] = [];
  for (const p of politiche) {
    for (const direttiva of p.split(";")) {
      const parti = direttiva.trim().split(/\s+/).filter(Boolean);
      if (parti[0]?.toLowerCase() === "frame-ancestors") out.push(parti.slice(1));
    }
  }
  return out;
}

export interface GiudizioRiquadro {
  bloccato: boolean;
  motivo: string | null;
  originiAmmesse: string[];
}

/**
 * Il browser mostra l'interfaccia (`urlInterfaccia`) in un riquadro dentro una
 * pagina di `origineDaIpam`? CSP frame-ancestors vince su X-Frame-Options;
 * contenuto http in una pagina https è bloccato comunque.
 */
export function giudicaRiquadro(
  headers: http.IncomingHttpHeaders,
  urlInterfaccia: URL,
  origineDaIpam: URL,
): GiudizioRiquadro {
  if (origineDaIpam.protocol === "https:" && urlInterfaccia.protocol === "http:") {
    return {
      bloccato: true,
      motivo: `DA-IPAM è in https e l'interfaccia in http: il browser blocca il contenuto misto`,
      originiAmmesse: [],
    };
  }
  const fa = frameAncestors(headers["content-security-policy"]);
  if (fa.length > 0) {
    const ammesse = [...new Set(fa.flat())];
    const tutteAmmettono = fa.every((sorgenti) =>
      sorgenti.some((s) => sorgenteAmmette(s, origineDaIpam, urlInterfaccia)),
    );
    return tutteAmmettono
      ? { bloccato: false, motivo: null, originiAmmesse: ammesse }
      : {
          bloccato: true,
          motivo: `Content-Security-Policy: frame-ancestors ${ammesse.join(" ")} non ammette ${origineDaIpam.origin}`,
          originiAmmesse: ammesse,
        };
  }
  const xfoGrezzo = headers["x-frame-options"];
  const xfo = (Array.isArray(xfoGrezzo) ? xfoGrezzo.join(",") : xfoGrezzo ?? "").trim().toUpperCase();
  if (!xfo) return { bloccato: false, motivo: null, originiAmmesse: [] };
  if (xfo.includes("DENY")) {
    return { bloccato: true, motivo: "X-Frame-Options: DENY (nessuna pagina può incorporarla)", originiAmmesse: [] };
  }
  if (xfo.includes("SAMEORIGIN")) {
    const stessa = origineDaIpam.origin === urlInterfaccia.origin;
    return stessa
      ? { bloccato: false, motivo: null, originiAmmesse: [urlInterfaccia.origin] }
      : {
          bloccato: true,
          motivo: `X-Frame-Options: SAMEORIGIN (solo ${urlInterfaccia.origin} può incorporarla, DA-IPAM è ${origineDaIpam.origin})`,
          originiAmmesse: [urlInterfaccia.origin],
        };
  }
  return { bloccato: false, motivo: null, originiAmmesse: [] };
}

// ── Composizione ─────────────────────────────────────────────────────────────

function data(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("it-IT", { timeZone: "UTC" });
}

function istruzioneAccetta(url: string, cert: CertificatoVisto, riquadro: boolean): string {
  return (
    `Finché non c'è la CA interna di DA-Link: apri ${url} in una nuova scheda, apri i dettagli ` +
    `del certificato dall'avviso del browser e controlla che l'impronta SHA-256 sia ${cert.impronta256}; ` +
    `se coincide, accetta l'avviso una volta sola` +
    (riquadro ? ", poi torna qui e ricarica: il riquadro resta vuoto finché il certificato non è accettato in una scheda." : ".") +
    " Se l'impronta è diversa, non accettare: non è il certificato dell'appliance."
  );
}

function frase(esito: EsitoApertura, v: VerificaApertura, u: URL, extra: { motivoRete?: string; motivoRiquadro?: string | null }): string {
  const c = v.certificato;
  switch (esito) {
    case "senza_url":
      return "Nessun indirizzo raggiungibile dal browser per questa interfaccia.";
    case "non_raggiungibile":
      return `Il server DA-IPAM non raggiunge ${u.host} (${extra.motivoRete ?? "errore di rete"}): di solito non lo raggiunge nemmeno il browser.`;
    case "scaduto":
      return c
        ? `Il certificato vale dal ${data(c.validoDal)} al ${data(c.validoAl)}: fuori da queste date il browser lo blocca. Va rigenerato sull'appliance.`
        : "Certificato fuori dalle sue date di validità.";
    case "nome_errato":
      return `Il certificato non contiene «${u.hostname}», il nome con cui si apre l'interfaccia${c?.nomi.length ? ` (contiene: ${c.nomi.join(", ")})` : ""}: il browser lo segnala anche dopo averlo accettato con un altro nome. Usa uno dei nomi del certificato, o rigeneralo con questo.`;
    case "certificato_non_fidato":
      return c?.autofirmato
        ? "Certificato autofirmato: il browser avvisa «connessione non privata» finché non lo accetti."
        : `Certificato emesso da un'autorità che il server DA-IPAM non conosce (${c?.emittente || "sconosciuta"}): il browser avvisa finché non la installi o non accetti il certificato.`;
    case "risposta_api":
      return `L'indirizzo risponde come un'API (HTTP ${v.stato ?? "?"}, niente pagina): probabilmente punta alla porta dell'API invece che a quella dell'interfaccia.`;
    case "errore_http":
      return `L'interfaccia risponde HTTP ${v.stato ?? "?"}.`;
    case "login_richiesto":
      return "L'interfaccia apre la pagina di login: l'accesso automatico non è andato a buon fine.";
    case "iframe_bloccato":
      return `L'interfaccia non si lascia mostrare nel riquadro di DA-IPAM: ${extra.motivoRiquadro ?? "bloccata"}. In una nuova scheda si apre.`;
    case "ok":
      return v.paginaDiLogin
        ? "Si apre sulla pagina di login del modulo (normale: ha il suo login)."
        : "Si apre.";
  }
}

function componi(
  base: Omit<VerificaApertura, "esito" | "problemi" | "spiegazione">,
  problemi: EsitoApertura[],
  u: URL,
  extra: { motivoRete?: string; motivoRiquadro?: string | null } = {},
): VerificaApertura {
  const unici = PRIORITA.filter((p) => problemi.includes(p));
  const esito: EsitoApertura = unici[0] ?? "ok";
  const v: VerificaApertura = { ...base, esito, problemi: unici, spiegazione: "" };
  const frasi = unici.length ? unici.map((p) => frase(p, v, u, extra)) : [frase("ok", v, u, extra)];
  if (unici.length && unici.every((p) => ESITI_CERTIFICATO.includes(p)) && v.paginaDiLogin) {
    frasi.push("Dopo l'avviso, si apre sulla pagina di login del modulo.");
  }
  v.spiegazione = frasi.join(" ");
  if (v.certificato && unici.some((p) => ESITI_CERTIFICATO.includes(p))) {
    v.istruzioneCertificato = istruzioneAccetta(base.url, v.certificato, base.modo === "riquadro");
  }
  return v;
}

function sembraApi(r: Risposta): boolean {
  const ct = String(r.headers["content-type"] ?? "").toLowerCase();
  if (ct.includes("json")) return true;
  return r.status === 401 && !ct.includes("html");
}

/** Prova l'apertura di un'interfaccia come farebbe il browser. Non lancia mai. */
export async function verificaApertura(opts: OpzioniApertura): Promise<VerificaApertura> {
  let u: URL;
  try {
    u = new URL(opts.url);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("schema");
  } catch {
    const finto = new URL("http://invalido");
    return componi({ etichetta: opts.etichetta, url: opts.url, modo: opts.modo }, ["senza_url"], finto);
  }
  let origine: URL | null = null;
  if (opts.origineDaIpam) {
    try {
      origine = new URL(opts.origineDaIpam);
    } catch {
      origine = null;
    }
  }
  const base: Omit<VerificaApertura, "esito" | "problemi" | "spiegazione"> = {
    etichetta: opts.etichetta,
    url: opts.url,
    modo: opts.modo,
    ...(origine ? { origineDaIpam: origine.origin } : {}),
  };
  const problemi: EsitoApertura[] = [];

  let attuale = u;
  let risposta: Risposta | null = null;
  try {
    for (let rinvii = 0; ; rinvii++) {
      let socket: tls.TLSSocket | null = null;
      if (attuale.protocol === "https:") {
        const conn = await apriTls(attuale, opts);
        socket = conn.socket;
        if (rinvii === 0) {
          base.certificato = conn.certificato;
          if (!opts.ignoraCertificato) problemi.push(...conn.problemiCert);
        }
      }
      try {
        risposta = await richiesta(attuale, opts, socket);
      } finally {
        socket?.destroy();
      }
      const location = typeof risposta.headers.location === "string" ? risposta.headers.location : null;
      if (risposta.status < 300 || risposta.status >= 400 || !location) break;
      const dest = new URL(location, attuale);
      if (dest.origin !== u.origin || rinvii >= MAX_RINVII || percorsoDiLogin(dest.toString())) {
        base.rimandaA = dest.toString();
        if (percorsoDiLogin(dest.toString())) base.paginaDiLogin = true;
        break;
      }
      attuale = dest;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return componi(base, [...problemi, "non_raggiungibile"], u, { motivoRete: msg });
  }

  base.stato = risposta.status;
  let motivoRiquadro: string | null = null;
  if (risposta.status >= 200 && risposta.status < 300 && htmlConLogin(risposta.body)) base.paginaDiLogin = true;
  if (sembraApi(risposta)) {
    problemi.push("risposta_api");
  } else if (risposta.status >= 400 || (risposta.status >= 300 && !base.rimandaA)) {
    problemi.push("errore_http");
  }
  if (base.paginaDiLogin && !opts.loginProprio) problemi.push("login_richiesto");
  if (opts.modo === "riquadro" && origine) {
    const g = giudicaRiquadro(risposta.headers, attuale, origine);
    base.originiAmmesse = g.originiAmmesse;
    if (g.bloccato) {
      problemi.push("iframe_bloccato");
      motivoRiquadro = g.motivo;
    }
  }
  return componi(base, problemi, u, { motivoRiquadro });
}

/** Esito «nessun indirizzo» per un'interfaccia senza URL per il browser (o con un URL interno). */
export function senzaUrl(etichetta: string, url: string, modo: "scheda" | "riquadro", motivo: string): VerificaApertura {
  return {
    etichetta,
    url,
    modo,
    esito: "senza_url",
    problemi: ["senza_url"],
    spiegazione: motivo,
  };
}
