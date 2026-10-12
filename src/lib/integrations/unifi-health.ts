/**
 * Sonda di salute del controller UniFi per «Stato moduli» (tappa 2 del piano di
 * miglioramento, Task 7 e correzione 8 del piano UniFi). È il test di
 * connessione (login → stat/device → logout) con tre differenze volute:
 *
 * - **non fissa mai l'impronta del certificato.** La sonda gira per chiunque
 *   apra la dashboard; fidarsi di un certificato è una scelta
 *   dell'amministratore («Prova connessione» nella card, o la sync). Senza
 *   impronta fissata non contatta il controller, così la password non parte
 *   verso un certificato mai visto, e lo dice;
 * - **non logga sul controller a ogni apertura della dashboard**: il
 *   risultato si tiene `MEMO_TTL_MS`, salvo `force` («Verifica») o
 *   configurazione cambiata. Un login al minuto riempirebbe il registro
 *   accessi del controller del cliente;
 * - **ha un tetto di tempo** (`timeoutMs`): la dashboard non aspetta i
 *   timeout del client, pensati per la sync.
 *
 * Credenziali solo dalla configurazione `integration_unifi_*` dell'hub, niente
 * vault (MOD-22). La risposta non porta mai segreti.
 */
import { createHash } from "node:crypto";
import { getIntegrationConfig } from "./config";
import { createUnifiClient, type UnifiClientOptions, type UnifiProbeResult } from "./unifi-api";
import type { ComponentConfig, UnifiCertPinStore, UnifiKind } from "./types";

export type UnifiHealthRepair = "reconfigure_unifi" | "check_unifi_cert" | null;

export interface UnifiHealthReading {
  /** false = integrazione spenta: «Non configurato», non un errore. */
  configured: boolean;
  reachable: boolean;
  authOk: boolean;
  verdict: "ok" | "degraded" | "fail";
  detail: string;
  repair: UnifiHealthRepair;
}

const KIND_LABEL: Record<UnifiKind, string> = {
  self_hosted: "self-hosted",
  udm: "UniFi OS (UDM, Cloud Key)",
  cloud: "cloud (Site Manager)",
};

function elenco(parti: string[]): string {
  if (parti.length <= 1) return parti.join("");
  return `${parti.slice(0, -1).join(", ")} e ${parti[parti.length - 1]}`;
}

/** Cosa manca alla configurazione per leggere il controller; null = completa. */
export function unifiConfigGap(cfg: ComponentConfig): string | null {
  if ((cfg.kind ?? "self_hosted") === "cloud") {
    return cfg.apiToken ? null : "manca la chiave API";
  }
  const manca: string[] = [];
  if (!cfg.url?.trim()) manca.push("l'indirizzo");
  if (!cfg.username?.trim()) manca.push("l'utente");
  if (!cfg.password) manca.push("la password");
  if (manca.length === 0) return null;
  return `${manca.length === 1 ? "manca" : "mancano"} ${elenco(manca)}`;
}

/** Integrazione accesa e con tutto quello che serve per provare a leggere. */
export function isUnifiConfigured(cfg: ComponentConfig): boolean {
  return cfg.mode === "external" && unifiConfigGap(cfg) === null;
}

/** Si contatta il controller solo se acceso, completo, self-hosted e con l'impronta fissata. */
function needsLiveProbe(cfg: ComponentConfig): boolean {
  return isUnifiConfigured(cfg) && (cfg.kind ?? "self_hosted") === "self_hosted" && !!cfg.certPin;
}

/**
 * Verdetto dalla configurazione e, se c'è stato, dal test di connessione.
 * Parte pura: `readUnifiHealth` decide se contattare il controller.
 */
export function composeUnifiHealth(cfg: ComponentConfig, probe: UnifiProbeResult | null): UnifiHealthReading {
  const off = { reachable: false, authOk: false };
  if (cfg.mode !== "external") {
    return { configured: false, ...off, verdict: "fail", detail: "Non configurato", repair: null };
  }
  const kind = cfg.kind ?? "self_hosted";
  if (kind !== "self_hosted") {
    return {
      configured: true,
      ...off,
      verdict: "fail",
      detail: `Controller ${KIND_LABEL[kind]} non ancora supportato: per ora si legge solo il controller self-hosted`,
      repair: "reconfigure_unifi",
    };
  }
  const gap = unifiConfigGap(cfg);
  if (gap) {
    return { configured: true, ...off, verdict: "fail", detail: `Configurazione incompleta: ${gap}`, repair: "reconfigure_unifi" };
  }
  if (!cfg.certPin || !probe) {
    return {
      configured: true,
      ...off,
      verdict: "degraded",
      detail:
        "Collegamento mai provato: «Prova connessione» nella card UniFi fissa il certificato del controller",
      repair: "reconfigure_unifi",
    };
  }
  if (probe.ok) {
    return {
      configured: true,
      reachable: true,
      authOk: true,
      verdict: "ok",
      detail: `${probe.devices} apparati letti dal controller`,
      repair: null,
    };
  }
  return {
    configured: true,
    reachable: probe.reason !== "network",
    authOk: false,
    verdict: "fail",
    detail: probe.message,
    repair: probe.reason === "cert" ? "check_unifi_cert" : "reconfigure_unifi",
  };
}

// ── Lettura dal vivo, con il risultato tenuto ────────────────────────────────

const MEMO_TTL_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;

let memo: { key: string; reading: UnifiHealthReading; expiresAt: number } | null = null;

/** Solo per le prove. */
export function resetUnifiHealthMemo(): void {
  memo = null;
}

/** Impronta della configurazione: un risultato vale solo per quella con cui è stato preso. */
function configKey(cfg: ComponentConfig): string {
  return createHash("sha256")
    .update(JSON.stringify([cfg.mode, cfg.url, cfg.kind, cfg.site, cfg.username, cfg.password, cfg.certPin]))
    .digest("hex");
}

export interface UnifiHealthOptions {
  /** «Verifica»: ignora il risultato tenuto. */
  force?: boolean;
  /** Tetto di tempo dell'intera prova (default 15 s). */
  timeoutMs?: number;
  /** Solo per le prove: trasporto finto. */
  clientOptions?: UnifiClientOptions;
}

/**
 * Salute del controller UniFi. Non lancia per i guasti del controller (finiscono
 * nel verdetto); non scrive niente, nemmeno l'impronta del certificato.
 */
export async function readUnifiHealth(opts: UnifiHealthOptions = {}): Promise<UnifiHealthReading> {
  const cfg = getIntegrationConfig("unifi");
  if (!needsLiveProbe(cfg)) return composeUnifiHealth(cfg, null);

  const key = configKey(cfg);
  const now = Date.now();
  if (!opts.force && memo && memo.key === key && memo.expiresAt > now) return memo.reading;

  // Impronta in sola lettura: c'è (needsLiveProbe), quindi il client non è mai
  // al primo uso; e se qualcuno la cambia a metà prova, qui non si scrive.
  const pinned = cfg.certPin ?? null;
  const readOnlyPins: UnifiCertPinStore = { get: () => pinned, set: () => {}, clear: () => {} };
  const client = createUnifiClient(cfg, readOnlyPins, {
    loginTimeoutMs: 6_000,
    readTimeoutMs: 12_000,
    ...opts.clientOptions,
  });

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<UnifiProbeResult>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          ok: false,
          reason: "network",
          message: `Il controller non ha completato la prova entro ${Math.round(timeoutMs / 1000)} s`,
        }),
      timeoutMs,
    );
  });
  let probe: UnifiProbeResult;
  try {
    probe = await Promise.race([client.probe(), timeout]);
  } finally {
    clearTimeout(timer);
  }

  const reading = composeUnifiHealth(cfg, probe);
  memo = { key, reading, expiresAt: Date.now() + MEMO_TTL_MS };
  return reading;
}
