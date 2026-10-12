/**
 * Migrazione all'avvio dei segreti delle installazioni gestite (SEC-13).
 *
 * Le installazioni fatte prima di T3-27 hanno i segreti nei container ma non
 * nell'hub. Se un'installazione esiste e il segreto cifrato manca, si legge il
 * valore storico da dove sta davvero — l'ambiente del container, con
 * `docker inspect` — e lo si salva cifrato; da lì in poi il codice lo legge
 * dall'hub. Niente valori di ripiego scritti nel sorgente: se il container non
 * risponde o la variabile manca, l'esito è «non recuperabile» e si dice.
 *
 * Sola lettura sui container. Scrive solo le chiavi dei segreti nell'hub, e
 * solo quando mancano: rieseguita, non cambia niente.
 */
import { dockerReale, type DockerIniettabile } from "./docker";
import {
  getIntegrationConfig,
  leggiSegretiGraylog,
  leggiSegretiLibreNMS,
  salvaSegretiGraylog,
  salvaSegretiLibreNMS,
} from "./config";
import type { ComponentConfig } from "./types";
import type { SegretiGraylog, SegretiLibreNMS } from "./segreti-installazione";

export type EsitoMigrazioneSegreti =
  | "non_gestita"
  | "gia_presenti"
  | "migrati"
  | "non_recuperabili";

export interface RisultatoMigrazioneSegreti {
  componente: "librenms" | "graylog";
  esito: EsitoMigrazioneSegreti;
  /** Solo nomi di container e di variabili, mai valori. */
  motivo?: string;
}

export interface DipendenzeMigrazioneSegreti {
  docker: DockerIniettabile;
  leggiConfig: (c: "librenms" | "graylog") => ComponentConfig;
  leggiSegretiLibreNMS: () => SegretiLibreNMS | null;
  salvaSegretiLibreNMS: (s: SegretiLibreNMS) => void;
  leggiSegretiGraylog: () => SegretiGraylog | null;
  salvaSegretiGraylog: (s: SegretiGraylog) => void;
}

export const dipendenzeMigrazioneReali: DipendenzeMigrazioneSegreti = {
  docker: dockerReale,
  leggiConfig: getIntegrationConfig,
  leggiSegretiLibreNMS,
  salvaSegretiLibreNMS,
  leggiSegretiGraylog,
  salvaSegretiGraylog,
};

/**
 * Ambiente di un container come mappa NOME → valore, o un errore descritto
 * senza valori. `docker inspect` restituisce `Config.Env` come elenco di
 * stringhe `NOME=valore`.
 */
async function ambienteContainer(
  docker: DockerIniettabile,
  nome: string,
): Promise<{ ok: true; env: Map<string, string> } | { ok: false; motivo: string }> {
  let stdout: string;
  try {
    ({ stdout } = await docker.exec(["inspect", "--format", "{{json .Config.Env}}", nome], { timeout: 15_000 }));
  } catch {
    return { ok: false, motivo: `container ${nome} non leggibile con docker inspect` };
  }
  let righe: unknown;
  try {
    righe = JSON.parse(stdout.trim());
  } catch {
    return { ok: false, motivo: `ambiente del container ${nome} in un formato inatteso` };
  }
  if (!Array.isArray(righe)) return { ok: false, motivo: `ambiente del container ${nome} in un formato inatteso` };
  const env = new Map<string, string>();
  for (const r of righe) {
    if (typeof r !== "string") continue;
    const i = r.indexOf("=");
    if (i > 0) env.set(r.slice(0, i), r.slice(i + 1));
  }
  return { ok: true, env };
}

async function migraLibreNMS(d: DipendenzeMigrazioneSegreti): Promise<RisultatoMigrazioneSegreti> {
  const componente = "librenms" as const;
  const cfg = d.leggiConfig(componente);
  if (cfg.mode !== "managed") return { componente, esito: "non_gestita" };
  if (d.leggiSegretiLibreNMS()) return { componente, esito: "gia_presenti" };
  const nome = cfg.containerName || "da-librenms";

  const db = await ambienteContainer(d.docker, `${nome}-db`);
  if (!db.ok) return { componente, esito: "non_recuperabili", motivo: db.motivo };
  const web = await ambienteContainer(d.docker, nome);
  if (!web.ok) return { componente, esito: "non_recuperabili", motivo: web.motivo };

  const dbPassword = db.env.get("MYSQL_PASSWORD") ?? "";
  const dbRootPassword = db.env.get("MYSQL_ROOT_PASSWORD") ?? "";
  const appKey = web.env.get("APP_KEY") ?? "";
  if (!dbPassword) {
    return { componente, esito: "non_recuperabili", motivo: `MYSQL_PASSWORD assente nel container ${nome}-db` };
  }
  d.salvaSegretiLibreNMS({ dbPassword, dbRootPassword, appKey });
  return { componente, esito: "migrati" };
}

async function migraGraylog(d: DipendenzeMigrazioneSegreti): Promise<RisultatoMigrazioneSegreti> {
  const componente = "graylog" as const;
  const cfg = d.leggiConfig(componente);
  if (cfg.mode !== "managed") return { componente, esito: "non_gestita" };
  if (d.leggiSegretiGraylog()) return { componente, esito: "gia_presenti" };
  const nome = cfg.containerName || "da-graylog";

  const web = await ambienteContainer(d.docker, nome);
  if (!web.ok) return { componente, esito: "non_recuperabili", motivo: web.motivo };
  const passwordSecret = web.env.get("GRAYLOG_PASSWORD_SECRET") ?? "";
  if (!passwordSecret) {
    return { componente, esito: "non_recuperabili", motivo: `GRAYLOG_PASSWORD_SECRET assente nel container ${nome}` };
  }
  d.salvaSegretiGraylog({ passwordSecret });
  return { componente, esito: "migrati" };
}

/** Migra LibreNMS e Graylog; un errore su uno non ferma l'altro. */
export async function migraSegretiInstallazioni(
  d: DipendenzeMigrazioneSegreti = dipendenzeMigrazioneReali,
): Promise<RisultatoMigrazioneSegreti[]> {
  const out: RisultatoMigrazioneSegreti[] = [];
  for (const [componente, passo] of [["librenms", migraLibreNMS], ["graylog", migraGraylog]] as const) {
    try {
      out.push(await passo(d));
    } catch (e) {
      out.push({
        componente,
        esito: "non_recuperabili",
        motivo: e instanceof Error ? e.name : "errore sconosciuto",
      });
    }
  }
  return out;
}

/** Passo d'avvio (server.ts): una riga per ciò che cambia o che non torna. */
export async function migraSegretiInstallazioniAllAvvio(): Promise<void> {
  const risultati = await migraSegretiInstallazioni();
  for (const r of risultati) {
    if (r.esito === "migrati") {
      console.info(`[segreti-installazione] ${r.componente}: segreti dell'installazione esistente salvati cifrati nell'hub.`);
    } else if (r.esito === "non_recuperabili") {
      console.warn(`[segreti-installazione] ${r.componente}: segreti non recuperati (${r.motivo ?? "motivo ignoto"}); i comandi sul database restano bloccati finché non si reinstalla o si ripete l'avvio.`);
    }
  }
}
