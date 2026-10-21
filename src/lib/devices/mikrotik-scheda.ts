/**
 * Risorse e hardware MikroTik dalle uscite di `/system resource print` e
 * `/system routerboard print` (scheda MikroTik, task 2). Puro: niente rete, niente DB.
 */
import { parseRouterOsDurationSeconds } from "./router-client";

export interface RisorseMikrotik {
  uptime: string | null;
  uptime_s: number | null;
  versione: string | null;
  build: string | null;
  cpu: string | null;
  cpu_core: number | null;
  cpu_mhz: number | null;
  cpu_carico: number | null;
  memoria_totale_b: number | null;
  memoria_libera_b: number | null;
  disco_totale_b: number | null;
  disco_libero_b: number | null;
  architettura: string | null;
  board: string | null;
  piattaforma: string | null;
}

export interface HardwareMikrotik {
  routerboard: boolean | null;
  modello: string | null;
  seriale: string | null;
  revisione: string | null;
  firmware_tipo: string | null;
  firmware_factory: string | null;
  firmware_corrente: string | null;
  firmware_aggiornabile: string | null;
}

const MOLTIPLICATORE: Record<string, number> = { "": 1, B: 1, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4 };

/** «1024.0MiB», «1.0GiB», «47.0KiB», «4096» → byte; illeggibile → null. */
export function byteRouterOs(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*([KMGT]iB|B)?$/i);
  if (!m) return null;
  const f = MOLTIPLICATORE[(m[2] ?? "").toUpperCase()];
  return f === undefined ? null : Math.round(parseFloat(m[1]) * f);
}

/** `chiave: valore`, una per riga (la prima occorrenza vince). */
function coppie(out: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const riga of out.split(/\r?\n/)) {
    const i = riga.indexOf(":");
    if (i < 0) continue;
    const k = riga.slice(0, i).trim();
    const v = riga.slice(i + 1).trim();
    if (k && v && !m.has(k)) m.set(k, v);
  }
  return m;
}

function intero(s: string | undefined): number | null {
  const m = s?.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

export function parseRisorse(out: string): RisorseMikrotik {
  const c = coppie(out);
  const uptime = c.get("uptime") ?? null;
  const carico = intero(c.get("cpu-load"));
  return {
    uptime,
    uptime_s: parseRouterOsDurationSeconds(uptime),
    versione: c.get("version") ?? null,
    build: c.get("build-time") ?? null,
    cpu: c.get("cpu") ?? null,
    cpu_core: intero(c.get("cpu-count")),
    cpu_mhz: intero(c.get("cpu-frequency")),
    cpu_carico: carico === null ? null : Math.min(100, carico),
    memoria_totale_b: byteRouterOs(c.get("total-memory")),
    memoria_libera_b: byteRouterOs(c.get("free-memory")),
    disco_totale_b: byteRouterOs(c.get("total-hdd-space")),
    disco_libero_b: byteRouterOs(c.get("free-hdd-space")),
    architettura: c.get("architecture-name") ?? null,
    board: c.get("board-name") ?? null,
    piattaforma: c.get("platform") ?? null,
  };
}

export function parseRouterboard(out: string): HardwareMikrotik {
  const c = coppie(out);
  const rb = c.get("routerboard");
  return {
    routerboard: rb === "yes" ? true : rb === "no" ? false : null,
    modello: c.get("model") ?? null,
    seriale: c.get("serial-number") ?? null,
    revisione: c.get("revision") ?? null,
    firmware_tipo: c.get("firmware-type") ?? null,
    firmware_factory: c.get("factory-firmware") ?? null,
    firmware_corrente: c.get("current-firmware") ?? null,
    firmware_aggiornabile: c.get("upgrade-firmware") ?? null,
  };
}
