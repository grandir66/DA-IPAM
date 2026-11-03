/**
 * I fatti dell'istanza che entrano nel segnale verso DA-Link (tappa C1, spec §5.2).
 *
 * - versione: quella di `package.json`, come `/api/version`;
 * - moduli accesi: dal registro dei moduli (`enabled`);
 * - salute: dei soli moduli accesi più il sistema, e SOLO i verdetti (`ok` | `degraded` | `fail`) delle sonde dei moduli, mai il
 *   testo di dettaglio, che può contenere indirizzi e nomi della rete del cliente. Le sonde
 *   dicono anche `off` (spento) e `unverified` (locale, non verificato): DA-Link non li
 *   conosce, e `verdettoPerDaLink` li riporta al suo vocabolario (passo 4, 16/10). In
 *   più tre voci dell'istanza: `cliente`, `firewall_wt0`, `interfaccia_wt0`, e `zbx` per il
 *   proxy Zabbix della macchina, che non è un modulo del registro (`ok` se gira, `fail` se è
 *   installato e fermo, nessuna voce se non c'è, `non_so` se non si legge);
 * - porte su `wt0`: dal sistema vivo (`porte-wt0.ts`);
 * - stato dell'aggiornamento automatico (passo 1d, 16/10): da `data/aggiornamento.json`
 *   col ramo seguito; solo commit, esito, fase, tentativi e date, mai messaggi o avvisi;
 * - stato dichiarato dalla sonda locale (sonde integrate, 20/10): `/api/v1/health` della
 *   sonda del cliente (`edge-sonda.ts`), solo se il modulo edge è configurato; la lettura
 *   parte insieme alle sonde dei moduli e ha un timeout suo, breve;
 * - numeri dell'inventario (solo se il livello lo consente: li chiede il costruttore):
 *   righe di `hosts` e `networks`, ultima riga di `scan_history`.
 *
 * Il cliente è quello del codice scritto da DA-Link. Se l'istanza non ha un cliente con
 * quel codice (rischio 8 della spec) non si chiede niente al suo database: aprirlo
 * creerebbe un file per un cliente che l'hub non conosce.
 *
 * `db-tenant` si importa solo staticamente (regola 14 di DA-IPAM, ADR 0002).
 */
import fs from "node:fs";
import type { Database } from "better-sqlite3";
import { getTenantByCode, getTenants } from "@/lib/db-hub";
import { getTenantDb, withTenant } from "@/lib/db-tenant";
import { resolveModules } from "@/lib/modules/registry";
import { getModulesHealth, type ModuleHealthVerdict, type ModuleVerdict } from "@/lib/modules/health";
import { leggiStatoAggiornamento } from "@/lib/aggiornamento-servizio";
import { getConfiguredUpdateBranch } from "@/lib/update-branch";
import { leggiPorteWt0, type PorteWt0 } from "./porte-wt0";
import { leggiReteAppliance, type ReteAppliance } from "./rete-appliance";
import { aggiornamentoPerSegnale, type AggiornamentoSegnale, type FattiIstanza, type Inventario } from "./segnale";
import { statiComponentiBase, type StatiComponenti } from "./stati-componenti";
import { leggiEdgeSonda } from "./edge-sonda";
import type { LetturaEdge } from "./edge-segnale";
import { unisci } from "../percorsi";

/** Il proxy Zabbix lo installa la procedura guidata di DA-Zabbix, sulla macchina. */
export const FILE_PROXY_ZABBIX = "/etc/zabbix/zabbix_proxy.conf";

/** `ok` se un processo `zabbix_proxy` gira, `fail` se è installato e fermo, null se non c'è. */
export function saluteProxyZabbix(): "ok" | "fail" | null {
  if (!fs.existsSync(FILE_PROXY_ZABBIX)) return null;
  for (const pid of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      if (fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim().startsWith("zabbix_proxy")) return "ok";
    } catch {
      // processo finito nel frattempo
    }
  }
  return "fail";
}

/**
 * Il cliente che Deploy-Appliance crea su ogni appliance, e che IPAM dà per scontato in
 * modalità a cliente singolo. Se il codice di DA-Link non c'è e l'istanza ha solo lui,
 * il cliente di DA-Link è lui (decisione di Riccardo del 15/10, pilota PX-NAS: prima il
 * segnale partiva vuoto con `cliente: non_trovato`). Il segnale lo dichiara: `appliance`.
 */
export const CLIENTE_APPLIANCE = "DEFAULT";

/** La sonda della macchina (disco, Docker): conta anche se non è un «modulo acceso». */
export const MODULO_SISTEMA = "appliance";

export interface DipendenzeFatti {
  clienteEsiste: (codcli: string) => boolean;
  /** L'istanza ha un solo cliente, «DEFAULT», attivo: l'appliance a cliente singolo. */
  unicoClienteAppliance: () => boolean;
  porte: () => Promise<PorteWt0>;
  moduli: (codcli: string) => Promise<Record<string, boolean>>;
  salute: (codcli: string) => Promise<Record<string, ModuleHealthVerdict>>;
  proxyZabbix: () => "ok" | "fail" | null;
  /** Stato dell'aggiornamento automatico (data/aggiornamento.json) col ramo seguito. */
  aggiornamento: () => AggiornamentoSegnale | null;
  /** Stati di IPAM/Edge sulle basi modulari di Deploy-Appliance; null altrove. */
  statiComponenti: () => Promise<StatiComponenti | null>;
  /** `/api/v1/health` della sonda del cliente; null se il modulo edge non è configurato. */
  edge: (tenant: string) => Promise<LetturaEdge | null>;
  /** La rete dell'appliance (29/10); null se non si legge. */
  rete?: () => ReteAppliance | null;
}

let versioneLetta: string | null = null;

export function versioneIstanza(): string {
  if (versioneLetta) return versioneLetta;
  try {
    const pkg = JSON.parse(fs.readFileSync(unisci(process.cwd(), "package.json"), "utf8")) as { version?: unknown };
    versioneLetta = typeof pkg.version === "string" ? pkg.version : "sconosciuta";
  } catch {
    versioneLetta = "sconosciuta";
  }
  return versioneLetta;
}

/**
 * Il verdetto di una sonda nel vocabolario che DA-Link riceve da sempre per un modulo
 * acceso: `ok` | `degraded` | `fail`.
 * - `unverified` (Patch Management: locale, niente da sondare) → `ok`, come prima del
 *   passo 4: per DA-Link il modulo è acceso e l'istanza risponde;
 * - `off` → null, la voce non parte: la sonda dice che il modulo è spento, anche se il
 *   registro lo dava acceso un attimo prima (letture non simultanee).
 */
export function verdettoPerDaLink(v: ModuleHealthVerdict): ModuleVerdict | null {
  if (v === "off") return null;
  if (v === "unverified") return "ok";
  return v;
}

export function saluteFirewall(p: PorteWt0): string {
  if (p.fonte === "firewall") return p.sorgentiRistrette ? "attivo" : "attivo_sorgenti_aperte";
  if (p.fonte === "ascolto") return "assente";
  return "non_so";
}

export const dipendenzeFattiReali: DipendenzeFatti = {
  clienteEsiste: (codcli) => Boolean(getTenantByCode(codcli)),
  unicoClienteAppliance: () => {
    const tutti = getTenants();
    return tutti.length === 1 && tutti[0].codice_cliente === CLIENTE_APPLIANCE && tutti[0].active === 1;
  },
  porte: () => leggiPorteWt0(),
  rete: () => leggiReteAppliance(),
  moduli: async (codcli) => {
    const stati = await withTenant(codcli, () => resolveModules(codcli, "admin"));
    return Object.fromEntries(stati.map((m) => [m.key, m.enabled]));
  },
  salute: async (codcli) => {
    const sonde = await withTenant(codcli, () => getModulesHealth(codcli));
    return Object.fromEntries(sonde.map((h) => [h.key, h.verdict]));
  },
  proxyZabbix: saluteProxyZabbix,
  aggiornamento: () => aggiornamentoPerSegnale(leggiStatoAggiornamento(), getConfiguredUpdateBranch()),
  statiComponenti: () => statiComponentiBase(),
  edge: (tenant) => leggiEdgeSonda(tenant),
};

export async function fattiIstanza(
  codcli: string,
  ultimoErrore: string | null,
  dip: Partial<DipendenzeFatti> = {},
): Promise<{ fatti: FattiIstanza; clienteTrovato: boolean; tenant: string | null }> {
  const d: DipendenzeFatti = { ...dipendenzeFattiReali, ...dip };
  const porte = await d.porte();
  // Il cliente dell'istanza da cui si legge: il codice di DA-Link se c'è, altrimenti
  // l'appliance a cliente singolo. Mai un file nuovo per un codice sconosciuto (rischio 8).
  let tenant: string | null = null;
  let regola = "non_trovato";
  try {
    if (d.clienteEsiste(codcli)) {
      tenant = codcli;
      regola = "trovato";
    } else if (d.unicoClienteAppliance()) {
      tenant = CLIENTE_APPLIANCE;
      regola = "appliance";
    }
  } catch {
    tenant = null;
    regola = "non_trovato";
  }
  const clienteTrovato = tenant !== null;

  // La sonda locale si legge in parallelo al resto (ha il suo timeout): non allunga il giro.
  // Mai per un cliente che l'istanza non ha (rischio 8): niente blocco.
  let edgeInCorso: Promise<LetturaEdge | null> = Promise.resolve(null);
  if (tenant !== null) {
    const t = tenant;
    edgeInCorso = (async () => d.edge(t))().catch(() => null);
  }

  let moduli: Record<string, boolean> = {};
  const salute: Record<string, string> = {};
  if (tenant !== null) {
    try {
      moduli = await d.moduli(tenant);
    } catch {
      moduli = {};
      salute.moduli = "non_so";
    }
    try {
      // Solo i moduli accesi, più il sistema (la macchina): un modulo spento non
      // ha salute (visto a schermo il 15/10: le sonde dei moduli spenti dicevano
      // «fail»; dal passo 4 dicono «off», e comunque non partono).
      const sonde = await d.salute(tenant);
      for (const [k, v] of Object.entries(sonde)) {
        if (moduli[k] !== true && k !== MODULO_SISTEMA) continue;
        const voce = verdettoPerDaLink(v);
        if (voce) salute[k] = voce;
      }
    } catch {
      salute.moduli = "non_so";
    }
  }
  try {
    const zbx = d.proxyZabbix();
    if (zbx) salute.zbx = zbx;
  } catch {
    salute.zbx = "non_so";
  }
  salute.cliente = regola;
  salute.firewall_wt0 = saluteFirewall(porte);
  salute.interfaccia_wt0 = porte.wt0Presente ? "presente" : "assente";

  let aggiornamento: AggiornamentoSegnale | null = null;
  try {
    aggiornamento = d.aggiornamento();
  } catch {
    aggiornamento = null; // un resoconto: non ferma il segnale
  }

  let statiComponenti: StatiComponenti | null = null;
  try {
    statiComponenti = await d.statiComponenti();
  } catch {
    statiComponenti = null; // campo omesso: DA-Link conserva l'ultima fotografia con la sua data
  }

  const edge = await edgeInCorso;

  let rete: ReteAppliance | null = null;
  try {
    rete = d.rete?.() ?? null;
  } catch {
    rete = null; // campo omesso: DA-Link tiene l'ultima rete ricevuta
  }

  return {
    clienteTrovato,
    tenant,
    fatti: { versione: versioneIstanza(), moduli, salute, ultimoErrore, porte: porte.porte, aggiornamento, statiComponenti, edge, rete },
  };
}

export function inventarioDaDb(db: Database): Inventario {
  const conta = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  const ultima = db
    .prepare("SELECT timestamp, status FROM scan_history ORDER BY id DESC LIMIT 1")
    .get() as { timestamp: string | null; status: string | null } | undefined;
  return {
    dispositivi: conta("SELECT COUNT(*) AS n FROM hosts"),
    reti: conta("SELECT COUNT(*) AS n FROM networks"),
    ultima_scansione: ultima?.timestamp ?? null,
    esito_scansione: ultima?.status ?? null,
  };
}

/** Numeri dell'inventario del cliente; null se non si leggono (mai zeri inventati). */
export function inventarioCliente(codcli: string): Inventario | null {
  try {
    return inventarioDaDb(getTenantDb(codcli));
  } catch {
    return null;
  }
}
