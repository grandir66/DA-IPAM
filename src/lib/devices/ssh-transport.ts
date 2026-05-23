/**
 * Transport SSH unico per tutti i path TS di DA-IPAM (router-client, switch-client,
 * vendor handler, discovery, test cred, ecc.).
 *
 * Risolve due classi di bug ricorrenti:
 *
 * 1. **Auth keyboard-interactive non supportata**. `ssh2` Node, di default, prova solo
 *    `password`. Molti apparati (Stormshield SNS, SonicWall, Cisco IOS legacy, alcuni
 *    Mikrotik con `password-prompt only`) accettano *solo* `keyboard-interactive`.
 *    Risultato pratico: "All configured authentication methods failed" mentre il
 *    bridge paramiko o uno `ssh` da CLI passano senza problemi.
 *
 *    Fix: `tryKeyboard: true` + handler `keyboard-interactive` + `authHandler` custom
 *    che prova in ordine `password` → `keyboard-interactive` in base ai metodi che il
 *    server dichiara.
 *
 * 2. **Errori di auth non parlanti**. I call site catturavano `e.message` raw dalla
 *    libreria, che è inglese, contestualmente povero e spesso lo stesso identico per
 *    cause diverse ("All configured authentication methods failed").
 *
 *    Fix: `mapSshError(err, ctx)` categorizza in `SshErrorKind` e produce un messaggio
 *    italiano che include host:port, username, credenziale, metodi offerti dal server,
 *    e un `hint` di fix.
 */

import type { Client as SshClient, ConnectConfig } from "ssh2";

const DEFAULT_KEX_ALGORITHMS = [
  "curve25519-sha256",
  "curve25519-sha256@libssh.org",
  "ecdh-sha2-nistp256",
  "ecdh-sha2-nistp384",
  "ecdh-sha2-nistp521",
  "diffie-hellman-group-exchange-sha256",
  "diffie-hellman-group14-sha256",
  "diffie-hellman-group14-sha1",
  "diffie-hellman-group1-sha1",
];

const DEFAULT_HOSTKEY_ALGORITHMS = [
  "ssh-ed25519",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "rsa-sha2-512",
  "rsa-sha2-256",
  "ssh-rsa",
  "ssh-dss",
];

export interface SshOptions {
  host: string;
  port?: number;
  username: string;
  password: string;
  /** Timeout connessione (ms). Default 15000. */
  timeout?: number;
  /** Etichetta credenziale: appare nei messaggi d'errore (es. "SSH-FWL"). */
  credentialName?: string;
  /** Override algoritmi KEX (per device che richiedono kex legacy). */
  kexAlgorithms?: string[];
}

export interface SshResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type SshErrorKind =
  | "auth_failed"
  | "auth_method_unsupported"
  | "no_credentials"
  | "connect_refused"
  | "connect_timeout"
  | "unreachable"
  | "host_key_changed"
  | "protocol_error"
  | "command_error"
  | "unknown";

export interface SshErrorInfo {
  kind: SshErrorKind;
  /** Messaggio italiano parlante, sicuro da mostrare in UI. */
  message: string;
  /** Suggerimento di fix, opzionale. */
  hint?: string;
  /** Messaggio raw dalla libreria (utile per log/debug, NON in UI). */
  raw: string;
  host?: string;
  port?: number;
  username?: string;
  credentialName?: string;
  /** Metodi auth offerti dal server (es. ['publickey','keyboard-interactive']). */
  methodsOffered?: string[];
  /** Metodi auth tentati dal client in ordine. */
  methodsTried?: string[];
}

export class SshError extends Error implements SshErrorInfo {
  kind: SshErrorKind;
  hint?: string;
  raw: string;
  host?: string;
  port?: number;
  username?: string;
  credentialName?: string;
  methodsOffered?: string[];
  methodsTried?: string[];

  constructor(info: SshErrorInfo) {
    super(info.message);
    this.name = "SshError";
    this.kind = info.kind;
    this.hint = info.hint;
    this.raw = info.raw;
    this.host = info.host;
    this.port = info.port;
    this.username = info.username;
    this.credentialName = info.credentialName;
    this.methodsOffered = info.methodsOffered;
    this.methodsTried = info.methodsTried;
  }

  /** Stringa unica usabile in DB / log: "[kind] message — hint". */
  toLogString(): string {
    const parts = [`[${this.kind}]`, this.message];
    if (this.hint) parts.push(`— ${this.hint}`);
    return parts.join(" ");
  }
}

export interface MapSshErrorContext {
  host?: string;
  port?: number;
  username?: string;
  methodsOffered?: string[];
  methodsTried?: string[];
  credentialName?: string;
}

interface SshAuthState {
  methodsOffered?: string[];
  methodsTried: string[];
}

function pickNextMethod(state: SshAuthState, methodsLeft: string[] | null): "password" | "keyboard-interactive" | null {
  // methodsLeft può essere null al primo tentativo: in quel caso proviamo password.
  const available = methodsLeft ?? ["password", "keyboard-interactive"];
  const order: Array<"password" | "keyboard-interactive"> = ["password", "keyboard-interactive"];
  for (const m of order) {
    if (available.includes(m) && !state.methodsTried.includes(m)) return m;
  }
  return null;
}

function buildConnectConfig(opts: SshOptions, state: SshAuthState): ConnectConfig {
  // I tipi `ssh2` per `algorithms.kex`/`serverHostKey` sono union di literal precisi;
  // i nostri sono nomi IETF standard — `as` per non duplicare l'enum.
  type KexList = NonNullable<ConnectConfig["algorithms"]>["kex"];
  type HostKeyList = NonNullable<ConnectConfig["algorithms"]>["serverHostKey"];
  return {
    host: opts.host,
    port: opts.port ?? 22,
    username: opts.username,
    readyTimeout: opts.timeout ?? 15_000,
    algorithms: {
      kex: (opts.kexAlgorithms ?? DEFAULT_KEX_ALGORITHMS) as unknown as KexList,
      serverHostKey: DEFAULT_HOSTKEY_ALGORITHMS as unknown as HostKeyList,
    },
    tryKeyboard: true,
    authHandler: ((methodsLeft, _partial, cb): void => {
      if (methodsLeft && !state.methodsOffered) state.methodsOffered = [...methodsLeft];

      const next = pickNextMethod(state, methodsLeft);
      if (!next) {
        // Esauriti i metodi: chiudiamo con `none` per lasciare a ssh2 l'errore di auth.
        cb({ type: "none", username: opts.username });
        return;
      }
      state.methodsTried.push(next);
      if (next === "password") {
        cb({ type: "password", username: opts.username, password: opts.password });
      } else {
        cb({
          type: "keyboard-interactive",
          username: opts.username,
          prompt: (_name, _instructions, _lang, _prompts, finish) => finish([opts.password]),
        });
      }
    }) as ConnectConfig["authHandler"],
  };
}

/**
 * Apre una connessione SSH. Il chiamante è responsabile di chiamare `conn.end()`
 * (o usare `withSshClient` che lo fa in automatico).
 */
export async function connectSsh(opts: SshOptions): Promise<SshClient> {
  const { Client } = await import("ssh2");

  return new Promise((resolve, reject) => {
    const conn = new Client();
    const state: SshAuthState = { methodsTried: [] };

    let settled = false;
    const safeReject = (info: SshErrorInfo) => {
      if (settled) return;
      settled = true;
      try { conn.end(); } catch { /* ignore */ }
      reject(new SshError(info));
    };
    const safeResolve = () => {
      if (settled) return;
      settled = true;
      resolve(conn);
    };

    conn.on("ready", safeResolve);
    conn.on("error", (err) => {
      const info = mapSshError(err, {
        host: opts.host,
        port: opts.port ?? 22,
        username: opts.username,
        methodsOffered: state.methodsOffered,
        methodsTried: state.methodsTried,
        credentialName: opts.credentialName,
      });
      safeReject(info);
    });
    conn.on("keyboard-interactive", (_name, _instructions, _lang, _prompts, finish) => {
      // Rispondi a ogni prompt con la password (pattern standard per "Password:").
      finish([opts.password]);
    });
    conn.connect(buildConnectConfig(opts, state));
  });
}

/** Esegue un singolo comando exec e risolve con stdout/stderr/exitCode. */
export async function sshExec(opts: SshOptions, command: string): Promise<SshResult> {
  const conn = await connectSsh(opts);
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    conn.exec(command, (err, stream) => {
      if (err) {
        try { conn.end(); } catch { /* ignore */ }
        const info = mapSshError(err, {
          host: opts.host,
          port: opts.port ?? 22,
          username: opts.username,
          credentialName: opts.credentialName,
        });
        return reject(new SshError({ ...info, kind: "command_error" }));
      }
      stream.on("data", (d: Buffer) => { stdout += d.toString(); });
      stream.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      stream.on("close", (code: number) => {
        try { conn.end(); } catch { /* ignore */ }
        resolve({ stdout, stderr, code });
      });
    });
  });
}

/**
 * Wrapper di lifecycle: apre conn, passa al callback, chiude in `finally`.
 * Da usare per shell streams o pattern multi-comando.
 */
export async function withSshClient<T>(
  opts: SshOptions,
  callback: (client: SshClient) => Promise<T>
): Promise<T> {
  const conn = await connectSsh(opts);
  try {
    return await callback(conn);
  } finally {
    try { conn.end(); } catch { /* ignore */ }
  }
}

/**
 * Mappa un errore raw (di ssh2, di un comando, ecc.) in `SshErrorInfo` con messaggio
 * italiano parlante e suggerimento di fix.
 */
export function mapSshError(err: unknown, ctx: MapSshErrorContext = {}): SshErrorInfo {
  const raw = err instanceof Error ? err.message : String(err);
  const low = raw.toLowerCase();
  const target = ctx.host ? `${ctx.host}:${ctx.port ?? 22}` : "il dispositivo";
  const credLabel = ctx.credentialName ? ` (credenziale "${ctx.credentialName}")` : "";
  const userLabel = ctx.username ? ` per utente "${ctx.username}"` : "";
  const base = {
    raw,
    host: ctx.host,
    port: ctx.port,
    username: ctx.username,
    credentialName: ctx.credentialName,
    methodsOffered: ctx.methodsOffered,
    methodsTried: ctx.methodsTried,
  };

  // === Auth ===
  if (
    low.includes("all configured authentication methods failed") ||
    low.includes("no more authentication methods available")
  ) {
    const offered = ctx.methodsOffered ?? [];
    if (offered.length === 1 && offered[0] === "publickey") {
      return {
        ...base,
        kind: "auth_method_unsupported",
        message: `${target}${userLabel}: il server accetta solo autenticazione a chiave pubblica${credLabel}.`,
        hint: "Pubblica la chiave SSH del server DA-IPAM in authorized_keys del dispositivo, oppure abilita password/keyboard-interactive nello sshd_config del dispositivo.",
      };
    }
    if (offered.length > 0 && !offered.includes("password") && !offered.includes("keyboard-interactive")) {
      return {
        ...base,
        kind: "auth_method_unsupported",
        message: `${target}${userLabel}: il server SSH non accetta password (metodi offerti: ${offered.join(", ")})${credLabel}.`,
        hint: "Verifica sshd_config del dispositivo (PasswordAuthentication, KbdInteractiveAuthentication).",
      };
    }
    if (ctx.methodsTried?.includes("password") || ctx.methodsTried?.includes("keyboard-interactive")) {
      return {
        ...base,
        kind: "auth_failed",
        message: `${target}${userLabel}: credenziali rifiutate dal server${credLabel}${offered.length ? ` (metodi tentati: ${ctx.methodsTried.join(", ")}, offerti: ${offered.join(", ")})` : ""}.`,
        hint: "Verifica username/password della credenziale. Su appliance (Stormshield, SonicWall, Cisco) controlla che l'utente abbia il permesso 'access via SSH'.",
      };
    }
    return {
      ...base,
      kind: "auth_failed",
      message: `${target}${userLabel}: autenticazione fallita${credLabel}.`,
      hint: "Verifica username/password e che l'utente sia abilitato a SSH.",
    };
  }

  if (
    low.includes("authentication failed") ||
    low.includes("permission denied")
  ) {
    return {
      ...base,
      kind: "auth_failed",
      message: `${target}${userLabel}: credenziali rifiutate${credLabel}.`,
      hint: "Verifica username/password della credenziale e che l'utente sia abilitato a SSH sul dispositivo.",
    };
  }

  // === Network ===
  if (low.includes("econnrefused") || low.includes("connection refused")) {
    return {
      ...base,
      kind: "connect_refused",
      message: `${target}: connessione SSH rifiutata (porta ${ctx.port ?? 22} non in ascolto o filtrata).`,
      hint: "Verifica che il servizio SSH sia attivo sul dispositivo e che la porta non sia bloccata da firewall.",
    };
  }
  if (low.includes("etimedout") || low.includes("timed out") || low.includes("timeout")) {
    return {
      ...base,
      kind: "connect_timeout",
      message: `${target}: timeout di connessione SSH.`,
      hint: "Verifica raggiungibilità di rete (ping/route) e che la porta SSH non sia bloccata da firewall.",
    };
  }
  if (
    low.includes("ehostunreach") ||
    low.includes("no route to host") ||
    low.includes("network unreachable") ||
    low.includes("enetunreach")
  ) {
    return {
      ...base,
      kind: "unreachable",
      message: `${target}: host non raggiungibile (no route).`,
      hint: "Verifica routing e segmentazione di rete tra DA-IPAM e il dispositivo.",
    };
  }
  if (low.includes("getaddrinfo") || low.includes("enotfound") || low.includes("eai_again")) {
    return {
      ...base,
      kind: "unreachable",
      message: `Hostname "${ctx.host}" non risolto.`,
      hint: "Usa un IP statico nel device o verifica DNS.",
    };
  }

  // === Protocol / handshake ===
  if (low.includes("handshake")) {
    return {
      ...base,
      kind: "protocol_error",
      message: `${target}: handshake SSH fallito.`,
      hint: "Il dispositivo potrebbe richiedere algoritmi crittografici legacy non supportati. Aggiorna firmware o aggiungi kex algorithm via override.",
    };
  }
  if (low.includes("host key") || low.includes("hostkey")) {
    return {
      ...base,
      kind: "host_key_changed",
      message: `${target}: chiave host SSH non accettata.`,
      hint: "DA-IPAM non verifica la host key, l'errore arriva direttamente dalla libreria — controlla i log per dettagli.",
    };
  }
  if (low.includes("kex") || low.includes("algorithm")) {
    return {
      ...base,
      kind: "protocol_error",
      message: `${target}: negoziazione algoritmi SSH fallita.`,
      hint: "Il dispositivo richiede algoritmi non supportati. Forza algoritmi legacy via SshOptions.kexAlgorithms.",
    };
  }

  return {
    ...base,
    kind: "unknown",
    message: `${target}: errore SSH: ${raw}`,
  };
}

/**
 * Variante diagnostica: NON propaga, ritorna l'SshErrorInfo (o `null` se OK).
 * Utile per route di "test credenziale" che vogliono comunque restituire 200 con
 * l'esito strutturato all'UI.
 */
export async function sshTryConnect(opts: SshOptions, probeCommand = "echo da-ipam-probe"): Promise<{ ok: true; result: SshResult; methodsOffered?: string[]; methodsTried?: string[] } | { ok: false; error: SshErrorInfo }> {
  try {
    const result = await sshExec(opts, probeCommand);
    return { ok: true, result };
  } catch (e) {
    if (e instanceof SshError) {
      return {
        ok: false,
        error: {
          kind: e.kind,
          message: e.message,
          hint: e.hint,
          raw: e.raw,
          host: e.host,
          port: e.port,
          username: e.username,
          credentialName: e.credentialName,
          methodsOffered: e.methodsOffered,
          methodsTried: e.methodsTried,
        },
      };
    }
    return {
      ok: false,
      error: mapSshError(e, { host: opts.host, port: opts.port, username: opts.username, credentialName: opts.credentialName }),
    };
  }
}
