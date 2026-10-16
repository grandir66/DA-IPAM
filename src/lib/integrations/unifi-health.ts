/**
 * Salute dei controller di rete per «Stato moduli» (ADR 0007).
 *
 * Non contatta i controller: legge l'esito dell'ultima lettura di ciascuno
 * (`network_controllers.last_*`, scritto da `syncController`). Prima la sonda
 * faceva un login a ogni apertura della dashboard (con un risultato tenuto
 * cinque minuti); con più controller sarebbero stati più login nel registro
 * accessi del cliente per sapere una cosa che lo storico sa già. Chi vuole un
 * esito fresco usa «Prova» o «Sincronizza ora» nella pagina Controller di rete.
 *
 * Va chiamata nel contesto del tenant. Non scrive niente (a parte, una volta
 * per tenant, il passaggio della configurazione vecchia dell'hub: vedi
 * `migrateLegacyUnifiConfig`). La risposta non porta mai segreti.
 */
import { listControllerViews } from "@/lib/controllers/service";
import type { NetworkControllerView } from "@/lib/controllers/types";

export type UnifiHealthRepair = "reconfigure_unifi" | "check_unifi_cert" | null;

export interface UnifiHealthReading {
  /** false = nessun controller acceso: «Non configurato», non un errore. */
  configured: boolean;
  reachable: boolean;
  authOk: boolean;
  verdict: "ok" | "degraded" | "fail";
  detail: string;
  repair: UnifiHealthRepair;
  /** Ultima lettura riuscita fra i controller accesi (UTC, formato SQLite). */
  lastSyncAt: string | null;
}

const CERT_RE = /certificat/i;

/** Verdetto dai controller del tenant. Parte pura. */
export function composeControllersHealth(controllers: readonly NetworkControllerView[]): UnifiHealthReading {
  const on = controllers.filter((c) => c.enabled && c.kind !== "omada");
  const lastSyncAt =
    on
      .filter((c) => c.lastOk === true && c.lastRunAt)
      .map((c) => c.lastRunAt as string)
      .sort()
      .pop() ?? null;
  const off = { reachable: false, authOk: false, lastSyncAt };
  if (on.length === 0) {
    return { configured: false, ...off, verdict: "fail", detail: "Non configurato", repair: null };
  }
  const failed = on.filter((c) => c.lastOk === false);
  if (failed.length > 0) {
    const first = failed[0];
    const msg = first.lastMessage ?? "ultima lettura non riuscita";
    return {
      configured: true,
      ...off,
      reachable: !/raggiungibil/i.test(msg),
      verdict: "fail",
      detail:
        failed.length === 1
          ? `${first.name}: ${msg}`
          : `${failed.length} controller su ${on.length} con l'ultima lettura non riuscita (${first.name}: ${msg})`,
      repair: CERT_RE.test(msg) ? "check_unifi_cert" : "reconfigure_unifi",
    };
  }
  const never = on.filter((c) => c.lastOk === null);
  if (never.length > 0) {
    return {
      configured: true,
      ...off,
      verdict: "degraded",
      detail: `${never.map((c) => c.name).join(", ")}: mai letto. «Sincronizza ora» nella pagina Controller di rete`,
      repair: "reconfigure_unifi",
    };
  }
  const devices = on.reduce((n, c) => n + (c.lastDevices ?? 0), 0);
  return {
    configured: true,
    reachable: true,
    authOk: true,
    verdict: "ok",
    detail: `${on.length === 1 ? "1 controller" : `${on.length} controller`}, ${devices} apparati all'ultima lettura`,
    repair: null,
    lastSyncAt,
  };
}

/** Salute dei controller del tenant del contesto. Non lancia per un guasto di lettura del DB: lo dice. */
export function readUnifiHealth(): UnifiHealthReading {
  try {
    return composeControllersHealth(listControllerViews());
  } catch (e) {
    return {
      configured: true,
      reachable: false,
      authOk: false,
      verdict: "fail",
      detail: `Controller non leggibili dal database: ${e instanceof Error ? e.message : String(e)}`,
      repair: null,
      lastSyncAt: null,
    };
  }
}
