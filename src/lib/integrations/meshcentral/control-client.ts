/**
 * MeshControlClient — WebSocket client for MeshCentral control.ashx.
 *
 * Sends JSON requests and correlates responses by `responseid`.
 * Auth: Basic (adminUser:adminPass) in x-meshauth + Authorization headers on
 * the upgrade request.  loginTokenKey is NOT used here (that mints launch-out
 * tokens via login-token.ts, not admin API calls).
 *
 * Transport is injectable via `_setWsConnector` (test-only seam).
 * Production callers use `new MeshControlClient(creds)` with no extra args.
 */

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
) => McWsSocket;

let overrideConnector: WsConnector | null = null;

/** Test-only: inject a fake socket. Pass null to restore the real connector. */
export function _setWsConnector(c: WsConnector | null): void {
  overrideConnector = c;
}

/**
 * Default connector using Node 22's built-in globalThis.WebSocket.
 * The headers are passed via the Sec-WebSocket-Protocol workaround that
 * MeshCentral supports, AND via Authorization for non-browser upgrades.
 * Node's built-in WS does not support custom headers directly, so we embed
 * the Basic token in the URL for the default connector.
 */
function defaultWsConnector(
  url: string,
  headers: Record<string, string>,
): McWsSocket {
  // Node 22 built-in WebSocket doesn't accept arbitrary headers.
  // Embed credentials via URL userinfo so MeshCentral's HTTP server can auth.
  // The Basic token is already in headers["Authorization"]; extract user:pass.
  const authHeader = headers["Authorization"] ?? "";
  const basicB64 = authHeader.replace(/^Basic\s+/i, "");
  let wsUrlWithAuth = url;
  if (basicB64) {
    try {
      const u = new URL(url);
      const decoded = Buffer.from(basicB64, "base64").toString("utf8");
      const colonIdx = decoded.indexOf(":");
      if (colonIdx > 0) {
        u.username = decoded.slice(0, colonIdx);
        u.password = decoded.slice(colonIdx + 1);
      }
      wsUrlWithAuth = u.toString();
    } catch {
      // fall through with original url
    }
  }

  const ws = new globalThis.WebSocket(wsUrlWithAuth);
  let msgCb: (data: string) => void = () => {};
  let openCb: () => void = () => {};
  let closeCb: () => void = () => {};
  let errCb: (e: Error) => void = () => {};

  ws.onopen = () => openCb();
  ws.onclose = () => closeCb();
  ws.onerror = (evt) => {
    errCb(new Error((evt as ErrorEvent).message ?? "WebSocket error"));
  };
  ws.onmessage = (evt: MessageEvent<unknown>) => {
    const data = typeof evt.data === "string" ? evt.data : String(evt.data);
    msgCb(data);
  };

  return {
    onMessage(cb) {
      msgCb = cb;
    },
    onOpen(cb) {
      openCb = cb;
    },
    onClose(cb) {
      closeCb = cb;
    },
    onError(cb) {
      errCb = cb;
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

  constructor(creds: MeshCreds) {
    this.creds = creds;
  }

  private connect(): Promise<void> {
    if (this.openPromise) return this.openPromise;

    const wsUrl =
      this.creds.serverUrl
        .replace(/^https?/, (p) => (p === "https" ? "wss" : "ws"))
        .replace(/\/+$/, "") + "/control.ashx";

    // adminPass is NOT logged — only the base64-encoded credential header is
    // constructed in memory for the WS upgrade.
    const basic = Buffer.from(
      `${this.creds.adminUser}:${this.creds.adminPass}`,
    ).toString("base64");
    const headers: Record<string, string> = {
      "x-meshauth": basic,
      Authorization: `Basic ${basic}`,
    };

    const connector = overrideConnector ?? defaultWsConnector;
    const sock = connector(wsUrl, headers);
    this.sock = sock;

    this.openPromise = new Promise<void>((resolve, reject) => {
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
        for (const [, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error("control.ashx connection closed"));
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
        const rid =
          typeof msg.responseid === "string" ? msg.responseid : null;
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

    return this.openPromise;
  }

  private async request(
    action: string,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    await this.connect();
    const sock = this.sock;
    if (!sock) throw new Error("control.ashx socket not available");

    const responseid = `req-${this.nextId++}`;
    const payload = JSON.stringify({ action, responseid, ...extra });

    return new Promise<Record<string, unknown>>((resolve, reject) => {
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

  close(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
    }
    this.pending.clear();
    this.sock?.close();
    this.sock = null;
    this.openPromise = null;
  }
}
