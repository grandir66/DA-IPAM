/**
 * MeshControlClient — WebSocket client for MeshCentral control.ashx.
 *
 * Sends JSON requests and correlates responses by `responseid`.
 * Auth: x-meshauth: Base64(user),Base64(pass) on the upgrade request.
 * loginTokenKey is NOT used here (that mints launch-out tokens via
 * login-token.ts, not admin API calls).
 *
 * Transport is injectable via `_setWsConnector` (test-only seam).
 * Production callers use `new MeshControlClient(creds)` with no extra args.
 */

import WebSocket from "ws";
import { networkInterfaces } from "os";
import { lookup as dnsLookup } from "dns/promises";
import type { MeshCreds } from "./config";

// ── Public types ──────────────────────────────────────────────────────────────

export interface MeshNode {
  nodeId: string;
  name: string;
  rname: string;
  meshId: string;
  ip: string | null;
  macs: string[];
  osdesc: string | null;
  conn: number;
  lastConnect: string | null;
}

// ── Transport seam ────────────────────────────────────────────────────────────

export interface McWsSocket {
  onMessage(cb: (data: string) => void): void;
  onOpen(cb: () => void): void;
  onClose(cb: () => void): void;
  onError(cb: (err: Error) => void): void;
  send(data: string): void;
  close(): void;
}

export type WsConnector = (
  url: string,
  headers: Record<string, string>,
  rejectUnauthorized?: boolean,
) => McWsSocket;

let overrideConnector: WsConnector | null = null;

/** Test-only: inject a fake socket. Pass null to restore the real connector. */
export function _setWsConnector(c: WsConnector | null): void {
  overrideConnector = c;
}

/**
 * Default connector using the `ws` npm package so custom headers (x-meshauth)
 * are sent on the HTTP upgrade request. Node's built-in globalThis.WebSocket
 * cannot set arbitrary headers, so `ws` is required here.
 */
/** Insieme degli IP di tutte le interfacce locali (loopback incluso). */
function localInterfaceIps(): Set<string> {
  const out = new Set<string>();
  try {
    for (const addrs of Object.values(networkInterfaces())) {
      for (const a of addrs ?? []) out.add(a.address.toLowerCase());
    }
  } catch {
    /* ambiente senza accesso alle interfacce: insieme vuoto */
  }
  return out;
}

/**
 * True (SINCRONO) se l'URL è già letteralmente questa macchina: loopback o un IP
 * di una sua interfaccia scritto per esteso. NON risolve i nomi — un FQDN passa
 * da isSelfHostResolved. Esportata per i test.
 */
export function isSelfHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "::1" || h.startsWith("127.")) return true;
  return localInterfaceIps().has(h);
}

type DnsResolver = (host: string) => Promise<Array<{ address: string }>>;
const defaultResolver: DnsResolver = (h) => dnsLookup(h, { all: true });

/**
 * True se l'URL punta a QUESTA macchina, RISOLVENDO anche gli FQDN.
 *
 * Serve perché l'appliance si installa normalmente con il proprio nome DNS
 * (`da-ipam.domarc.it`), non con l'IP: quel nome risolve a un IP di una sua
 * interfaccia, ma il confronto stringa di isSelfHost non lo vedeva e faceva
 * fallire il provisioning con "unable to verify the first certificate" (colto su
 * 192.168.4.8 il 2026-07-20). Qui si risolve il nome e si controlla se un IP
 * ottenuto è locale.
 *
 * SICUREZZA: risolvere-per-verificare-locale è sicuro. Un attaccante che facesse
 * puntare un nome a un MIO IP mi farebbe solo connettere a me stesso; e per
 * scrivere questa config serve gia' l'admin di DA-IPAM. La verifica del cert
 * resta attiva verso qualunque MeshCentral che NON risolva a un IP locale.
 * resolver e' iniettabile per i test (niente DNS reale nella suite).
 */
export async function isSelfHostResolved(
  url: string,
  resolver: DnsResolver = defaultResolver,
): Promise<boolean> {
  if (isSelfHost(url)) return true;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  try {
    const results = await resolver(h);
    const locals = localInterfaceIps();
    return results.some((r) => locals.has(r.address.toLowerCase()));
  } catch {
    // DNS non risolve → non possiamo affermare che sia locale: restiamo prudenti.
    return false;
  }
}

function defaultWsConnector(
  url: string,
  headers: Record<string, string>,
  rejectUnauthorized: boolean,
): McWsSocket {
  // MeshCentral co-locato ha un cert SELF-SIGNED generato da lui durante l'install:
  // verificarlo contro le CA pubbliche fallisce sempre. La decisione se accettarlo
  // (server = questa macchina) e' presa in connect(), che puo' risolvere il DNS in
  // modo asincrono; qui il valore arriva gia' calcolato. Scoped alla SOLA
  // connessione MeshControlClient — NON tocca il TLS globale.
  const ws = new WebSocket(url, { headers, rejectUnauthorized });
  return {
    onMessage(cb) {
      ws.on("message", (d: WebSocket.RawData) => cb(d.toString()));
    },
    onOpen(cb) {
      ws.on("open", cb);
    },
    onClose(cb) {
      ws.on("close", () => cb());
    },
    onError(cb) {
      ws.on("error", (e: Error) => cb(e));
    },
    send(data: string) {
      ws.send(data);
    },
    close() {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    },
  };
}

// ── Internal raw types ────────────────────────────────────────────────────────

interface RawNode {
  _id?: string;
  name?: string;
  rname?: string;
  meshid?: string;
  ip?: string;
  mac?: string;
  macs?: string[];
  osdesc?: string;
  conn?: number;
  lastconnect?: number;
}

/** MeshCentral epoch-ms → ISO-8601, or null. */
function msToIso(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return new Date(v).toISOString();
}

function rawToMeshNode(r: RawNode): MeshNode {
  const macs: string[] = [];
  if (Array.isArray(r.macs)) {
    for (const m of r.macs) {
      if (typeof m === "string" && m) macs.push(m.toLowerCase());
    }
  }
  if (r.mac && typeof r.mac === "string") {
    const lower = r.mac.toLowerCase();
    if (!macs.includes(lower)) macs.push(lower);
  }
  return {
    nodeId: r._id ?? "",
    name: r.name ?? "",
    rname: r.rname ?? r.name ?? "",
    meshId: r.meshid ?? "",
    ip: r.ip ?? null,
    macs,
    osdesc: r.osdesc ?? null,
    conn: typeof r.conn === "number" ? r.conn : 0,
    lastConnect: msToIso(r.lastconnect),
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CONNECT_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;

// ── MeshControlClient ─────────────────────────────────────────────────────────

interface PendingRequest {
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class MeshControlClient {
  private readonly creds: MeshCreds;
  private sock: McWsSocket | null = null;
  private openPromise: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  /**
   * Errore terminale della connessione (auth close / socket chiuso). Serve a far
   * fallire SUBITO una richiesta che si registra un attimo dopo la chiusura,
   * invece di lasciarla scadere a 30s: senza, l'esito dipendeva dall'ordine dei
   * microtask fra la chiusura e la registrazione del pending.
   */
  private terminalError: Error | null = null;

  constructor(creds: MeshCreds) {
    this.creds = creds;
  }

  private connect(): Promise<void> {
    if (this.openPromise) return this.openPromise;
    this.openPromise = this.doConnect();
    return this.openPromise;
  }

  private async doConnect(): Promise<void> {
    // Tentativo di connessione nuovo: azzera l'eventuale errore terminale residuo.
    this.terminalError = null;
    const wsUrl =
      this.creds.serverUrl
        .replace(/^https?/, (p) => (p === "https" ? "wss" : "ws"))
        .replace(/\/+$/, "") + "/control.ashx";

    // adminPass is NOT logged — credentials are base64-encoded in memory.
    // MeshCentral webserver.js splits x-meshauth on "," and base64-decodes
    // each part: token[0] = Base64(user), token[1] = Base64(pass).
    const meshauth =
      Buffer.from(this.creds.adminUser).toString("base64") +
      "," +
      Buffer.from(this.creds.adminPass).toString("base64");
    const headers: Record<string, string> = {
      "x-meshauth": meshauth,
    };

    const connector = overrideConnector ?? defaultWsConnector;
    // TLS: sotto il seam di test non c'e' socket reale, quindi non serve (e non
    // deve girare del DNS reale nella suite). Con il connector reale accettiamo il
    // cert self-signed SOLO se il server risolve a questa macchina, oppure se
    // l'override esplicito MESHCENTRAL_TLS_INSECURE=1 e' impostato.
    let rejectUnauthorized = false;
    if (!overrideConnector) {
      rejectUnauthorized =
        process.env.MESHCENTRAL_TLS_INSECURE === "1"
          ? false
          : !(await isSelfHostResolved(wsUrl));
    }
    const sock = connector(wsUrl, headers, rejectUnauthorized);
    this.sock = sock;

    await new Promise<void>((resolve, reject) => {
      const connectTimer = setTimeout(
        () => reject(new Error("control.ashx connect timeout")),
        CONNECT_TIMEOUT_MS,
      );

      sock.onOpen(() => {
        clearTimeout(connectTimer);
        resolve();
      });

      sock.onError((e) => {
        clearTimeout(connectTimer);
        reject(e);
      });

      sock.onClose(() => {
        this.terminalError = this.terminalError ?? new Error("control.ashx connection closed");
        for (const [, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(this.terminalError);
        }
        this.pending.clear();
      });

      sock.onMessage((data) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(data) as Record<string, unknown>;
        } catch {
          return;
        }

        // MeshCentral sends {action:'close', cause:'noauth', ...} when auth
        // fails. Surface this immediately rather than letting all requests hang
        // to the 30s timeout.
        if (msg.action === "close") {
          const cause = typeof msg.cause === "string" ? msg.cause : "";
          const detail = typeof msg.msg === "string" ? msg.msg : cause;
          const authErr = new Error(
            `MeshCentral auth/connection closed: ${detail || "unknown"}`,
          );
          this.terminalError = authErr;
          clearTimeout(connectTimer);
          reject(authErr);
          for (const [, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(authErr);
          }
          this.pending.clear();
          return;
        }

        // MeshCentral NON e' uniforme nel correlare le risposte (verificato sul
        // server 2026-07-17, sonda su control.ashx):
        //   nodes  -> {action,responseid,nodes,tag}   (echo di responseid E tag)
        //   meshes -> {action,meshes,tag}             (echo del SOLO tag!)
        // Correlare solo su responseid faceva scadere ogni 'meshes' nel timeout
        // di 30s: e' il motivo per cui la generazione dello script di install
        // falliva con "control.ashx 'meshes' timeout". request() invia lo stesso
        // id in responseid E tag, quindi qui accettiamo l'uno o l'altro.
        const rid =
          typeof msg.responseid === "string"
            ? msg.responseid
            : typeof msg.tag === "string"
              ? msg.tag
              : null;
        if (rid) {
          const p = this.pending.get(rid);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(rid);
            p.resolve(msg);
          }
        }
      });
    });
  }

  private async request(
    action: string,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    await this.connect();
    const sock = this.sock;
    if (!sock) throw new Error("control.ashx socket not available");
    // La connessione potrebbe essere gia' chiusa (es. auth fallita) fra il
    // termine di connect() e questo punto: fallisci subito, non a 30s.
    if (this.terminalError) throw this.terminalError;

    const responseid = `req-${this.nextId++}`;
    // tag = responseid: alcune action (es. 'meshes') rimandano SOLO tag. Vedi la
    // nota nel dispatcher di connect(). Inviarli entrambi rende la correlazione
    // indipendente da quale dei due il server decide di rimandare.
    const payload = JSON.stringify({ action, responseid, tag: responseid, ...extra });

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      // Chiusura arrivata proprio mentre registravamo: niente attesa inutile.
      if (this.terminalError) {
        reject(this.terminalError);
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(responseid);
        reject(new Error(`control.ashx '${action}' timeout`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(responseid, { resolve, reject, timer });
      sock.send(payload);
    });
  }

  async listNodes(): Promise<MeshNode[]> {
    const resp = await this.request("nodes");
    const groups = resp.nodes;
    if (!groups || typeof groups !== "object") return [];
    const out: MeshNode[] = [];
    for (const arr of Object.values(
      groups as Record<string, RawNode[]>,
    )) {
      if (!Array.isArray(arr)) continue;
      for (const raw of arr) out.push(rawToMeshNode(raw));
    }
    return out;
  }

  async addMesh(name: string): Promise<string> {
    const resp = await this.request("createmesh", {
      meshname: name,
      meshtype: 2,
    });
    const meshid = resp.meshid;
    if (typeof meshid !== "string" || !meshid) {
      throw new Error(
        `createmesh '${name}' returned no meshid (result=${String(resp.result ?? "?")})`,
      );
    }
    return meshid;
  }

  async listMeshes(): Promise<Array<{ meshId: string; name: string }>> {
    const resp = await this.request("meshes");
    const arr = resp.meshes;
    if (!Array.isArray(arr)) return [];
    return (arr as Array<{ _id?: string; name?: string }>).map((m) => ({
      meshId: m._id ?? "",
      name: m.name ?? "",
    }));
  }

  /**
   * Esegue un comando shell sull'endpoint e ne restituisce l'output.
   *
   * Protocollo verificato con una sonda sul server reale (2026-07-17) — la
   * documentazione non lo copre e il sorgente e' ambiguo:
   *
   *   invio:  {action:'runcommands', nodeids:[id], type, cmds, runAsUser, reply:true}
   *   ritorno: {action:'msg', type:'runcommands', result:'<output>', responseid}
   *
   * NOTA: la risposta finale ha `action:'msg'`, NON `action:'runcommands'` — il
   * tipo sta nel campo `type`. Filtrare per action qui non trova niente. La
   * correlazione regge lo stesso perche' il messaggio porta il nostro responseid
   * (i messaggi intermedi `type:'console'`, uno per riga di output, non ce l'hanno
   * e vengono giustamente ignorati dal dispatcher).
   *
   * `reply:true` e' obbligatorio per avere l'output: con `false` il server
   * risponde subito 'OK' e l'esito reale del comando non si sa mai.
   *
   * type: **0 = auto-rilevamento** (l'agente Windows lo traduce in 1 = cmd, quello
   * non-Windows in 3 = bash). Passare 2 per PowerShell (solo Windows: su Linux il
   * server risponde 'Invalid command type'). Questo permette di non sapere il SO.
   *
   * runAsUser: 0 = SYSTEM/root · 1 = come utente loggato se possibile · 2 = solo utente.
   *
   * LIMITE NOTO: si aspetta la risposta entro REQUEST_TIMEOUT_MS (30s). Un comando
   * piu' lento va in timeout qui pur continuando a girare sull'endpoint.
   */
  async runCommand(
    nodeId: string,
    cmds: string,
    opts: { powershell?: boolean; runAsUser?: 0 | 1 | 2 } = {},
  ): Promise<string> {
    const resp = await this.request("runcommands", {
      nodeids: [nodeId],
      type: opts.powershell ? 2 : 0,
      cmds,
      runAsUser: opts.runAsUser ?? 0,
      reply: true,
    });
    // `result` porta l'output completo; su errore il server ci mette il motivo
    // ('Access denied', 'Agent not connected', 'Invalid command type', ...).
    return typeof resp.result === "string" ? resp.result : "";
  }

  close(): void {
    // Reject any in-flight requests so awaiting callers settle immediately
    // instead of leaking (clearing the map alone would orphan their promises).
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("control.ashx client closed"));
    }
    this.pending.clear();
    this.sock?.close();
    this.sock = null;
    this.openPromise = null;
  }
}
