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
 * Default connector using the `ws` npm package so custom headers (x-meshauth)
 * are sent on the HTTP upgrade request. Node's built-in globalThis.WebSocket
 * cannot set arbitrary headers, so `ws` is required here.
 */
function defaultWsConnector(
  url: string,
  headers: Record<string, string>,
): McWsSocket {
  const ws = new WebSocket(url, { headers });
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

  constructor(creds: MeshCreds) {
    this.creds = creds;
  }

  private connect(): Promise<void> {
    if (this.openPromise) return this.openPromise;

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

        // MeshCentral sends {action:'close', cause:'noauth', ...} when auth
        // fails. Surface this immediately rather than letting all requests hang
        // to the 30s timeout.
        if (msg.action === "close") {
          const cause = typeof msg.cause === "string" ? msg.cause : "";
          const detail = typeof msg.msg === "string" ? msg.msg : cause;
          const authErr = new Error(
            `MeshCentral auth/connection closed: ${detail || "unknown"}`,
          );
          clearTimeout(connectTimer);
          reject(authErr);
          for (const [, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(authErr);
          }
          this.pending.clear();
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
