/**
 * Il servizio di sistema che fa girare DA-IPAM, e come lo si riavvia
 * dall'interfaccia (pulsante «Riavvia» → POST /api/system/update?action=restart).
 *
 * Il servizio ha due nomi in esercizio:
 *  - `da-invent` sulle installazioni classiche (scripts/install.sh,
 *    deploy/da-invent.service, hub);
 *  - `da-ipam` sulle appliance installate con Deploy-Appliance (DTS).
 *
 * Criterio, lo stesso di scripts/update.sh (commit 30886a3): si riavvia il primo
 * ATTIVO dei due, in quest'ordine; se nessuno è attivo, systemd non c'entra.
 * Fino al 12/10/2026 il pulsante cercava solo `da-invent` (INS-1): su DTS saltava
 * systemd e ripiegava sul rilancio da sé, che sotto systemd non sopravvive.
 *
 * Le scelte sono funzioni pure, provate in src/lib/__tests__/app-service.test.ts;
 * i comandi veri (systemctl, pm2) partono solo dalla rotta.
 */
import { execFileSync, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

/** I nomi del servizio, nell'ordine in cui si cercano. */
export const APP_SERVICE_NAMES = ["da-invent", "da-ipam"] as const;
export type AppServiceName = (typeof APP_SERVICE_NAMES)[number];

/**
 * Codice d'uscita di un comando (per `systemctl is-active --quiet`: 0 = attivo),
 * oppure null se il comando non ne ha dato uno: assente, scaduto, ucciso.
 */
export type ExitStatus = number | null;

/**
 * Quale servizio riavviare, dato l'esito di `systemctl is-active` per i due nomi:
 * il primo attivo nell'ordine di APP_SERVICE_NAMES, null se nessuno lo è.
 * Un esito senza codice (null) vale "non attivo": se systemctl non risponde,
 * a systemd non si può chiedere niente.
 */
export function pickServiceToRestart(
  esiti: Readonly<Record<AppServiceName, ExitStatus>>,
): AppServiceName | null {
  return APP_SERVICE_NAMES.find((nome) => esiti[nome] === 0) ?? null;
}

/**
 * Codice d'uscita di un comando lanciato in modo sincrono (execFileSync):
 * 0 se finisce bene, il suo codice se esce con errore, null se non ne dà uno.
 */
export function exitStatusOf(run: () => unknown): ExitStatus {
  try {
    run();
    return 0;
  } catch (err) {
    const status = (err as { status?: unknown } | null)?.status;
    return typeof status === "number" ? status : null;
  }
}

function systemctlIsActive(nome: AppServiceName): ExitStatus {
  return exitStatusOf(() =>
    execFileSync("systemctl", ["is-active", "--quiet", nome], { timeout: 3000, stdio: "ignore" }),
  );
}

/** `systemctl is-active` per ciascun nome. `isActive` si sostituisce nelle prove. */
export function readServiceStates(
  isActive: (nome: AppServiceName) => ExitStatus = systemctlIsActive,
): Record<AppServiceName, ExitStatus> {
  return { "da-invent": isActive("da-invent"), "da-ipam": isActive("da-ipam") };
}

/**
 * `pm2 id <nome>` stampa `[]` se PM2 non ha un processo con quel nome e `[ 0 ]`
 * se ce l'ha; nessuna uscita se PM2 non c'è.
 */
export function pm2HasProcess(output: string): boolean {
  const t = output.trim();
  return t !== "" && t !== "[]";
}

/** Con PM2 vale lo stesso criterio: il primo nome che PM2 conosce, null se nessuno. */
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

/** `--no-block`: systemctl accoda il riavvio ed esce, senza aspettare che finisca. */
export function systemdRestartArgs(nome: AppServiceName): string[] {
  return ["--no-block", "restart", nome];
}

/** Oltre questo tempo un systemctl senza risposta si considera fallito. */
export const SYSTEMCTL_TIMEOUT_MS = 15_000;

export interface SystemdRestartDeps {
  spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  exit: (code: number) => void;
}

const DEFAULT_RESTART_DEPS: SystemdRestartDeps = {
  spawn: (command, args, options) => spawn(command, args, options),
  exit: (code) => process.exit(code),
};

/**
 * Chiede a systemd di riavviare il servizio e NON esce da solo: è systemd che
 * ferma questo processo (SIGTERM a tutto il gruppo dell'unità) e lo fa ripartire.
 *
 * Prima si usciva con 0 subito dopo aver lanciato systemctl. systemctl sta nel
 * gruppo di processi del servizio, e quando il processo principale esce systemd
 * chiude anche lui: se lo chiudeva prima che la richiesta fosse consegnata, il
 * riavvio non partiva, e con `Restart=on-failure` (le unità da-invent e da-ipam)
 * un'uscita con 0 non viene riavviata. Il servizio restava spento.
 *
 * Se systemctl non accoda il riavvio (permessi, unità sparita, nessuna risposta
 * entro SYSTEMCTL_TIMEOUT_MS) si esce con 1, e il motivo va nel log:
 * `Restart=on-failure` fa ripartire il servizio comunque.
 */
export function restartWithSystemd(
  nome: AppServiceName,
  deps: SystemdRestartDeps = DEFAULT_RESTART_DEPS,
): void {
  let stderr = "";
  let concluso = false;
  const fallito = (motivo: string) => {
    if (concluso) return;
    concluso = true;
    console.error(
      `[Riavvio] systemctl restart ${nome} non riuscito (${motivo}): esco con 1, ` +
        "Restart=on-failure fa ripartire il servizio",
    );
    deps.exit(1);
  };

  let figlio: ChildProcess;
  try {
    figlio = deps.spawn("systemctl", systemdRestartArgs(nome), {
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
      console.info(`[Riavvio] riavvio di ${nome} accodato a systemd`);
      return;
    }
    const dettaglio = stderr.trim();
    fallito(
      `codice ${code ?? "nessuno"}, segnale ${signal ?? "nessuno"}` +
        (dettaglio ? `: ${dettaglio}` : ""),
    );
  });
}
