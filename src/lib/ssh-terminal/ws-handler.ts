/**
 * WebSocket handler per il terminale SSH interattivo. Agganciato all'HTTP(S)
 * server in server.ts. Flusso:
 *   1. upgrade su /ws/ssh?token=... → verifica il token firmato (HMAC).
 *   2. carica le credenziali SSH dell'host (dal tenant del token, decifrate).
 *   3. apre una shell PTY via ssh2 e fa da ponte WS ↔ canale SSH.
 *
 * Protocollo client→server (JSON): {type:'data',data} | {type:'resize',cols,rows}.
 * Server→client: dati raw del terminale (stringhe). Nessuna credenziale lascia
 * mai il server.
 */
import type { Server as HttpServer } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import { Client as SshClient, type ClientChannel } from "ssh2";
import { verifySshToken, type SshTokenPayload } from "./token";
import { getTenantDb } from "@/lib/db-tenant";
import { loadSshCredentialsForHost } from "@/lib/patch/credentials";

const WS_PATH = "/ws/ssh";

export function attachSshTerminalWs(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "", "http://localhost");
    } catch {
      return;
    }
    if (url.pathname !== WS_PATH) return; // non è il nostro path: lascia stare
    const payload = verifySshToken(url.searchParams.get("token") ?? "");
    if (!payload) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleSession(ws, payload));
  });
}

function handleSession(ws: WebSocket, payload: SshTokenPayload): void {
  const creds = (() => {
    try {
      return loadSshCredentialsForHost(getTenantDb(payload.tenantCode), payload.hostId);
    } catch {
      return null;
    }
  })();

  if (!creds) {
    ws.send("\r\n[credenziali SSH non disponibili per questo host]\r\n");
    ws.close();
    return;
  }

  const conn = new SshClient();
  let channel: ClientChannel | null = null;

  const closeAll = () => {
    try {
      channel?.end();
    } catch {
      /* noop */
    }
    try {
      conn.end();
    } catch {
      /* noop */
    }
    if (ws.readyState === ws.OPEN) ws.close();
  };

  conn.on("ready", () => {
    conn.shell({ term: "xterm-256color", cols: 80, rows: 24 }, (err, ch) => {
      if (err) {
        ws.send(`\r\n[errore apertura shell: ${err.message}]\r\n`);
        closeAll();
        return;
      }
      channel = ch;
      ch.on("data", (d: Buffer) => {
        if (ws.readyState === ws.OPEN) ws.send(d.toString("utf8"));
      });
      ch.stderr.on("data", (d: Buffer) => {
        if (ws.readyState === ws.OPEN) ws.send(d.toString("utf8"));
      });
      ch.on("close", closeAll);
    });
  });

  conn.on("error", (e: Error) => {
    if (ws.readyState === ws.OPEN) ws.send(`\r\n[SSH error: ${e.message}]\r\n`);
    closeAll();
  });
  conn.on("close", () => {
    if (ws.readyState === ws.OPEN) ws.close();
  });

  ws.on("message", (raw) => {
    let msg: { type?: string; data?: unknown; cols?: unknown; rows?: unknown };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!channel) return;
    if (msg.type === "data" && typeof msg.data === "string") {
      channel.write(msg.data);
    } else if (
      msg.type === "resize" &&
      typeof msg.cols === "number" &&
      typeof msg.rows === "number"
    ) {
      channel.setWindow(msg.rows, msg.cols, 0, 0);
    }
  });
  ws.on("close", closeAll);
  ws.on("error", closeAll);

  ws.send("\r\nConnessione SSH in corso...\r\n");
  conn.connect({
    host: creds.host,
    port: creds.port,
    username: creds.username,
    password: creds.password,
    readyTimeout: 15000,
    keepaliveInterval: 15000,
  });
}
