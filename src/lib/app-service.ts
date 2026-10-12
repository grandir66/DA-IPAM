/**
 * Come si riavvia DA-IPAM dall'interfaccia: pulsante «Riavvia»
 * (POST /api/system/update, action=restart) e la fine di un «Aggiorna» riuscito.
 *
 * In esercizio DA-IPAM gira sotto systemd come root, con `Restart=on-failure`:
 * unità `da-invent` sulle installazioni classiche (scripts/install.sh,
 * deploy/da-invent.service), `da-ipam` sulle appliance di Deploy-Appliance (DTS).
 *
 * Regola: SOTTO SYSTEMD SI RIAVVIA LA PROPRIA UNITÀ, e non si esce mai con 0.
 *  - L'unità si legge da /proc/self/cgroup, che dice in quale servizio gira
 *    questo processo, qualunque sia il suo nome.
 *  - Se si capisce di essere sotto systemd (INVOCATION_ID) ma non quale unità,
 *    si esce con 1: `Restart=on-failure` fa ripartire il servizio.
 *  - Il rilancio di sé (processo staccato + uscita con 0) resta solo fuori da
 *    systemd, cioè in sviluppo: sotto systemd il figlio muore col gruppo
 *    dell'unità e l'uscita con 0 non viene riavviata, quindi il servizio resta
 *    spento.
 *
 * Fino al 12/10/2026 si sceglieva il primo ATTIVO fra `da-invent` e `da-ipam`
 * con `systemctl is-active` (INS-1). La revisione ha trovato due buchi: con
 * systemctl scaduto (3 s, macchina sotto carico) o un'unità con un altro nome
 * risultava «nessun servizio» e si ripiegava sul rilancio di sé; con tutti e due
 * attivi si poteva riavviare quello che non era questo processo.
 *
 * Le scelte sono funzioni pure con le dipendenze iniettabili, provate in
 * src/lib/__tests__/app-service.test.ts; la rotta le compone.
 */
import { execFileSync, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs";

// --- In quale unità gira questo processo ------------------------------------

/** Nome di un servizio systemd: i caratteri ammessi da systemd, `.service` in fondo. */
const UNITA_SERVIZIO = /^[A-Za-z0-9:_.@\\-]+\.service$/;
/** Il gestore dei servizi di un utente: né lui né quello che contiene si riavvia da qui. */
const GESTORE_UTENTE = /^user@\d+\.service$/;

/**
 * L'unità di sistema in cui gira il processo, dal contenuto di /proc/self/cgroup;
 * null se il processo non è dentro un servizio di sistema.
 *
 *  - cgroup v2: una riga `0::/system.slice/da-ipam.service`
 *  - cgroup v1: la riga della gerarchia di systemd,
 *    `1:name=systemd:/system.slice/da-invent.service` (le righe dei controller,
 *    `12:pids:/…`, dicono dove sta il processo per quel controller, non chi lo
 *    gestisce, e si ignorano)
 *
 * L'unità è l'ultimo tratto del percorso, se è un `.service`. Non lo è per un
 * terminale (`session-3.scope`), un container (`/`, `/docker/<id>`) o un servizio
 * del gestore di un utente (`…/user@1000.service/…`), che il systemctl di sistema
 * non vede.
 */
export function systemdUnitFromCgroup(contenuto: string): string | null {
  for (const riga of contenuto.split("\n")) {
    const m = /^(?:0::|\d+:name=systemd:)(\/.*)$/.exec(riga.trim());
    if (!m) continue;
    const tratti = m[1].split("/").filter(Boolean);
    const ultimo = tratti.at(-1);
    if (!ultimo || !UNITA_SERVIZIO.test(ultimo)) continue;
    if (tratti.some((t) => GESTORE_UTENTE.test(t))) continue;
    return ultimo;
  }
  return null;
}

/** Quello che serve per decidere come riavviare. */
export interface RestartContext {
  /** Unità di sistema del proprio cgroup (systemdUnitFromCgroup), o null. */
  unit: string | null;
  /** `INVOCATION_ID`: systemd la imposta per ogni processo di un servizio. */
  invocationId: string | null;
  /** Perché /proc/self/cgroup non si è letto (su macOS non esiste), o null. */
  cgroupError: string | null;
}

/** Legge /proc/self/cgroup e l'ambiente. Le due fonti si sostituiscono nelle prove. */
export function readRestartContext(
  readCgroup: () => string = () => fs.readFileSync("/proc/self/cgroup", "utf8"),
  env: Readonly<Record<string, string | undefined>> = process.env,
): RestartContext {
  let unit: string | null = null;
  let cgroupError: string | null = null;
  try {
    unit = systemdUnitFromCgroup(readCgroup());
  } catch (err) {
    // Non è fatale: fuori da Linux il file non c'è. Sotto systemd decide
    // INVOCATION_ID, e il motivo finisce nel log se si esce con 1.
    cgroupError = err instanceof Error ? err.message : String(err);
  }
  const invocationId = env.INVOCATION_ID?.trim() || null;
  return { unit, invocationId, cgroupError };
}

export type RestartPlan =
  /** Sotto systemd, unità nota: `systemctl --no-block restart <unità>`. */
  | { mode: "unit"; unit: string }
  /** Sotto systemd, unità ignota: uscita con 1, la riavvia Restart=on-failure. */
  | { mode: "exit-1"; reason: string }
  /** Fuori da systemd (sviluppo, PM2): l'unico caso in cui ci si rilancia da sé. */
  | { mode: "not-systemd" };

/**
 * Come riavviare. Basta UNO dei due segni per essere sotto systemd: l'unità nel
 * cgroup, oppure INVOCATION_ID. Sotto systemd il rilancio di sé non si fa mai.
 */
export function planRestart(ctx: RestartContext): RestartPlan {
  if (ctx.unit) return { mode: "unit", unit: ctx.unit };
  if (ctx.invocationId) {
    const dettaglio = ctx.cgroupError
      ? `/proc/self/cgroup illeggibile: ${ctx.cgroupError}`
      : "/proc/self/cgroup non indica un servizio di sistema";
    return {
      mode: "exit-1",
      reason: `gira sotto systemd (INVOCATION_ID) ma l'unità non si riconosce (${dettaglio})`,
    };
  }
  return { mode: "not-systemd" };
}

/** Sotto systemd senza un'unità da riavviare: uscita con 1, mai con 0. */
export function exitForSystemd(
  motivo: string,
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  console.error(`[Riavvio] ${motivo}: esco con 1, Restart=on-failure fa ripartire il servizio`);
  exit(1);
}

// --- PM2 (solo fuori da systemd) --------------------------------------------

/** I nomi con cui si cerca il processo in PM2, in quest'ordine. */
export const APP_SERVICE_NAMES = ["da-invent", "da-ipam"] as const;
export type AppServiceName = (typeof APP_SERVICE_NAMES)[number];

/**
 * `pm2 id <nome>` stampa `[]` se PM2 non ha un processo con quel nome e `[ 0 ]`
 * se ce l'ha; nessuna uscita se PM2 non c'è.
 */
export function pm2HasProcess(output: string): boolean {
  const t = output.trim();
  return t !== "" && t !== "[]";
}

/** Il primo nome che PM2 conosce, null se nessuno. */
export function pickPm2Process(
  uscite: Readonly<Record<AppServiceName, string>>,
): AppServiceName | null {
  return APP_SERVICE_NAMES.find((nome) => pm2HasProcess(uscite[nome])) ?? null;
}

function pm2IdOutput(nome: AppServiceName): string {
  try {
    return execFileSync("pm2", ["id", nome], {
      timeout: 3000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // PM2 assente (il caso di tutte le installazioni note) o in errore: come
    // prima, si passa al tentativo successivo.
    return "";
  }
}

/** `pm2 id` per ciascun nome. `pm2Id` si sostituisce nelle prove. */
export function readPm2Ids(
  pm2Id: (nome: AppServiceName) => string = pm2IdOutput,
): Record<AppServiceName, string> {
  return { "da-invent": pm2Id("da-invent"), "da-ipam": pm2Id("da-ipam") };
}

// --- systemctl restart --------------------------------------------------------

/** `--no-block`: systemctl accoda il riavvio ed esce, senza aspettare che finisca. */
export function systemdRestartArgs(unit: string): string[] {
  return ["--no-block", "restart", unit];
}

/** Oltre questo tempo un systemctl senza risposta si considera fallito. */
export const SYSTEMCTL_TIMEOUT_MS = 15_000;

/**
 * Rete di sicurezza: accodato il riavvio, systemd ferma questo processo in pochi
 * secondi (SIGTERM, che server.ts non intercetta). Se dopo questo tempo è ancora
 * vivo, il riavvio si è perso per strada: si esce con 1.
 */
export const RESTART_SAFETY_NET_MS = 90_000;

/** Un timer che non trattiene il processo: se esce prima, il timer sparisce con lui. */
export function scheduleUnref(fn: () => void, ms: number): void {
  setTimeout(fn, ms).unref();
}

export interface SystemdRestartDeps {
  spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  exit: (code: number) => void;
  schedule: (fn: () => void, ms: number) => void;
}

const DEFAULT_RESTART_DEPS: SystemdRestartDeps = {
  spawn: (command, args, options) => spawn(command, args, options),
  exit: (code) => process.exit(code),
  schedule: scheduleUnref,
};

/**
 * Chiede a systemd di riavviare l'unità e NON esce da solo: è systemd che
 * ferma questo processo (SIGTERM a tutto il gruppo dell'unità) e lo fa ripartire.
 *
 * Prima si usciva con 0 subito dopo aver lanciato systemctl. systemctl sta nel
 * gruppo di processi del servizio, e quando il processo principale esce systemd
 * chiude anche lui: se lo chiudeva prima che la richiesta fosse consegnata, il
 * riavvio non partiva, e con `Restart=on-failure` un'uscita con 0 non viene
 * riavviata. Il servizio restava spento.
 *
 * Se systemctl non accoda il riavvio (permessi, unità sparita, nessuna risposta
 * entro SYSTEMCTL_TIMEOUT_MS) si esce con 1, e il motivo va nel log. Se lo
 * accoda ma dopo RESTART_SAFETY_NET_MS il processo è ancora vivo, si esce con 1
 * lo stesso. In tutti e due i casi `Restart=on-failure` fa ripartire il servizio.
 */
export function restartWithSystemd(
  unit: string,
  deps: SystemdRestartDeps = DEFAULT_RESTART_DEPS,
): void {
  let stderr = "";
  let concluso = false;
  const fallito = (motivo: string) => {
    if (concluso) return;
    concluso = true;
    exitForSystemd(`systemctl restart ${unit} non riuscito (${motivo})`, deps.exit);
  };

  let figlio: ChildProcess;
  try {
    figlio = deps.spawn("systemctl", systemdRestartArgs(unit), {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: SYSTEMCTL_TIMEOUT_MS,
    });
  } catch (err) {
    fallito(err instanceof Error ? err.message : String(err));
    return;
  }

  figlio.stderr?.on("data", (chunk: Buffer) => {
    if (stderr.length < 500) stderr += chunk.toString();
  });
  figlio.once("error", (err: Error) => fallito(err.message));
  // "close" e non "exit": arriva dopo che stderr è stato letto tutto.
  figlio.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
    if (code === 0) {
      if (concluso) return;
      concluso = true;
      console.info(`[Riavvio] riavvio di ${unit} accodato a systemd`);
      deps.schedule(() => {
        exitForSystemd(
          `riavvio di ${unit} accodato ma dopo ${RESTART_SAFETY_NET_MS / 1000} s ` +
            "questo processo è ancora vivo",
          deps.exit,
        );
      }, RESTART_SAFETY_NET_MS);
      return;
    }
    const dettaglio = stderr.trim();
    fallito(
      `codice ${code ?? "nessuno"}, segnale ${signal ?? "nessuno"}` +
        (dettaglio ? `: ${dettaglio}` : ""),
    );
  });
}
