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
 *    che prova in ordine `publickey` (se la credenziale ha la chiave) → `password` →
 *    `keyboard-interactive` in base ai metodi che il server dichiara.
 *
 * 2. **Errori di auth non parlanti**. I call site catturavano `e.message` raw dalla
 *    libreria, che è inglese, contestualmente povero e spesso lo stesso identico per
 *    cause diverse ("All configured authentication methods failed").
 *
 *    Fix: `mapSshError(err, ctx)` categorizza in `SshErrorKind` e produce un messaggio
 *    italiano che include host:port, username, credenziale, metodi offerti dal server,
 *    e un `hint` di fix.
 *
 * 3. **Chiave SSH** (tappa 2 credenziali, T14, D6 = (a), 16/10). Prima la password era
 *    obbligatoria e una voce SSH a chiave arrivava qui senza segreto. Ora `privateKey`
 *    (con `passphrase` facoltativa) si legge con `leggiChiavePrivata` PRIMA di aprire la
 *    connessione: una chiave illeggibile è `key_invalid` col motivo, mai un accesso
 *    tentato senza segreto; senza password né chiave è `no_credentials`.
 */

import type { Client as SshClient, ConnectConfig, ParsedKey } from "ssh2";

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
  /** Password (anche per keyboard-interactive). Serve questa o `privateKey`. */
  password?: string;
  /** Chiave privata: OpenSSH o PEM (RSA, ECDSA, ed25519). Si prova prima della password. */
  privateKey?: string;
  /** Passphrase della chiave, se è cifrata. */
  passphrase?: string;
  /** Timeout connessione (ms). Default 15000. */
  timeout?: number;
  /** Etichetta credenziale: appare nei messaggi d'errore (es. "SSH-FWL"). */
  credentialName?: string;
  /** Override algoritmi KEX (per device che richiedono kex legacy). */
  kexAlgorithms?: string[];
}

/** Il segreto di un accesso SSH: password, chiave o tutte e due (come esce da `opzioniSsh` di segreti.ts). */
export type SegretoSsh = Pick<SshOptions, "password" | "privateKey" | "passphrase">;

/**
 * I campi del segreto, senza quelli vuoti, da spargere in `SshOptions` (`{ host, port, username, ...segretoSsh(c) }`).
 * La passphrase va solo con la chiave.
 */
export function segretoSsh(a: { password?: string | null; privateKey?: string | null; passphrase?: string | null }): SegretoSsh {
  return {
    ...(a.password ? { password: a.password } : {}),
    ...(a.privateKey ? { privateKey: a.privateKey } : {}),
    ...(a.privateKey && a.passphrase ? { passphrase: a.passphrase } : {}),
  };
}

/** C'è un segreto per entrare: password o chiave privata. */
export function haSegretoSsh(a: { password?: string | null; privateKey?: string | null } | null | undefined): boolean {
  return !!(a?.password || a?.privateKey);
}

export interface SshResult {
  stdout: string;
  stderr: string;
  /** Il codice d'uscita; `undefined` se il canale si è chiuso senza (connessione caduta: l'uscita può essere tagliata). */
  code: number | undefined;
}

export type SshErrorKind =
  | "auth_failed"
  | "auth_method_unsupported"
  | "no_credentials"
  | "key_invalid"
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
  /** `none` già mandato una volta, a metodi finiti. */
  noneTried?: boolean;
}

type AuthMethod = "publickey" | "password" | "keyboard-interactive";

/** I metodi che la credenziale permette, nell'ordine: prima la chiave, poi la password. */
function metodiDellaCredenziale(opts: SshOptions, chiave: ParsedKey | null): AuthMethod[] {
  return [...(chiave ? (["publickey"] as const) : []), ...(opts.password ? (["password", "keyboard-interactive"] as const) : [])];
}

function pickNextMethod(state: SshAuthState, methodsLeft: string[] | null, propri: AuthMethod[]): AuthMethod | null {
  // methodsLeft è null al primo tentativo: si parte dal primo metodo della credenziale.
  const available = methodsLeft ?? propri;
  for (const m of propri) {
    if (available.includes(m) && !state.methodsTried.includes(m)) return m;
  }
  return null;
}

function buildConnectConfig(opts: SshOptions, state: SshAuthState, chiave: ParsedKey | null): ConnectConfig {
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
    tryKeyboard: !!opts.password,
    authHandler: ((methodsLeft, _partial, cb): void => {
      if (methodsLeft && !state.methodsOffered) state.methodsOffered = [...methodsLeft];

      const next = pickNextMethod(state, methodsLeft, metodiDellaCredenziale(opts, chiave));
      if (!next) {
        // Esauriti i metodi: un `none` (qualche apparato lo accetta), poi `false`, cioè l'errore
        // d'autenticazione di ssh2. Prima si rispondeva `none` a ogni giro: il server lo rifiutava, ssh2
        // richiamava l'handler, e una password sbagliata finiva in «timeout» invece che in «credenziali
        // rifiutate» (T14, 16/10).
        if (state.noneTried) {
          // ssh2 accetta `false` (fine dei tentativi), i suoi tipi no.
          (cb as unknown as (fine: false) => void)(false);
          return;
        }
        state.noneTried = true;
        cb({ type: "none", username: opts.username });
        return;
      }
      state.methodsTried.push(next);
      const password = opts.password ?? "";
      if (next === "publickey" && chiave) {
        cb({ type: "publickey", username: opts.username, key: chiave });
      } else if (next === "password") {
        cb({ type: "password", username: opts.username, password });
      } else {
        cb({
          type: "keyboard-interactive",
          username: opts.username,
          prompt: (_name, _instructions, _lang, _prompts, finish) => finish([password]),
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
  const chiave = await chiaveDelleOpzioni(opts);

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
      // Rispondi a ogni prompt con la password (pattern standard per "Password:"); senza password
      // keyboard-interactive non si sceglie mai (metodiDellaCredenziale).
      finish([opts.password ?? ""]);
    });
    conn.connect(buildConnectConfig(opts, state, chiave));
  });
}

/**
 * La chiave delle opzioni, letta prima di connettere; null senza chiave. Una chiave che non si legge
 * (`key_invalid`) o una credenziale senza password né chiave (`no_credentials`) è un `SshError` subito,
 * senza aprire la connessione.
 */
async function chiaveDelleOpzioni(opts: SshOptions): Promise<ParsedKey | null> {
  const target = `${opts.host}:${opts.port ?? 22}`;
  const credLabel = opts.credentialName ? ` (credenziale "${opts.credentialName}")` : "";
  const userLabel = opts.username ? ` per utente "${opts.username}"` : "";
  const base = { host: opts.host, port: opts.port ?? 22, username: opts.username, credentialName: opts.credentialName };
  if (opts.privateKey) {
    const { leggiChiavePrivata } = await import("./chiave-ssh");
    const letta = leggiChiavePrivata(opts.privateKey, opts.passphrase);
    if (letta.ok) return letta.chiave;
    throw new SshError({
      ...base,
      kind: "key_invalid",
      message: `${target}${userLabel}: la chiave privata${credLabel} non si legge: ${letta.motivo}.`,
      hint: "Incolla la chiave privata intera (OpenSSH o PEM: RSA, ECDSA, ed25519) e, se è cifrata, la sua passphrase.",
      raw: letta.motivo,
    });
  }
  if (!opts.password) {
    throw new SshError({
      ...base,
      kind: "no_credentials",
      message: `${target}${userLabel}: la credenziale${credLabel} non ha né password né chiave privata.`,
      hint: "Completa la credenziale SSH con la password o con la chiave privata.",
      raw: "nessuna password né chiave",
    });
  }
  return null;
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
      stream.on("close", (code: number | undefined) => {
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
    if (ctx.methodsTried?.includes("publickey")) {
      // Si è provata la chiave della credenziale (T14): il server l'ha rifiutata, o non accetta chiavi.
      const conPassword = ctx.methodsTried.includes("password") || ctx.methodsTried.includes("keyboard-interactive");
      const tentati = ` (metodi tentati: ${ctx.methodsTried.join(", ")}${offered.length ? `, offerti: ${offered.join(", ")}` : ""})`;
      if (offered.length > 0 && !offered.includes("publickey")) {
        return {
          ...base,
          kind: "auth_method_unsupported",
          message: `${target}${userLabel}: il server SSH non accetta l'autenticazione a chiave${credLabel}${tentati}.`,
          hint: "Usa una credenziale con password, oppure abilita PubkeyAuthentication nello sshd_config del dispositivo.",
        };
      }
      return {
        ...base,
        kind: "auth_failed",
        message: `${target}${userLabel}: la chiave privata${credLabel} è stata rifiutata dal server${conPassword ? ", e anche la password" : ""}${tentati}.`,
        hint: "Verifica che la chiave pubblica corrispondente sia in ~/.ssh/authorized_keys dell'utente sul dispositivo, e che l'utente sia quello giusto.",
      };
    }
    if (offered.length === 1 && offered[0] === "publickey") {
      return {
        ...base,
        kind: "auth_method_unsupported",
        message: `${target}${userLabel}: il server accetta solo autenticazione a chiave pubblica${credLabel}.`,
        hint: "Il dispositivo accetta solo chiavi: usa una credenziale SSH col metodo «Chiave privata» (la sua chiave pubblica in authorized_keys del dispositivo), oppure abilita password/keyboard-interactive nello sshd_config del dispositivo.",
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

/** Codice dell'errore di un comando che non ha risposto entro il suo tempo massimo (spec topologia §13.5.1, I53). */
export const CODICE_TEMPO_SCADUTO = "TEMPO_SCADUTO";

/**
 * Codice di un comando la cui connessione è caduta prima della fine, o il cui canale si è chiuso senza codice d'uscita
 * (revisione del Task 4 di T2): l'uscita può essere tagliata, quindi «non so», mai «letto».
 */
export const CODICE_CONNESSIONE_CADUTA = "CONNESSIONE_CADUTA";

export class ComandoScaduto extends Error {
  readonly code = CODICE_TEMPO_SCADUTO;
  constructor(tempoMs: number) {
    super(`Il comando non ha risposto entro ${tempoMs} ms`);
    this.name = "ComandoScaduto";
  }
}

/**
 * Un `exec` su una connessione già aperta (`withSshClient`), con un tempo massimo: allo scadere chiude il canale e dà
 * `ComandoScaduto` (codice `TEMPO_SCADUTO`). Lo usano solo i comandi nuovi delle letture in più (spec §13.5.1): quelli di
 * oggi restano senza finché non si misura la durata vera dei loro giri. Il codice d'uscita torna com'è: su RouterOS un
 * comando sbagliato esce con 0 e scrive l'errore su stdout, e chi chiama lo riconosce dal testo.
 */
export function execConTempo(conn: Pick<SshClient, "exec">, command: string, tempoMs: number): Promise<SshResult> {
  return new Promise((resolve, reject) => {
    let finito = false;
    let canale: { close?: () => void } | null = null;
    const timer = setTimeout(() => {
      if (finito) return;
      finito = true;
      try { canale?.close?.(); } catch { /* il canale può essere già chiuso */ }
      reject(new ComandoScaduto(tempoMs));
    }, tempoMs);
    const fallito = (err: unknown): void => {
      if (finito) return;
      finito = true;
      clearTimeout(timer);
      reject(err);
    };
    try {
      conn.exec(command, (err, stream) => {
        if (err) {
          fallito(err);
          return;
        }
        if (finito) {
          // Il tempo è scaduto prima che il canale si aprisse: nessuno aspetta più, il canale non resta aperto.
          try { stream.close(); } catch { /* il canale può essere già chiuso */ }
          return;
        }
        canale = stream;
        let stdout = "";
        let stderr = "";
        stream.on("data", (d: Buffer) => { stdout += d.toString(); });
        stream.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
        stream.on("close", (code: number | undefined) => {
          if (finito) return;
          finito = true;
          clearTimeout(timer);
          resolve({ stdout, stderr, code });
        });
      });
    } catch (err) {
      // Revisione del Task 4 di T2: `exec` lancia subito su una connessione già chiusa («Not connected»); senza questo il
      // timer del tempo massimo restava acceso fino allo scadere.
      fallito(err);
    }
  });
}
