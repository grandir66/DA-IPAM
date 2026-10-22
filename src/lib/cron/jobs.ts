import {
  getScheduledJobById,
  getNetworks,
  getNetworkById,
  getNetworkDevices,
  getNetworkRouterId,
  getNetworkDeviceById,
  getHostsByNetwork,
  getKnownHosts,
  recordHostHeartbeat,
  getDb,
  getActiveNmapProfile,
  updateHostIfExists,
  upsertArpEntries,
  upsertSwitchPorts,
  resolveMacToDevice,
  resolveMacToNetworkDevice,
  upsertMacIpMapping,
  upsertDhcpLease,
  syncIpAssignmentsForNetwork,
  upsertNeighbors,
  upsertRoutes,
  updateJobLastRun,
} from "@/lib/db";
import { discoverNetwork, type AvvioDiscovery } from "@/lib/scanner/discovery";
import {
  attendiRilascio,
  CHIAVE_SOGLIA_ALLARME,
  isScanInCorso,
  segnalaGiroLungo,
  sogliaAllarmeDa,
  type GiroOccupante,
} from "@/lib/scanner/network-scan-lock";
import { reverseDns, forwardDns } from "@/lib/scanner/dns";
import { pingHost } from "@/lib/scanner/ping";
import { getScanIoOverride } from "@/lib/executor";
import { tcpConnect, FALLBACK_TCP_PORTS } from "@/lib/scanner/tcp-check";
import { createRouterClient, routerOsDurationToIsoTimestamp } from "@/lib/devices/router-client";
import { createSwitchClient, creaWalkSnmp, deviceHasSnmpSession } from "@/lib/devices/switch-client";
import { leggiSnmpTopologia } from "@/lib/devices/snmp-topologia";
import { leggiVlanSwitch } from "@/lib/devices/snmp-vlan";
import { TEMPO_WALK_MS } from "@/lib/devices/snmp-walk";
import { lookupVendor } from "@/lib/scanner/mac-vendor";
import { isIpInCidr, normalizePortNameForMatch } from "@/lib/utils";
import { networkDeviceUsesArpPoll } from "@/lib/network-device-arp";
import {
  checkMacFlip,
  checkNewUnknownHosts,
  checkPortChanges,
  checkUptimeAnomaly,
  checkLatencyAnomaly,
  type HostForAnomaly,
  type ScanHistoryForAnomaly,
  type StatusHistoryEntry,
} from "@/lib/analytics/anomaly";
import {
  insertAnomalyEvent,
  hasOpenAnomaly,
} from "@/lib/analytics/anomaly-db";
import {
  getAllHostsFlat,
  getStatusHistory,
  getHostLatencyHistory,
  getScanHistory,
  getCurrentTenantCode,
  getTenantSetting,
  upsertMacPortEntries,
  cleanupOldMacPortEntries,
  MAC_PORT_RETENTION_DAYS,
  listHypervisorScanDevices,
  scriviFattiTopologia,
  scriviSchedaMikrotikTopologia,
  scriviSchedaMikrotikLettura,
  livelloSchedaMkCorrente,
  scriviVlanSwitch,
  schemaSwitchVlanCorrente,
} from "@/lib/db-tenant";
import { HYPERVISOR_SYNC_MINUTES, unifiJobKind } from "@/lib/scheduled-job-types";
// Statico: run-proxmox-device-scan importa il facade db, che risolve db-tenant (ADR 0002).
import { runProxmoxDeviceScan } from "@/lib/proxmox/run-proxmox-device-scan";
import { codiceErrore, leggiMacPorteRouter } from "@/lib/devices/mikrotik-porte";
import { SshError } from "@/lib/devices/ssh-transport";
import { conLucchettoApparato } from "@/lib/devices/lucchetto-apparato";
import { apriEsecutoreSsh, codiceTrasporto, interpretaUscita, leggiMikrotikScheda, leggiMikrotikTopologia, type ApriEsecutore, type RisultatoMk } from "@/lib/devices/mikrotik-letture";
import { parseBondScheda, parseBridgeScheda, parsePorteBridgeScheda } from "@/lib/devices/mikrotik-scheda";
import { parseInterfacce } from "@/lib/devices/mikrotik-stp";
import { aggiornaInterfacceRouterOs } from "@/lib/devices/physical-device-db";
import { fattiMikrotik } from "@/lib/devices/mikrotik-stp";
import { conCadenza, riassuntoLetture, type EsitoGiro } from "@/lib/topology/letture/cadenza";
import { letturaAccesa, oraUtc, senzaCampiCavi } from "@/lib/topology/letture/interruttori";
import { leggiHost } from "@/lib/proxmox/lldp-host";
// Statico: pulizia-archivio importa db-tenant (ADR 0002).
import { runPuliziaHost } from "@/lib/hosts/pulizia-archivio";
import type { NetworkDevice } from "@/types";
import { syncNetworkToLibreNMS, syncAllNetworksToLibreNMS } from "@/lib/integrations/librenms-sync";
// Import statico (come LibreNMS, non dinamico come Wazuh): unifi-sync importa
// db-tenant, che sotto tsx non va mai caricato con `await import()` (ADR 0002).
import { syncController } from "@/lib/controllers/service";
import { syncUnifiClientsForController } from "@/lib/integrations/unifi-clients-sync";
// Statici per la stessa ragione: mesh-sync e feature importano db-tenant.
import { syncMeshForTenant } from "@/lib/integrations/meshcentral/mesh-sync";
import { meshAttivo } from "@/lib/integrations/meshcentral/feature";

/** Job che lanciano giri di discovery: durano quanto il giro (fino a ~49 minuti misurati). */
export const JOB_DI_SCANSIONE: ReadonlySet<string> = new Set(["ping_sweep", "fast_scan", "snmp_scan", "nmap_scan"]);

export interface OpzioniRunJob {
  /** Chiamata alla partenza di ogni giro di scansione, con il suo id (per «Esegui ora»). */
  onGiroAvviato?: (scanId: string, networkId: number) => void;
  /**
   * Rete occupata da un altro giro: aspetta che si chiuda e parte, invece di
   * saltare (lo scheduler). Senza, il giro è «saltato» subito («Esegui ora»,
   * che non può tenere aperta la richiesta per un giro altrui).
   */
  attendiReteLibera?: boolean;
  /**
   * Quanto si aspetta un giro (il proprio fino al `done`, o quello che tiene la
   * rete) prima di smettere. Predefinito: la soglia d'allarme del tenant
   * (`scan_lock_alarm_minutes`, 100 minuti). Le prove la accorciano.
   */
  attesaMassimaMs?: number;
  /** L'ora con cui il job dei client UniFi guarda la finestra 7-20 (le prove la fissano). */
  adesso?: Date;
}

/** Attesa massima predefinita: la soglia d'allarme del lucchetto, in ms. */
function attesaMassimaPredefinitaMs(): number {
  let valore: string | null = null;
  try {
    valore = getTenantSetting(CHIAVE_SOGLIA_ALLARME);
  } catch {
    valore = null; // impostazione illeggibile: soglia predefinita
  }
  return sogliaAllarmeDa(valore) * 60_000;
}

const SCADUTO = Symbol("scaduto");

/** La promessa, oppure SCADUTO dopo `ms`; il timer si toglie appena la promessa arriva. */
async function entro<T>(p: Promise<T>, ms: number): Promise<T | typeof SCADUTO> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scadenza = new Promise<typeof SCADUTO>((r) => {
    timer = setTimeout(() => r(SCADUTO), Math.max(0, ms));
  });
  try {
    return await Promise.race([p, scadenza]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Esito di un job arrivato in fondo senza errori (T3-18). «saltato»: la rete era
 * già occupata da un altro giro e non si è scansionato niente; chi chiama non
 * aggiorna `last_run` e non lo conta come riuscito.
 */
export type EsitoRunJob =
  | { esito: "eseguito"; motivo?: string }
  | { esito: "saltato"; motivo: string; giroInCorso?: GiroOccupante };

const ESEGUITO: EsitoRunJob = { esito: "eseguito" };

/**
 * Esegue un job e torna quando il lavoro è FINITO (T3-17, INV-1): per i job di
 * scansione vuol dire a giro chiuso, e un giro fallito fa rifiutare `runJob`,
 * così lo scheduler lo conta fra i fallimenti e `last_run` segna la fine.
 * Su una rete già in scansione il giro non parte e l'esito è «saltato» (T3-18).
 */
/** Il controller di un job unifi_sync (`config.controller_id`); null se manca o non è leggibile. */
export function unifiJobControllerId(configStr: string | null | undefined): number | null {
  try {
    const v = (JSON.parse(configStr || "{}") as { controller_id?: unknown }).controller_id;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Che cosa legge un job unifi_sync: sta nel modulo puro dei tipi di job, perché serve anche alla pagina. */
export { unifiJobKind };

/** Spec §10.5: i client si leggono dalle 7 alle 20 (ora italiana): di notte sono spenti. */
export function inFinestraClient(d: Date): boolean {
  const ora = Number(
    new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", hourCycle: "h23" }).format(d),
  );
  return ora >= 7 && ora < 20;
}

/**
 * Il job dei client di UN controller. Fuori dalle 7-20 non chiama il controller:
 * una riga di log e il motivo a chi chiama («Esegui ora» lo mostra), non è un
 * fallimento. Dentro, un giro non riuscito (rete, chiave, certificato: «non
 * so», le righe esistenti restano) lancia, così lo scheduler lo conta fra i
 * falliti come per gli apparati. Torna null se ha letto.
 * `adesso` si passa nelle prove.
 */
export async function runUnifiClientJob(controllerId: number, adesso: Date = new Date()): Promise<string | null> {
  if (!inFinestraClient(adesso)) {
    console.info(`[Scheduler] unifi_sync client #${controllerId}: fuori dalle 7-20, non letto`);
    return "Fuori dalle 7-20 (ora italiana): i client non sono stati letti";
  }
  const result = await syncUnifiClientsForController(controllerId, "schedule");
  if (result.failure) {
    throw new Error(`Lettura dei client UniFi non riuscita (controller #${controllerId}): ${result.failure}`);
  }
  // Solo i numeri: MAC, nomi e IP dei client non vanno nel log.
  console.info(
    `[Scheduler] unifi_sync client #${controllerId}: ${result.clients} letti, ${result.saved} salvati, ` +
      `${result.unmatched} non abbinati`,
  );
  return null;
}

export { HYPERVISOR_SYNC_MINUTES };

/** Resoconto del job hypervisor_sync. `errori`: uno per apparato non letto (per chi guarda, mai nel log). */
export interface EsitoHypervisorSync {
  hypervisors: number;
  letti: number;
  falliti: number;
  errori: string[];
  /** Le letture in più dell'host (T2.5): una riga di soli numeri e codici; null = spente o niente da dire. */
  letture: string | null;
}

/** Il motivo nel resoconto del job: gli hypervisor non letti e, in coda, le letture in più (T2.5). null = niente da dire. */
export function motivoHypervisorSync(r: EsitoHypervisorSync): string | null {
  const parti = [r.falliti > 0 ? `${r.falliti} hypervisor su ${r.hypervisors} non letti: resta la lettura di prima` : null, r.letture];
  const s = parti.filter((x): x is string => !!x).join("; ");
  return s === "" ? null : s;
}

/**
 * Lettura degli hypervisor del tenant (topologia fase 2b, spec §11.5): la
 * scansione Proxmox esistente più le schede vive, per ogni apparato hypervisor
 * con scansione Proxmox configurato e acceso, uno alla volta. Un apparato che
 * non si legge non ferma gli altri e non scrive niente (la scansione tiene
 * quella di prima, Review Focus 4). Nel log solo numeri e id: niente nomi,
 * indirizzi o MAC. `scan` e `host` si passano nelle prove.
 *
 * T2 (spec topologia §13.5.5, T2.5): dopo una scansione riuscita, la lettura dal lato dell'host (`leggiHost`: lldpcli e
 * membri dei bond, in comandi a parte, I54), dietro `topologia.lettura.host`, spenta di default. Un suo errore va nel
 * resoconto (`letture`, solo numeri e codici) e non tocca la scansione né il conto degli apparati letti.
 */
export async function runHypervisorSync(
  scan: (deviceId: number) => Promise<unknown> = (id) => runProxmoxDeviceScan(id),
  host: (deviceId: number) => Promise<Array<EsitoGiro<unknown>>> = (id) => leggiHost(id),
): Promise<EsitoHypervisorSync> {
  const devices = listHypervisorScanDevices();
  const esito: EsitoHypervisorSync = { hypervisors: devices.length, letti: 0, falliti: 0, errori: [], letture: null };
  const conHost = letturaAccesa("host");
  const esitiHost: Array<EsitoGiro<unknown>> = [];
  for (const d of devices) {
    let letto = false;
    try {
      await scan(d.id);
      esito.letti++;
      letto = true;
    } catch (e) {
      esito.falliti++;
      esito.errori.push(`Apparato #${d.id}: ${e instanceof Error ? e.message : String(e)}`);
      console.warn(`[Scheduler] hypervisor_sync: apparato #${d.id} non letto, resta la lettura di prima`);
    }
    if (!letto || !conHost) continue;
    try {
      esitiHost.push(...await host(d.id));
    } catch (e) {
      // Un errore fuori dalla cadenza (che gli errori della lettura li tiene già): il solo codice, mai il messaggio.
      const codice = codiceErrore(e);
      esitiHost.push({ stato: "errore", esito: { il: oraUtc(new Date()), comandi: 0, riusciti: 0, codice } });
      console.warn(`[Scheduler] hypervisor_sync: apparato #${d.id}, lettura dell'host non riuscita (${codice})`);
    }
  }
  esito.letture = riassuntoLetture(esitiHost);
  return esito;
}

export async function runJob(jobId: number, opzioni?: OpzioniRunJob): Promise<EsitoRunJob> {
  // v0.2.642 audit perf MC3: SELECT WHERE id invece di full-scan + .find().
  const job = getScheduledJobById(jobId);
  if (!job) throw new Error(`Job #${jobId} non trovato`);

  switch (job.job_type) {
    case "ping_sweep":
      return runPingSweep(job.network_id, opzioni);
    case "fast_scan":
      return runFastScan(job.network_id, opzioni);
    case "snmp_scan":
      return runSnmpScan(job.network_id, opzioni);
    case "nmap_scan":
      return runNmapScan(job.network_id, opzioni);
    case "arp_poll":
      await runArpPoll();
      break;
    case "dns_resolve":
      await runDnsResolve(job.network_id);
      break;
    case "known_host_check":
      await runKnownHostCheck(job.network_id);
      break;
    case "cleanup":
      await runCleanup(job.config);
      break;
    case "ad_sync":
      await runAdSync(job.config);
      break;
    case "anomaly_check":
      await runAnomalyCheck(job.network_id);
      break;
    case "librenms_sync":
      if (job.network_id) {
        await syncNetworkToLibreNMS(job.network_id);
      } else {
        await syncAllNetworksToLibreNMS();
      }
      break;
    case "vuln_sync": {
      const { runVulnSync } = await import("@/lib/vuln/sync-job");
      await runVulnSync();
      break;
    }
    case "wazuh_sync": {
      const { syncWazuhForTenant } = await import("@/lib/integrations/wazuh-sync");
      const result = await syncWazuhForTenant();
      console.info(
        `[Scheduler] wazuh_sync: ${result.matchedHosts}/${result.totalAgents} agent matchati, ` +
        `${result.softwareRows} sw, ${result.vulnRows} cve, ${result.errors.length} errori, ` +
        `durata ${result.durationMs}ms`
      );
      break;
    }
    case "wazuh_alerts_sync": {
      const { syncWazuhAlertsForTenant } = await import(
        "@/lib/integrations/wazuh-alerts-sync"
      );
      const result = await syncWazuhAlertsForTenant();
      console.info(
        result.skipped
          ? `[Scheduler] wazuh_alerts_sync: saltato (${result.reason})`
          : `[Scheduler] wazuh_alerts_sync: ${result.fetched} alert letti, ` +
            `${result.opened} eventi aperti, ${result.updated} aggiornati, ` +
            `${result.ignored} fuori selezione, ` +
            `notifiche ${result.notifiedImmediate} immediate / ${result.notifiedDigest} in digest`
      );
      break;
    }
    case "mdm_sync": {
      const { runMdmSync } = await import("@/lib/integrations/mdm-runner");
      const result = await runMdmSync();
      console.info(
        `[Scheduler] mdm_sync: ${result.devices} device, ${result.changed} cambi` +
        (result.error ? `, errore: ${result.error}` : "")
      );
      break;
    }
    case "meshcentral_sync": {
      // SEC-18: a modulo disinstallato il job resta in tabella ma non gira.
      // Non è un guasto: niente eccezione, così non si accumulano avvisi.
      if (!meshAttivo()) {
        console.info("[Scheduler] meshcentral_sync saltato: modulo MeshCentral disattivato");
        break;
      }
      const result = await syncMeshForTenant();
      console.info(
        `[Scheduler] meshcentral_sync: ${result.matched}/${result.totalNodes} nodi matchati, ` +
        `${result.unmatched} unmatched`
      );
      break;
    }
    case "unifi_sync": {
      // Pianificazione di UN controller (ADR 0007): la crea la pagina Controller
      // di rete, con config.controller_id. Un job senza controller (nato prima)
      // non legge niente: lo si dice, invece di indovinare quale.
      const controllerId = unifiJobControllerId(job.config);
      if (controllerId === null) {
        throw new Error("Job unifi_sync senza controller: la pianificazione si imposta dalla pagina Controller di rete");
      }
      if (unifiJobKind(job.config) === "client") {
        const nonLetto = await runUnifiClientJob(controllerId, opzioni?.adesso);
        if (nonLetto) return { esito: "eseguito", motivo: nonLetto };
        break;
      }
      const result = await syncController(controllerId, "schedule", null);
      // Niente letto o niente scritto: si lancia, così lo scheduler lo conta
      // fra i job falliti invece di dirlo completato.
      if (result.failure) throw new Error(`Sync UniFi non riuscita (controller #${controllerId}): ${result.failure}`);
      console.info(
        `[Scheduler] unifi_sync #${controllerId}: ${result.total} apparati dal controller, ${result.added} nuovi, ` +
        `${result.updated} aggiornati, ${result.skipped} saltati, ${result.portsUpserted} porte, ` +
        `${result.neighborsUpserted} vicini, ${result.errors.length} avvisi`
      );
      // Gli avvisi per apparato (nomi e IP) non vanno nel log: si leggono nel
      // resoconto della sync manuale.
      break;
    }
    case "hypervisor_sync": {
      const r = await runHypervisorSync();
      if (r.hypervisors === 0) {
        return { esito: "eseguito", motivo: "Nessun hypervisor con scansione Proxmox configurata: niente da leggere" };
      }
      // Nessuno letto: si lancia, così lo scheduler lo conta fra i falliti. Il
      // motivo per apparato (con gli indirizzi) resta fuori dal messaggio e dal log.
      if (r.letti === 0) {
        throw new Error(`Lettura degli hypervisor non riuscita: 0 letti su ${r.hypervisors}`);
      }
      console.info(`[Scheduler] hypervisor_sync: ${r.letti} hypervisor letti su ${r.hypervisors}${r.letture ? `; ${r.letture}` : ""}`);
      const motivo = motivoHypervisorSync(r);
      if (motivo) return { esito: "eseguito", motivo };
      break;
    }
    case "pulizia_host": {
      // Pulizia notturna degli host assenti (piano 2026-10-20, Task 5). Un guasto lancia (fra i falliti, niente
      // last_run); il resoconto è di soli numeri, i nomi stanno nel registro JSONL della pulizia.
      const r = runPuliziaHost();
      const dettagli = [
        r.nonPiuArchiviabili ? `${r.nonPiuArchiviabili} non più archiviabili` : "",
        r.rinviati ? `${r.rinviati} rinviati perché la loro rete era in scansione` : "",
      ].filter(Boolean);
      return {
        esito: "eseguito",
        motivo: `${r.archiviati} host archiviati, ${r.cancellatiDallArchivio} cancellati dall'archivio${dettagli.length ? `; ${dettagli.join(", ")}` : ""}`,
      };
    }
  }
  return ESEGUITO;
}

/**
 * «Esegui ora» dalla UI. Un job di scansione non si aspetta: la richiesta HTTP
 * resterebbe aperta per tutto il giro (fino a ~49 minuti). Si risponde appena
 * parte il primo giro, con il suo id; `last_run` si scrive a giro finito, come
 * fa lo scheduler. Gli altri job si aspettano come prima.
 */
export type EsitoEseguiOra =
  | { modo: "avviato"; scanId: string }
  /** `motivo`: il job è finito senza fare tutto (es. client UniFi fuori dalle 7-20): la pagina lo mostra. */
  | { modo: "eseguito"; durationMs: number; motivo?: string }
  /** Rete già in scansione (T3-18): niente giro, niente `last_run`. */
  | { modo: "saltato"; motivo: string; giroInCorso?: GiroOccupante };

export async function eseguiJobOra(jobId: number, opzioni?: Pick<OpzioniRunJob, "adesso">): Promise<EsitoEseguiOra> {
  const job = getScheduledJobById(jobId);
  if (!job) throw new Error(`Job #${jobId} non trovato`);
  const inizio = Date.now();

  if (!JOB_DI_SCANSIONE.has(job.job_type)) {
    const e = await runJob(jobId, opzioni);
    updateJobLastRun(jobId);
    return { modo: "eseguito", durationMs: Date.now() - inizio, ...(e.motivo ? { motivo: e.motivo } : {}) };
  }

  return new Promise<EsitoEseguiOra>((resolve, reject) => {
    let risposto = false;
    runJob(jobId, {
      onGiroAvviato: (scanId) => {
        if (risposto) return;
        risposto = true;
        resolve({ modo: "avviato", scanId });
      },
    }).then(
      (esito) => {
        if (esito.esito === "saltato") {
          // Nessun giro partito: la rete era già occupata. last_run resta com'era.
          if (!risposto) {
            risposto = true;
            resolve({ modo: "saltato", motivo: esito.motivo, giroInCorso: esito.giroInCorso });
          }
          return;
        }
        updateJobLastRun(jobId);
        if (!risposto) {
          // Nessun giro partito (nessuna rete): il job è già finito.
          risposto = true;
          resolve({ modo: "eseguito", durationMs: Date.now() - inizio });
        }
      },
      (error: unknown) => {
        if (!risposto) {
          risposto = true;
          reject(error);
          return;
        }
        // La risposta è già partita: il fallimento resta nel log, come per lo scheduler.
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[Jobs] Esecuzione manuale del job #${jobId} fallita a giro avviato: ${msg}`);
      },
    );
  });
}

/**
 * Un giro su una rete, atteso fino alla fine vera; se fallisce, lancia.
 *
 * Rete già in scansione: senza `attendi` il giro non parte ed è «saltato» col
 * giro che la tiene; con `attendi` (scheduler) si aspetta che quel giro si
 * chiuda e si riparte, fino all'attesa massima, poi «saltato».
 *
 * Il proprio giro si aspetta fino all'attesa massima (revisione 3b): oltre, il
 * job smette di aspettare, scrive la riga d'allarme e fallisce, ma il giro NON
 * si chiude e la rete resta occupata finché non finisce davvero (ADR 0006).
 * Senza questo limite un giro appeso teneva il job per sempre, in silenzio, e
 * su un job a rete nulla fermava anche tutte le reti successive.
 */
async function giroCompleto(
  networkId: number,
  avvia: () => Promise<AvvioDiscovery>,
  opzioni: OpzioniRunJob | undefined,
  attendi: boolean,
): Promise<EsitoRunJob> {
  const tenantCode = getCurrentTenantCode();
  const attesaMs = opzioni?.attesaMassimaMs ?? attesaMassimaPredefinitaMs();
  const sogliaAllarmeMinuti = attesaMs / 60_000;
  const scadenza = Date.now() + attesaMs;

  let avviato: AvvioDiscovery;
  for (;;) {
    try {
      avviato = await avvia();
      break;
    } catch (e) {
      if (!isScanInCorso(e)) throw e;
      const saltato: EsitoRunJob = {
        esito: "saltato",
        motivo: `rete ${networkId} già in scansione`,
        giroInCorso: e.giro,
      };
      if (!attendi || !tenantCode) {
        console.info(
          `[Jobs] Rete ${networkId} già in scansione (giro ${e.giro.scanId}, ${e.giro.scanType}): giro saltato`,
        );
        return saltato;
      }
      const resto = scadenza - Date.now();
      const rilascio = attendiRilascio(tenantCode, networkId);
      if (resto <= 0 || (rilascio && (await entro(rilascio, resto)) === SCADUTO)) {
        segnalaGiroLungo(tenantCode, networkId, e.giro.scanId, { sogliaAllarmeMinuti });
        console.warn(
          `[Jobs] Rete ${networkId} ancora occupata dal giro ${e.giro.scanId} (${e.giro.scanType}) ` +
            "oltre l'attesa massima: giro saltato",
        );
        return { ...saltato, motivo: `rete ${networkId} occupata oltre l'attesa massima` };
      }
      // Rete rilasciata: si riprova subito, prima di chi arriva dopo.
    }
  }

  const { id, done } = avviato;
  opzioni?.onGiroAvviato?.(id, networkId);
  const esito = await entro(done, attesaMs);
  if (esito === SCADUTO) {
    if (tenantCode) segnalaGiroLungo(tenantCode, networkId, id, { sogliaAllarmeMinuti });
    // Il giro va avanti per conto suo: la sua chiusura non la aspetta più nessuno.
    done.catch(() => undefined);
    throw new Error(
      `Scansione ${id} della rete ${networkId} non chiusa dopo ${Math.round(attesaMs / 60_000)} minuti: ` +
        "il job smette di aspettarla, la rete resta occupata finché il giro non si chiude",
    );
  }
  if (esito.status === "failed") {
    throw new Error(`Scansione ${id} della rete ${networkId} fallita: ${esito.error ?? "errore sconosciuto"}`);
  }
  return ESEGUITO;
}

/** Un giro per rete: `attendi` dice se aspettare una rete occupata (vedi `giroCompleto`). */
type GiroSuRete = (nid: number, attendi: boolean) => Promise<EsitoRunJob>;

/**
 * Rete indicata: un giro. Rete nulla: tutte le reti, una dopo l'altra (prima
 * partivano tutte insieme); una rete che fallisce, o il cui giro non si chiude
 * entro l'attesa massima, non ferma le altre e il job fallisce alla fine con
 * l'elenco degli errori. Una rete già in scansione si rimanda in coda: con
 * `attendiReteLibera` la si riprende aspettando che si liberi, senza si salta
 * (T3-18). Il job è «saltato» solo se le ha saltate tutte.
 */
async function suOgniRete(
  networkId: number | null,
  opzioni: OpzioniRunJob | undefined,
  giro: GiroSuRete,
): Promise<EsitoRunJob> {
  const attendi = opzioni?.attendiReteLibera === true;
  if (networkId) return giro(networkId, attendi);

  const networks = getNetworks();
  const errori: string[] = [];
  const saltate: Array<Extract<EsitoRunJob, { esito: "saltato" }>> = [];
  const rimandate: number[] = [];
  const esegui = async (nid: number, attendiQui: boolean, rimandaSeOccupata: boolean): Promise<void> => {
    try {
      const esito = await giro(nid, attendiQui);
      if (esito.esito !== "saltato") return;
      if (rimandaSeOccupata) rimandate.push(nid);
      else saltate.push(esito);
    } catch (e) {
      errori.push(e instanceof Error ? e.message : String(e));
    }
  };
  // Prima le reti libere, senza aspettare nessuno; poi, se richiesto, le occupate.
  for (const net of networks) await esegui(net.id, false, attendi);
  for (const nid of rimandate) await esegui(nid, true, false);

  if (errori.length > 0) {
    throw new Error(`${errori.length} reti su ${networks.length} non scansionate: ${errori.join(" · ")}`);
  }
  if (saltate.length === 0) return ESEGUITO;
  const motivo = `${saltate.length} ${saltate.length === 1 ? "rete" : "reti"} su ${networks.length} ${
    saltate.length === 1 ? "saltata" : "saltate"
  }: già in scansione`;
  if (saltate.length === networks.length) {
    return { esito: "saltato", motivo, giroInCorso: saltate[0].giroInCorso };
  }
  return { esito: "eseguito", motivo };
}

async function runPingSweep(networkId: number | null, opzioni?: OpzioniRunJob): Promise<EsitoRunJob> {
  return suOgniRete(networkId, opzioni, (nid, attendi) =>
    giroCompleto(nid, () => discoverNetwork(nid, "network_discovery"), opzioni, attendi),
  );
}

async function runFastScan(networkId: number | null, opzioni?: OpzioniRunJob): Promise<EsitoRunJob> {
  // Scansione veloce schedulata: nmap -sn (ripiego ping sweep) + secondo passaggio TCP
  // sugli host già online + ARP/DHCP router (vedi discovery.ts blocco "fast"). Niente
  // port scan. A fine giro MANDA offline i non rispondenti, come network_discovery,
  // passando dal filtro sulla partenza del giro e dalla soglia: se debba farlo è una
  // decisione aperta (ADR 0006), fino ad allora il codice resta così.
  return suOgniRete(networkId, opzioni, (nid, attendi) =>
    giroCompleto(nid, () => discoverNetwork(nid, "fast"), opzioni, attendi),
  );
}

async function runSnmpScan(networkId: number | null, opzioni?: OpzioniRunJob): Promise<EsitoRunJob> {
  return suOgniRete(networkId, opzioni, async (nid, attendi) => {
    const network = getNetworkById(nid);
    if (!network) return ESEGUITO;
    const snmpCommunity = network.snmp_community ?? null;
    return giroCompleto(nid, () => discoverNetwork(nid, "snmp", undefined, snmpCommunity), opzioni, attendi);
  });
}

async function runNmapScan(networkId: number | null, opzioni?: OpzioniRunJob): Promise<EsitoRunJob> {
  const { buildCustomScanArgs } = await import("@/lib/scanner/ports");
  const profile = getActiveNmapProfile();
  const runForNetwork = async (nid: number, attendi: boolean): Promise<EsitoRunJob> => {
    const network = getNetworkById(nid);
    if (!network) return ESEGUITO;
    let nmapArgs: string | undefined;
    let tcpPorts: string | null = null;
    let udpPorts: string | null = null;
    if (profile) {
      tcpPorts = profile.tcp_ports ?? null;
      udpPorts = profile.udp_ports ?? null;
      if (!tcpPorts) {
        nmapArgs =
          profile.custom_ports !== null && profile.custom_ports !== undefined
            ? buildCustomScanArgs(profile.custom_ports)
            : profile.args || buildCustomScanArgs(null);
      }
    } else {
      nmapArgs = buildCustomScanArgs(null);
    }
    const snmpCommunity = profile?.snmp_community || network.snmp_community || null;
    return giroCompleto(
      nid,
      () => discoverNetwork(nid, "nmap", nmapArgs, snmpCommunity, { tcpPorts, udpPorts }),
      opzioni,
      attendi,
    );
  };
  return suOgniRete(networkId, opzioni, runForNetwork);
}

/**
 * Salva i MAC per porta di un apparato (spec §10.5) senza fermare il resto del
 * giro (revisione finale I1): nel ramo SNMP vicini e routing vengono dopo, e una
 * scrittura che lancia (indice unico mancante perché la migrazione di fase 2 è
 * fallita all'apertura del tenant, una riga storta) li saltava tutti e due fino
 * al riavvio. Una riga di log col solo id dell'apparato e il codice d'errore:
 * niente MAC, nomi o IP. `scrivi` si passa nelle prove.
 */
export function salvaMacPorta(
  deviceId: number,
  entries: Parameters<typeof upsertMacPortEntries>[1],
  scrivi: typeof upsertMacPortEntries = upsertMacPortEntries,
): boolean {
  try {
    scrivi(deviceId, entries, "device");
    return true;
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    console.warn(`[MacPorta] apparato #${deviceId}: MAC per porta non salvati (${typeof code === "string" ? code : "errore"})`);
    return false;
  }
}

/**
 * Bridge, porte e bond di un router MikroTik nelle tabelle della scheda (Task 8, ADR 0027), dalle uscite grezze che la
 * lettura della topologia ha letto davvero. Un'uscita assente (non riuscita, «non so») o che il lettore della scheda non
 * capisce resta null: la tabella non si tocca, mai una lista vuota. Un errore va nel log col solo codice e non cambia
 * l'esito della lettura della topologia.
 */
function salvaSchedaMikrotik(deviceId: number, uscite: RisultatoMk["uscite"], adesso: Date): void {
  const leggi = <T>(out: string | undefined, lettore: (o: string) => T[]): T[] | null => {
    if (out === undefined) return null;
    const r = interpretaUscita(out, lettore);
    return "valore" in r ? r.valore : null;
  };
  try {
    scriviSchedaMikrotikTopologia(deviceId, {
      bridge: leggi(uscite.bridge, parseBridgeScheda), porte: leggi(uscite.porteBridge, parsePorteBridgeScheda), bond: leggi(uscite.fasci, parseBondScheda),
    }, adesso);
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    console.warn(`[MikroTik] apparato #${deviceId}: scheda (bridge, porte, bond) non scritta (${typeof code === "string" ? code : err instanceof Error ? err.name : "errore"})`);
  }
}

export type RunArpPollOptions = {
  /** Se impostato, aggiorna solo questi IP (nessun nuovo host da voci ARP fuori elenco). */
  onlyEnrichIps?: string[];
  /** Se true, non importa lease DHCP MikroTik (evita host extra durante scoperta rete). */
  skipDhcpLeases?: boolean;
  /** Solo per le prove: il client del router al posto di quello vero (SSH/SNMP). */
  creaClientRouter?: typeof createRouterClient;
  /** Solo per le prove: la connessione delle letture in più dei MikroTik al posto di quella SSH vera (spia, I33). */
  apriEsecutore?: ApriEsecutore;
  /** Solo per le prove: l'ora del giro per la cadenza delle letture in più. */
  adesso?: () => Date;
  /** Solo per le prove: il walk SNMP delle letture in più al posto di quello vero (spia, I33). */
  creaWalkSnmp?: typeof creaWalkSnmp;
  /** Solo per le prove: il client dello switch al posto di quello vero. */
  creaClientSwitch?: typeof createSwitchClient;
};

/**
 * Le letture in più di un MikroTik letto via SSH (spec topologia §13.5.2, T2.2), dietro `topologia.lettura.mikrotik`, al
 * più una volta l'ora per apparato. `uscitaInterfacce`: MK2 già letto dal giro (ramo dei router); null = si legge qui.
 * `conVicini`: il ramo degli switch legge anche MK1, con la fonte nuova `ssh`, che legge solo il modello per cavo.
 */
async function letturaMikrotik(device: NetworkDevice, uscitaInterfacce: string | null, conVicini: boolean, options?: RunArpPollOptions): Promise<EsitoGiro<unknown>> {
  return conCadenza("mikrotik", device.id, async () => {
    const r = await (options?.apriEsecutore ?? apriEsecutoreSsh)(device, (esegui) => leggiMikrotikTopologia(esegui, { uscitaInterfacce, conVicini }));
    const adesso = options?.adesso?.() ?? new Date();
    const scritti = scriviFattiTopologia(device.id, "device", fattiMikrotik(r.lettura), adesso);
    // Scheda MikroTik (Task 8, ADR 0027): solo i router (il ramo degli switch legge coi vicini), dalle stesse uscite.
    if (!conVicini) salvaSchedaMikrotik(device.id, r.uscite, adesso);
    if (r.vicini && r.vicini.length > 0) upsertNeighbors(device.id, r.vicini, "ssh");
    return { valore: scritti, conteggio: { comandi: r.comandi, riusciti: r.riusciti, codice: r.codice } };
  }, options?.adesso);
}

/**
 * VLAN dei bridge, interfacce VLAN, DNS e utenti di un router MikroTik (scheda MikroTik, Task 10, ADR 0027), dietro
 * `topologia.lettura.mikrotik_scheda` (spenta di default), al più una volta l'ora per apparato: quattro comandi in sola
 * lettura su una connessione sua. Schema della scheda sotto il livello 3 → errore `SCHEMA_SCHEDA` prima di aprire la
 * connessione (nessun comando). Una parte non letta (null) non tocca la sua tabella. Esito e resoconto: numeri e codici, mai
 * nomi (gli utenti del router sono dati riservati). `ignoraCadenza`: subito, senza aspettare l'ora (il job
 * `apparati_scelti`, scelta esplicita di un admin), ma mai da spenta.
 */
export async function letturaSchedaMikrotik(device: NetworkDevice, options?: RunArpPollOptions,
  opzioni: { ignoraCadenza?: boolean } = {}): Promise<EsitoGiro<unknown>> {
  return conCadenza("mikrotik_scheda", device.id, async () => {
    if (livelloSchedaMkCorrente() < 3) {
      throw Object.assign(new Error("Schema della scheda MikroTik sotto il livello 3"), { code: "SCHEMA_SCHEDA" });
    }
    const r = await (options?.apriEsecutore ?? apriEsecutoreSsh)(device, (esegui) => leggiMikrotikScheda(esegui));
    const scritto = scriviSchedaMikrotikLettura(device.id, r, options?.adesso?.() ?? new Date());
    return { valore: scritto, conteggio: { comandi: r.comandi, riusciti: r.riusciti, codice: r.codice } };
  }, options?.adesso, opzioni);
}

/**
 * Le letture SNMP in più (spec topologia §13.5.4, SN2-SN9) di uno switch che non è del controller e non è un MikroTik letto
 * via SSH, dietro `topologia.lettura.snmp`, al più una volta l'ora. Chi legge «della marca che consuma il CDP»: il
 * fornitore dell'apparato o la sua descrizione SNMP (SN9). Sedici letture, ognuna con la sua sessione e TEMPO_WALK_MS.
 * Nessuna lettura riuscita = errore col codice: niente scrittura né potatura (revisione del Task 6 di T2, C2).
 */
async function letturaSnmp(device: NetworkDevice, options?: RunArpPollOptions): Promise<EsitoGiro<unknown>> {
  return conCadenza("snmp", device.id, async () => {
    const walk = await (options?.creaWalkSnmp ?? creaWalkSnmp)(device, TEMPO_WALK_MS);
    const l = await leggiSnmpTopologia(walk, { lettoreCisco: device.vendor === "cisco" || /cisco/i.test(device.sysdescr ?? "") });
    if (l.riuscite === 0) throw Object.assign(new Error("Nessuna lettura SNMP riuscita"), { code: l.codice ?? "NESSUNA_LETTURA" });
    const scritti = scriviFattiTopologia(device.id, "snmp", l, options?.adesso?.() ?? new Date());
    if (l.vicini.length > 0) upsertNeighbors(device.id, l.vicini, "snmp");
    return { valore: scritti, conteggio: { comandi: l.letture, riusciti: l.riuscite, codice: l.codice } };
  }, options?.adesso);
}

/**
 * Gli apparati della lettura `switch_vlan`: gli switch con una sessione SNMP, anche quelli del controller (la ProMax dell'hub
 * risponde via SNMP; le tabelle sono della scheda, non toccano i vicini della mappa), non i MikroTik letti via SSH (hanno le
 * loro letture). AP, NAS, server e router no. Chi chiama guarda PRIMA l'interruttore: spenta, nemmeno la credenziale si cerca.
 */
export function vlanSwitchDaLeggere(device: NetworkDevice): boolean {
  return device.device_type === "switch" && !(device.vendor === "mikrotik" && device.protocol === "ssh") && deviceHasSnmpSession(device);
}

/**
 * Le VLAN di uno switch via SNMP (piano 2026-10-22 accorpamento, Task 9, ADR 0029), dietro `topologia.lettura.switch_vlan`
 * (spenta di default, ADR 0018): sette walk in sola lettura (Q-BRIDGE-MIB e BRIDGE-MIB), ognuna con la sua sessione e
 * TEMPO_WALK_MS; al più una volta l'ora per apparato nel giro, subito con `ignoraCadenza` («Interroga»). Schema assente →
 * errore `SCHEMA_SWITCH_VLAN` prima di aprire la sessione. Solo «letto» scrive (una fotografia); «non so» e «non riuscito»
 * sono un errore col codice: niente scrittura, le righe di prima restano con la loro data, il resoconto le conta fra le non
 * riuscite. Il valore è il numero di VLAN scritte. Esito e resoconto: numeri e codici, mai nomi o IP.
 */
export async function letturaVlanSwitch(device: NetworkDevice, options?: Pick<RunArpPollOptions, "creaWalkSnmp" | "adesso">,
  opzioni: { ignoraCadenza?: boolean } = {}): Promise<EsitoGiro<number>> {
  return conCadenza("switch_vlan", device.id, async () => {
    if (!schemaSwitchVlanCorrente()) {
      throw Object.assign(new Error("Schema delle VLAN degli switch assente"), { code: "SCHEMA_SWITCH_VLAN" });
    }
    const walk = await (options?.creaWalkSnmp ?? creaWalkSnmp)(device, TEMPO_WALK_MS);
    const l = await leggiVlanSwitch(walk);
    if (l.esito !== "letto") {
      throw Object.assign(new Error(`VLAN dello switch: esito ${l.esito}`), { code: l.codice ?? (l.esito === "non_so" ? "NON_SO" : "NESSUNA_LETTURA") });
    }
    if (!scriviVlanSwitch(device.id, l, options?.adesso?.() ?? new Date())) {
      throw Object.assign(new Error("Schema delle VLAN degli switch assente"), { code: "SCHEMA_SWITCH_VLAN" });
    }
    return { valore: l.vlan.length, conteggio: { comandi: l.letture, riusciti: l.riuscite, codice: l.codice } };
  }, options?.adesso, opzioni);
}

/** Il giro ARP fra un apparato e l'altro: reti, IP da arricchire e resoconto (porte non lette, letture in più). */
export interface ContestoArp {
  networks: ReturnType<typeof getNetworks>;
  enrichSet: Set<string> | null;
  porteNonLette: string[];
  esitiLetture: Array<EsitoGiro<unknown>>;
}

const IP_NEL_TESTO = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

/**
 * Un errore per il journal (piano 2026-10-22 scansione automatica, decisione 14): il codice e il messaggio senza IP, nome
 * o host dell'apparato (la maschera degli IP di «Interroga»). Un `SshError` porta anche l'utente: solo il codice.
 */
export function erroreSenzaNomi(err: unknown, device: Pick<NetworkDevice, "name" | "host">): string {
  const codice = codiceTrasporto(err);
  if (err instanceof SshError) return codice;
  let msg = err instanceof Error ? err.message : String(err);
  for (const s of [device.name, device.host]) if (s) msg = msg.split(s).join("<apparato>");
  return `${codice}: ${msg.replace(IP_NEL_TESTO, "<ip>")}`;
}

/**
 * La lettura di un apparato del giro ARP (piano 2026-10-22 scansione automatica, Task 4): ramo dei router (ARP, lease
 * DHCP, schema porte, MAC per porta dalla bridge host, vicini, routing, letture in più dei MikroTik) o degli switch
 * (tabella MAC, `mac_ip_mapping`, schema porte). Era il corpo del ciclo di `runArpPoll`, che la chiama per ogni apparato
 * sotto il lucchetto; il job `apparati_scelti` la chiama per «Porte e MAC» con `vlan: "no"` (la VLAN la fa lui, se
 * scelta). Un errore va nel journal (id e codice) e arriva a chi chiama, come prima fermava il corpo del ciclo.
 */
export async function leggiApparatoArp(device: NetworkDevice, ctx: ContestoArp,
  opzioni?: RunArpPollOptions & { vlan?: "come_il_giro" | "no" }): Promise<void> {
  if (device.device_type === "hypervisor") return;
  const options = opzioni;
  const { networks, enrichSet, porteNonLette, esitiLetture } = ctx;
  const conVlan = opzioni?.vlan !== "no";
  let mkProvata = false; // la lettura in più del MikroTik di questo giro è partita (B5, revisione del Task 4)
  try {
    if (networkDeviceUsesArpPoll(device)) {
      const client = await (options?.creaClientRouter ?? createRouterClient)(device);
      const entries = await client.getArpTable();

      // Prima aggiorna hosts con MAC e vendor, poi upsertArpEntries (così host_id in arp_entries è corretto)
      for (const entry of entries) {
        if (!entry.ip || !entry.mac) continue;
        if (enrichSet && !enrichSet.has(entry.ip)) continue;
        const network = networks.find((n) => isIpInCidr(entry.ip!, n.cidr));
        if (!network) continue;
        const vendor = await lookupVendor(entry.mac);
        // ARP è fonte PASSIVA: aggiorna solo host già esistenti, MAI inserisce.
        // I router tengono entry ARP per ore (Cisco 4h default), quindi un IP nella
        // tabella ARP non prova reachability attuale né "esistenza" del device.
        // Solo i probe attivi (ICMP + TCP fallback in network_discovery) sono
        // autoritativi per la CREAZIONE di un host. Se l'host è stato cancellato
        // dall'utente, NON va ricreato fino a quando ICMP non lo ri-conferma.
        // Fase 4: bypass classifyDevice→classification rimosso — un solo
        // scrittore (attribution v2). recomputeAttributionSafe sotto emette
        // l'evidenza "oui" dal vendor appena scritto e proietta il risultato.
        const host = updateHostIfExists({
          network_id: network.id,
          ip: entry.ip,
          mac: entry.mac,
          vendor: vendor || undefined,
          hostname_source: "arp",
        });
        if (host) {
          const { recomputeAttributionSafe } = await import("@/lib/attribution/recompute");
          recomputeAttributionSafe(host.id, "scan");
        }
      }
      upsertArpEntries(device.id, entries, (ip) => {
        const n = networks.find((net) => isIpInCidr(ip, net.cidr));
        return n?.id ?? null;
      });

      // MikroTik: recupera lease DHCP per popolare hostname, MAC e altri campi
      if (client.getDhcpLeases && !options?.skipDhcpLeases) {
        try {
          const leases = await client.getDhcpLeases();
          const dhcpNetworksToSync = new Set<number>();
          for (const lease of leases) {
            if (enrichSet && !enrichSet.has(lease.ip)) continue;
            const network = networks.find((n) => isIpInCidr(lease.ip, n.cidr));
            if (!network) continue;
            const vendor = await lookupVendor(lease.mac);
            // DHCP è fonte PASSIVA: aggiorna solo host esistenti, MAI inserisce.
            // I DHCP server tengono lease per ore/giorni dopo che il device si
            // spegne, quindi un lease attivo non prova che l'host esista più.
            // Vedi commento in arp_poll sopra.
            // Fase 4: bypass classifyDevice→classification rimosso — un solo
            // scrittore (attribution v2), vedi recomputeAttributionSafe sotto.
            const host = updateHostIfExists({
              network_id: network.id,
              ip: lease.ip,
              mac: lease.mac,
              ...(lease.hostname && { hostname: lease.hostname }),
              hostname_source: "dhcp",
              vendor: vendor || undefined,
            });
            if (host) {
              const { recomputeAttributionSafe } = await import("@/lib/attribution/recompute");
              recomputeAttributionSafe(host.id, "scan");
            }
            upsertMacIpMapping({
              mac: lease.mac,
              ip: lease.ip,
              source: "dhcp",
              source_device_id: device.id,
              network_id: network.id,
              host_id: host?.id ?? null,
              vendor: vendor ?? undefined,
              hostname: lease.hostname ?? undefined,
            });
            upsertDhcpLease({
              source_type: "mikrotik",
              source_device_id: device.id,
              source_name: device.name,
              server_name: lease.server ?? null,
              ip_address: lease.ip,
              mac_address: lease.mac,
              hostname: lease.hostname ?? null,
              status: lease.status ?? null,
              lease_expires: lease.expiresAfter ?? null,
              description: lease.comment ?? null,
              dynamic_lease: lease.dynamic === true ? 1 : lease.dynamic === false ? 0 : null,
              // v0.2.659: last-seen RouterOS è durata relativa (es. "1d2h").
              // Convertita in ISO timestamp assoluto = now - duration.
              last_seen: routerOsDurationToIsoTimestamp(lease.lastSeen),
              host_id: host?.id ?? null,
              network_id: network.id,
            });
            dhcpNetworksToSync.add(network.id);
          }
          for (const nid of dhcpNetworksToSync) {
            syncIpAssignmentsForNetwork(nid);
          }
        } catch (err) {
          console.error(`[DHCP Leases] apparato #${device.id}: ${erroreSenzaNomi(err, device)}`);
        }
      }

      // Schema porte e LLDP/CDP (SNMP)
      const portInfos = await client.getPortSchema?.().catch((err: unknown) => {
        console.warn(`[ARP Poll] apparato #${device.id}: getPortSchema fallito (${erroreSenzaNomi(err, device)})`);
        return [];
      }) ?? [];
      if (portInfos.length > 0) {
      const macsByPortByIndex = new Map<number, { macs: string[] }>();
      const macsByPortByName = new Map<string, { macs: string[] }>();
      for (const e of entries) {
        const ifName = (e.interface_name ?? "").trim();
        if (!ifName) continue;
        const ifIndexMatch = ifName.match(/^if(\d+)$/i);
        if (ifIndexMatch) {
          const idx = parseInt(ifIndexMatch[1], 10);
          const existing = macsByPortByIndex.get(idx) || { macs: [] };
          existing.macs.push(e.mac);
          macsByPortByIndex.set(idx, existing);
        } else {
          const key = normalizePortNameForMatch(ifName);
          const existing = macsByPortByName.get(key) || { macs: [] };
          existing.macs.push(e.mac);
          macsByPortByName.set(key, existing);
        }
      }

      const switchPorts = portInfos.map((p) => {
          const portMacs = macsByPortByIndex.get(p.port_index) ?? macsByPortByName.get(normalizePortNameForMatch(p.port_name.trim()));
          const macCount = portMacs?.macs.length || 0;
          const isTrunk = macCount > 1 ? 1 : 0;
          let singleMac: string | null = null;
          let singleMacVendor: string | null = null;
          let singleMacIp: string | null = null;
          let singleMacHostname: string | null = null;
          let hostId: number | null = null;
          if (macCount === 1 && portMacs) {
            singleMac = portMacs.macs[0];
            const resolved = resolveMacToDevice(singleMac);
            singleMacIp = resolved.ip;
            singleMacHostname = resolved.hostname;
            singleMacVendor = resolved.vendor;
            hostId = resolved.host_id;
          }

          let trunk_primary_device_id: number | null = null;
          let trunk_primary_name: string | null = null;
          if (isTrunk && portMacs && !p.trunk_neighbor_name) {
            const matches: { device_id: number; device_name: string; device_type: string }[] = [];
            for (const mac of portMacs.macs) {
              const nd = resolveMacToNetworkDevice(mac, device.id);
              if (nd) matches.push(nd);
            }
            const primary = matches.find((m) => m.device_type === "router") ?? matches[0];
            if (primary) {
              trunk_primary_device_id = primary.device_id;
              trunk_primary_name = primary.device_name;
            }
          }

          return {
            port_index: p.port_index,
            port_name: p.port_name.trim(),
            status: p.status,
            speed: p.speed,
            duplex: p.duplex,
            vlan: p.vlan,
            poe_status: p.poe_status,
            poe_power_mw: p.poe_power_mw,
            mac_count: macCount,
            is_trunk: isTrunk,
            single_mac: singleMac,
            single_mac_vendor: singleMacVendor,
            single_mac_ip: singleMacIp,
            single_mac_hostname: singleMacHostname,
            host_id: hostId,
            trunk_neighbor_name: p.trunk_neighbor_name ?? null,
            trunk_neighbor_port: p.trunk_neighbor_port ?? null,
            trunk_primary_device_id,
            trunk_primary_name,
            stp_state: p.stp_state ?? null,
          };
        });

        upsertSwitchPorts(device.id, switchPorts);
        // Fase 2b, Task 1b: l'ARP di un router non va più in mac_port_entries — la sua
        // `interface=` è bridge/VLAN/VRRP, non il cavo. I MAC per porta vengono dalla bridge host, sotto.
      }

      // MAC per porta del router: la bridge host sulle porte fisiche (ether, bond), in sola lettura.
      // Un errore non ferma il resto del giro: va nel resoconto, col solo codice (niente MAC né IP).
      const porte = await leggiMacPorteRouter(client);
      if (porte.righe) {
        salvaMacPorta(device.id, porte.righe.map((e) => ({ ...e, port_name: e.port_name.trim() })));
      } else if (porte.errore) {
        console.warn(`[ARP Poll] apparato #${device.id}: porte fisiche non lette (${porte.errore})`);
        porteNonLette.push(`${device.name} (${porte.errore})`);
      }

      // Scheda MikroTik (Task 3): `/interface print terse` è già stato letto qui sopra (getInterfaceTypes); da quella stessa
      // uscita escono stato, MTU, commento e tipo delle interfacce, sulle righe dell'apparato fisico. Nessun comando nuovo.
      // Un errore non ferma il giro: va in console col solo codice (niente nomi né commenti del cliente).
      if (device.vendor === "mikrotik" && device.protocol === "ssh" && device.physical_device_id != null) {
        const uscita = client.ultimaUscitaInterfacce?.() ?? null;
        if (uscita !== null) {
          try {
            const lette = interpretaUscita(uscita, parseInterfacce);
            if ("valore" in lette) aggiornaInterfacceRouterOs(device.physical_device_id, lette.valore);
            else console.warn(`[ARP Poll] apparato #${device.id}: interfacce non lette (${lette.codice})`);
          } catch (err) {
            console.warn(`[ARP Poll] apparato #${device.id}: interfacce non scritte (${err instanceof Error ? err.name : "errore"})`);
          }
        }
      }

      // Neighbors LLDP/CDP/MNDP
      if (client.getNeighbors) {
        try {
          const neighbors = await client.getNeighbors();
          if (neighbors.length > 0) {
            // T2 (spec §13.5.2, MK1): discovered-by e capacità solo con la lettura dei MikroTik accesa (I33).
            upsertNeighbors(device.id, letturaAccesa("mikrotik") ? neighbors : neighbors.map(senzaCampiCavi));
          }
        } catch (err) {
          console.warn(`[Neighbors] apparato #${device.id}: ${erroreSenzaNomi(err, device)}`);
        }
      }

      // Tabella di routing
      if (client.getRoutingTable) {
        try {
          const routes = await client.getRoutingTable();
          if (routes.length > 0) {
            upsertRoutes(device.id, routes);
          }
        } catch (err) {
          console.warn(`[Routing] apparato #${device.id}: ${erroreSenzaNomi(err, device)}`);
        }
      }

      // Letture in più (T2, spenta di default): MK3-MK8 su una connessione sola; MK2 è l'uscita già letta qui sopra.
      if (device.vendor === "mikrotik" && device.protocol === "ssh") {
        mkProvata = true;
        esitiLetture.push(await letturaMikrotik(device, client.ultimaUscitaInterfacce?.() ?? null, false, options));
        // Scheda MikroTik (Task 10): VLAN, DNS e utenti, spenta di default; solo i router. Il job `apparati_scelti` la
        // chiede a parte, solo se ha scelto la VLAN (`vlan: "no"` qui).
        if (conVlan) esitiLetture.push(await letturaSchedaMikrotik(device, options));
      }
    } else {
      // Letture in più (T2, spenta di default) per prime: una tabella MAC che fallisce non deve toglierle.
      if (device.vendor === "mikrotik" && device.protocol === "ssh") {
        esitiLetture.push(await letturaMikrotik(device, null, true, options));
      }
      // SN6: solo per gli switch senza controller (la chiave dei vicini non ha la fonte: due lettori della stessa riga si
      // scambierebbero la fonte) e non letti come MikroTik via SSH (hanno le loro letture). Interruttore guardato per
      // primo: spenta, il giro degli switch fa esattamente quello di prima (nemmeno la ricerca della credenziale SNMP).
      // Solo gli switch (spec §13.5.4; revisione del Task 6, C5): AP, NAS e server di questo ramo no, scelta di Riccardo.
      const delController = !!(device as NetworkDevice & { controller_mac?: string | null }).controller_mac;
      if (device.device_type === "switch" && !delController && !(device.vendor === "mikrotik" && device.protocol === "ssh")
        && letturaAccesa("snmp") && deviceHasSnmpSession(device)) {
        esitiLetture.push(await letturaSnmp(device, options));
      }
      // VLAN degli switch (Task 9, ADR 0029), spenta di default: interruttore per primo, come sopra. Prima della tabella MAC,
      // che può fallire e fermare il ramo.
      // Il job `apparati_scelti` la chiede a parte, solo se scelta (`vlan: "no"`): qui nemmeno l'interruttore si guarda.
      if (conVlan && letturaAccesa("switch_vlan") && vlanSwitchDaLeggere(device)) {
        esitiLetture.push(await letturaVlanSwitch(device, options));
      }
      const client = await (options?.creaClientSwitch ?? createSwitchClient)(device);
      const entries = await client.getMacTable();
      salvaMacPorta(device.id, entries.map((e) => ({
        mac: e.mac,
        port_name: e.port_name.trim(),
        vlan: e.vlan,
        port_status: e.port_status,
        speed: e.speed,
      })));

      // Popola mac_ip_mapping con MAC da switch risolti a IP (hosts/ARP)
      const switchNetwork = networks.find((n) => isIpInCidr(device.host, n.cidr));
      for (const e of entries) {
        if (!e.mac) continue;
        const resolved = resolveMacToDevice(e.mac);
        if (resolved.ip) {
          upsertMacIpMapping({
            mac: e.mac,
            ip: resolved.ip,
            source: "switch",
            source_device_id: device.id,
            network_id: switchNetwork?.id ?? null,
            host_id: resolved.host_id,
            vendor: resolved.vendor ?? undefined,
            hostname: resolved.hostname ?? undefined,
          });
        }
      }

      // Port schema con cross-ref ARP/IPAM per assegnare device alla porta
      const portInfos = await client.getPortSchema();
      if (portInfos.length > 0) {
        const macsByPort = new Map<string, { macs: string[]; vlan: number | null }>();
        for (const e of entries) {
          const key = normalizePortNameForMatch(e.port_name.trim());
          const existing = macsByPort.get(key) || { macs: [], vlan: e.vlan };
          existing.macs.push(e.mac);
          if (e.vlan != null) existing.vlan = e.vlan;
          macsByPort.set(key, existing);
        }

        const switchPorts = portInfos.map((p) => {
          const portMacs = macsByPort.get(normalizePortNameForMatch(p.port_name.trim()));
          const macCount = portMacs?.macs.length || 0;
          const isTrunk = macCount > 1 ? 1 : 0;
          let singleMac: string | null = null;
          let singleMacVendor: string | null = null;
          let singleMacIp: string | null = null;
          let singleMacHostname: string | null = null;

          let hostId: number | null = null;
          if (macCount === 1 && portMacs) {
            singleMac = portMacs.macs[0];
            const resolved = resolveMacToDevice(singleMac);
            singleMacIp = resolved.ip;
            singleMacHostname = resolved.hostname;
            singleMacVendor = resolved.vendor;
            hostId = resolved.host_id;
          }

          let trunk_primary_device_id: number | null = null;
          let trunk_primary_name: string | null = null;
          if (isTrunk && portMacs && !p.trunk_neighbor_name) {
            const matches: { device_id: number; device_name: string; device_type: string }[] = [];
            for (const mac of portMacs.macs) {
              const nd = resolveMacToNetworkDevice(mac, device.id);
              if (nd) matches.push(nd);
            }
            const primary = matches.find((m) => m.device_type === "router") ?? matches[0];
            if (primary) {
              trunk_primary_device_id = primary.device_id;
              trunk_primary_name = primary.device_name;
            }
          }

          return {
            port_index: p.port_index,
            port_name: p.port_name.trim(),
            status: p.status,
            speed: p.speed,
            duplex: p.duplex,
            vlan: portMacs?.vlan ?? p.vlan,
            poe_status: p.poe_status,
            poe_power_mw: p.poe_power_mw,
            mac_count: macCount,
            is_trunk: isTrunk,
            single_mac: singleMac,
            single_mac_vendor: singleMacVendor,
            single_mac_ip: singleMacIp,
            single_mac_hostname: singleMacHostname,
            host_id: hostId,
          trunk_neighbor_name: p.trunk_neighbor_name ?? null,
          trunk_neighbor_port: p.trunk_neighbor_port ?? null,
          trunk_primary_device_id,
          trunk_primary_name,
          stp_state: p.stp_state ?? null,
        };
      });

      upsertSwitchPorts(device.id, switchPorts);
    }
  }
  } catch (error) {
    console.error(`[ARP Poll] apparato #${device.id}: errore (${erroreSenzaNomi(error, device)})`);
    // Revisione del Task 4 di T2 (B5): il giro del router fermato prima (ARP che non risponde, client che non si crea)
    // saltava le letture in più senza esito. Adesso l'esito «non so» col codice, con le regole di sempre (spenta, cadenza).
    if (!mkProvata && networkDeviceUsesArpPoll(device) && device.vendor === "mikrotik" && device.protocol === "ssh") {
      esitiLetture.push(await conCadenza("mikrotik", device.id, async () => {
        throw Object.assign(new Error("Giro del router non riuscito"), { code: codiceTrasporto(error) });
      }, options?.adesso));
    }
    throw error;
  }
}

export async function runArpPoll(
  networkId?: number | null,
  options?: RunArpPollOptions
): Promise<{ phase?: string; error?: string }> {
  const networks = getNetworks();
  const enrichSet = options?.onlyEnrichIps?.length ? new Set(options.onlyEnrichIps) : null;
  let devices = getNetworkDevices()
    .filter((d) => d.enabled)
    .sort(
      (a, b) =>
        (networkDeviceUsesArpPoll(a) ? 0 : 1) - (networkDeviceUsesArpPoll(b) ? 0 : 1)
    );

  if (networkId != null) {
    const routerId = getNetworkRouterId(networkId);
    if (!routerId) {
      return { error: "Nessun router assegnato a questa rete. Assegna un router dalla pagina di modifica rete." };
    }
    const device = devices.find((d) => d.id === routerId);
    if (!device || !networkDeviceUsesArpPoll(device)) {
      return {
        error:
          "Gateway non trovato o tipo non valido. Assegna un router o un firewall Stormshield (SNMP) come gateway della rete.",
      };
    }
    devices = [device];
  }

  const porteNonLette: string[] = []; // router la cui bridge host non si è letta: nel resoconto
  const esitiLetture: Array<EsitoGiro<unknown>> = []; // letture in più (T2): numeri e codici, mai nomi
  const durate = { router: 0, switch: 0, nRouter: 0, nSwitch: 0 }; // la riga dei tempi del giro (misura del carico, T2)
  const ctx: ContestoArp = { networks, enrichSet, porteNonLette, esitiLetture };
  for (const device of devices) {
    if (device.device_type === "hypervisor") continue;
    const t0 = performance.now();
    let letto = true;
    try {
      // Un apparato già in lettura («Interroga», il job `apparati_scelti`) si salta: mai due letture insieme (decisione 10b).
      const r = await conLucchettoApparato(device.id, () => leggiApparatoArp(device, ctx, options));
      if (r.stato === "occupato") {
        letto = false;
        console.info(`[ARP Poll] apparato #${device.id}: saltato, lettura già in corso`);
      }
    } catch {
      // Già nel journal (leggiApparatoArp, id e codice): il giro passa all'apparato dopo, come prima.
    } finally {
      if (letto) {
        if (networkDeviceUsesArpPoll(device)) {
          durate.router += performance.now() - t0;
          durate.nRouter++;
        } else {
          durate.switch += performance.now() - t0;
          durate.nSwitch++;
        }
      }
    }
  }
  const network = networkId != null ? networks.find((n) => n.id === networkId) : null;
  const base = networkId != null && network
    ? `ARP poll completato per ${network.name}`
    : "ARP poll completato";
  const letture = riassuntoLetture(esitiLetture);
  const phase = [base, porteNonLette.length > 0 ? `porte fisiche non lette: ${porteNonLette.join(", ")}` : null, letture]
    .filter((x): x is string => !!x).join("; ");
  if (networkId == null) {
    const s = (ms: number): string => (ms / 1000).toFixed(1).replace(".", ",");
    console.info(`[ARP Poll] giro: ${durate.nRouter} router in ${s(durate.router)} s, ${durate.nSwitch} switch in ${s(durate.switch)} s${letture ? `; ${letture}` : ""}`);
  }
  return { phase };
}

/** Recupera lease DHCP dal router MikroTik della rete per popolare hostname e MAC */
export async function runDhcpPollForNetwork(
  networkId: number,
  options?: { onlyIps?: string[] }
): Promise<{ updated: number; error?: string }> {
  const routerId = getNetworkRouterId(networkId);
  if (!routerId) {
    return { updated: 0, error: "Nessun router configurato per questa rete" };
  }
  const device = getNetworkDeviceById(routerId);
  if (!device || device.device_type !== "router") {
    return { updated: 0, error: "Router non trovato" };
  }
  if (device.vendor !== "mikrotik" || device.protocol !== "ssh") {
    return { updated: 0, error: "Solo router MikroTik con SSH supporta il recupero DHCP" };
  }
  const networks = getNetworks();
  const network = networks.find((n) => n.id === networkId);
  if (!network) return { updated: 0, error: "Rete non trovata" };

  const client = await createRouterClient(device);
  if (!client.getDhcpLeases) {
    return { updated: 0, error: "Router non supporta DHCP leases" };
  }
  const leases = await client.getDhcpLeases();
  const allow = options?.onlyIps?.length ? new Set(options.onlyIps) : null;
  let updated = 0;
  for (const lease of leases) {
    if (allow && !allow.has(lease.ip)) continue;
    if (!isIpInCidr(lease.ip, network.cidr)) continue;
    const vendor = await lookupVendor(lease.mac);
    // DHCP è fonte PASSIVA: aggiorna solo host esistenti, MAI inserisce.
    // Fase 4: bypass classifyDevice→classification rimosso — un solo
    // scrittore (attribution v2), vedi recomputeAttributionSafe sotto.
    const host = updateHostIfExists({
      network_id: networkId,
      ip: lease.ip,
      mac: lease.mac,
      ...(lease.hostname && { hostname: lease.hostname }),
      hostname_source: "dhcp",
      vendor: vendor || undefined,
    });
    if (host) {
      const { recomputeAttributionSafe } = await import("@/lib/attribution/recompute");
      recomputeAttributionSafe(host.id, "scan");
    }
    upsertMacIpMapping({
      mac: lease.mac,
      ip: lease.ip,
      source: "dhcp",
      source_device_id: device.id,
      network_id: networkId,
      host_id: host?.id ?? null,
      vendor: vendor ?? undefined,
      hostname: lease.hostname ?? undefined,
    });
    upsertDhcpLease({
      source_type: "mikrotik",
      source_device_id: device.id,
      source_name: device.name,
      server_name: lease.server ?? null,
      ip_address: lease.ip,
      mac_address: lease.mac,
      hostname: lease.hostname ?? null,
      status: lease.status ?? null,
      lease_expires: lease.expiresAfter ?? null,
      description: lease.comment ?? null,
      dynamic_lease: lease.dynamic === true ? 1 : lease.dynamic === false ? 0 : null,
      // v0.2.659: last_seen ISO timestamp (= now - RouterOS duration).
      last_seen: routerOsDurationToIsoTimestamp(lease.lastSeen),
      host_id: host?.id ?? null,
      network_id: networkId,
    });
    updated++;
  }
  syncIpAssignmentsForNetwork(networkId);
  return { updated };
}

/**
 * Soft concurrency limit per evitare burst CPU/socket nei ping massivi.
 * 8 worker = compromesso buono tra throughput e impronta. Su 422 host:
 * ~53 batch × 3 s worst case = ~2.5 min, vs 21 min sequenziale puro.
 */
const KNOWN_HOST_CHECK_CONCURRENCY = 8;
/** Jitter casuale (ms) prepended per ogni host. Spalma su una finestra di tempo
 *  i ping all'interno del worker pool, evitando ICMP burst sincroni. */
const KNOWN_HOST_CHECK_JITTER_MS = 250;

async function checkSingleKnownHost(host: ReturnType<typeof getKnownHosts>[number]): Promise<void> {
  const timeoutMs = 3000;
  // Jitter casuale per evitare che 8 ping partano nello stesso ms.
  await new Promise((r) => setTimeout(r, Math.floor(Math.random() * KNOWN_HOST_CHECK_JITTER_MS)));

  let alive = false;
  let latencyMs: number | null = null;

  // Porta delle prove (banco T3-16): vuota in produzione, dove restano il
  // `pingHost` e il `tcpConnect` locali di sempre.
  const io = getScanIoOverride();
  const ping = io ? (ip: string, t: number) => io.executor.pingHost(ip, t) : pingHost;
  const tcp = io ? (io.tcpConnect ?? (async () => false)) : tcpConnect;

  const pingResult = await ping(host.ip, timeoutMs);
  latencyMs = pingResult.latency_ms;
  if (pingResult.alive) {
    alive = true;
  } else {
    let portsToCheck: number[] = FALLBACK_TCP_PORTS;
    if (host.monitor_ports) {
      try {
        const parsed = JSON.parse(host.monitor_ports) as number[];
        if (Array.isArray(parsed) && parsed.length > 0) portsToCheck = parsed;
      } catch { /* invalid JSON, fallback */ }
    }
    for (const port of portsToCheck) {
      const ok = await tcp(host.ip, port, 2000);
      if (ok) { alive = true; break; }
    }
  }

  // T3-19 (INV-2): un ping che non ha potuto girare non è «nessuna risposta».
  // Se nemmeno il TCP ha recuperato l'host, lo stato resta com'era e lo
  // storico non riceve una riga che direbbe «offline» senza saperlo.
  if (!alive && pingResult.error) {
    console.warn(`[KnownHostCheck] host ${host.ip}: esito sconosciuto, stato invariato (${pingResult.error})`);
    return;
  }

  const newStatus = alive ? "online" : "offline";
  // v0.2.645 audit perf DB8: 3 fsync → 1 (INSERT status_history + UPDATE
  // status/last_seen/last_response_time_ms in singola transazione).
  recordHostHeartbeat(host.id, newStatus, latencyMs);
}

export async function runKnownHostCheck(networkId: number | null): Promise<void> {
  const hosts = getKnownHosts(networkId);
  if (hosts.length === 0) {
    console.info(`[KnownHostCheck] nessun host registrato${networkId ? ` per network ${networkId}` : ""}, skip`);
    return;
  }

  // Worker pool semplice: ogni worker pulla dalla coda fino a esaurimento.
  // Senza dipendenze esterne — equivalente a Promise.allSettled + p-limit(8).
  const queue = [...hosts];
  let okCount = 0;
  let errCount = 0;
  const worker = async () => {
    while (queue.length > 0) {
      const host = queue.shift();
      if (!host) break;
      try {
        await checkSingleKnownHost(host);
        okCount++;
      } catch (err) {
        errCount++;
        console.warn(`[KnownHostCheck] host ${host.ip} fallito: ${err instanceof Error ? err.message : err}`);
      }
    }
  };
  const workerCount = Math.min(KNOWN_HOST_CHECK_CONCURRENCY, hosts.length);
  const startedAt = Date.now();
  await Promise.allSettled(Array.from({ length: workerCount }, () => worker()));
  const durationMs = Date.now() - startedAt;

  console.info(
    `[KnownHostCheck] ${okCount}/${hosts.length} host verificati ` +
      `(${errCount} errori, ${workerCount} worker, ${durationMs}ms)`,
  );
}

export async function runDnsResolve(
  networkId: number | null,
  hostIds?: number[] | null
): Promise<{ resolved: number; total: number }> {
  const networkIds = networkId
    ? [networkId]
    : getNetworks().map((n) => n.id);

  const idFilter = hostIds?.length ? new Set(hostIds) : null;

  let resolved = 0;
  let total = 0;

  for (const nid of networkIds) {
    const network = getNetworkById(nid);
    const dnsServer = network?.dns_server ?? null;
    let hosts = getHostsByNetwork(nid);
    if (idFilter) {
      hosts = hosts.filter((h) => idFilter.has(h.id));
    }
    total += hosts.length;
    const cronRefreshDnsStored = process.env.DA_INVENT_DNS_CRON_REFRESH_STORED === "true";
    for (const host of hosts) {
      if (!cronRefreshDnsStored && host.dns_reverse) {
        continue;
      }
      const dnsReverse = await reverseDns(host.ip, dnsServer);
      let dnsForward: string | undefined;
      if (dnsReverse) {
        const fwd = await forwardDns(dnsReverse, dnsServer);
        dnsForward = fwd.includes(host.ip) ? dnsReverse : undefined;
      }

      if (dnsReverse || dnsForward) {
        // DNS resolve gira su host già esistenti (getHostsByNetwork), quindi
        // updateHostIfExists è equivalente a upsertHost qui ma esplicita
        // l'intento: arricchiamo, non creiamo. Se l'host è stato cancellato
        // tra il fetch e qui, niente race-condition di resurrezione.
        const updated = updateHostIfExists({
          network_id: nid,
          ip: host.ip,
          hostname: dnsReverse || undefined,
          hostname_source: "dns",
          dns_reverse: dnsReverse || undefined,
          dns_forward: dnsForward || undefined,
        });
        if (updated) resolved++;
      }
    }
  }

  return { resolved, total };
}

async function runCleanup(configStr: string): Promise<void> {
  // days_until_stale / days_until_delete possono restare nelle config vecchie: si ignorano.
  let config: { mac_port_retention_days?: number };
  try {
    config = JSON.parse(configStr || "{}");
  } catch {
    console.error("[Cleanup] Configurazione JSON non valida, uso valori predefiniti:", configStr);
    config = {};
  }
  // P1 del piano 2026-10-20 (Riccardo): questo job NON tocca più gli host. Prima li
  // marcava 'stale' a 30 giorni e li cancellava a 90, senza le esclusioni della nuova
  // pulizia (src/lib/hosts/pulizia-*), che è l'unica a gestirli. Le soglie
  // days_until_stale / days_until_delete nelle config già salvate non hanno più effetto.
  // Retention mac_port_entries in giorni (topologia fase 2, spec §10.5). Fino
  // alla v0.2.651 erano 24 ore perché ogni giro riscriveva l'intera MAC table;
  // ora le righe sono una per (apparato, MAC, porta), aggiornate a ogni giro:
  // il volume non cresce coi giri, e una riga vecchia dice «visto l'ultima volta».
  const macPortRetentionDays = config.mac_port_retention_days ?? MAC_PORT_RETENTION_DAYS;

  try {
    const deleted = cleanupOldMacPortEntries(macPortRetentionDays);
    if (deleted > 0) {
      console.info(`[Cleanup] mac_port_entries: eliminate ${deleted} righe più vecchie di ${macPortRetentionDays} giorni`);
    }
  } catch (e) {
    console.warn(`[Cleanup] mac_port_entries cleanup fallito:`, e);
  }

  // Retention alert Wazuh: elimina solo gli eventi PRESI IN CARICO più vecchi
  // della soglia. Gli eventi ancora aperti restano, per quanto vecchi siano.
  try {
    const { getNotificationConfig } = await import("@/lib/notifications/config");
    const { ensureWazuhAlertSchema, purgeAcknowledgedOlderThan, tenantDb } = await import(
      "@/lib/integrations/wazuh-alerts-db"
    );
    const days = getNotificationConfig().retentionDays;
    const db = tenantDb();
    ensureWazuhAlertSchema(db);
    const removed = purgeAcknowledgedOlderThan(db, days);
    if (removed > 0) {
      console.info(
        `[Cleanup] wazuh_alert_event: eliminati ${removed} eventi presi in carico più vecchi di ${days} giorni`,
      );
    }
  } catch (e) {
    console.warn(`[Cleanup] retention alert Wazuh fallita:`, e);
  }
}

async function runAdSync(configStr: string): Promise<void> {
  let config: { integration_id?: number };
  try {
    config = JSON.parse(configStr || "{}");
  } catch {
    console.error("[AD Sync] Configurazione JSON non valida:", configStr);
    return;
  }

  const integrationId = config.integration_id;
  if (!integrationId) {
    const { getAdIntegrations } = await import("@/lib/db");
    const integrations = getAdIntegrations().filter((i) => i.enabled);
    if (integrations.length === 0) {
      console.info("[AD Sync] Nessuna integrazione AD abilitata");
      return;
    }
    for (const int of integrations) {
      await syncSingleAdIntegration(int.id);
    }
  } else {
    await syncSingleAdIntegration(integrationId);
  }
}

async function syncSingleAdIntegration(integrationId: number): Promise<void> {
  try {
    const { syncActiveDirectory } = await import("@/lib/ad/ad-client");
    console.info(`[AD Sync] Avvio sincronizzazione integrazione #${integrationId}`);
    const result = await syncActiveDirectory(integrationId);
    console.info(`[AD Sync] Completato: ${result.computers} computer, ${result.users} utenti, ${result.groups} gruppi, ${result.linked_hosts} host collegati (${result.duration_ms}ms)`);
    if (result.errors.length > 0) {
      console.warn(`[AD Sync] Errori: ${result.errors.join(", ")}`);
    }
  } catch (err) {
    console.error(`[AD Sync] Errore integrazione #${integrationId}:`, err);
  }
}

// ── Anomaly Check ─────────────────────────────────────────────────────────────

async function runAnomalyCheck(networkId: number | null): Promise<void> {
  console.info(`[Anomaly] Avvio check anomalie${networkId ? ` rete #${networkId}` : " (tutte le reti)"}`);
  const start = Date.now();
  let created = 0;

  const allHosts = getAllHostsFlat();
  const hosts: HostForAnomaly[] = allHosts
    .filter((h) => !networkId || h.network_id === networkId)
    .map((h) => ({
      id: h.id,
      ip: h.ip,
      mac: h.mac ?? null,
      vendor: h.vendor ?? null,
      network_id: h.network_id,
      known_host: h.known_host ?? 0,
      first_seen: h.first_seen ?? null,
      status: h.status ?? "unknown",
      open_ports: (h as unknown as { open_ports?: string }).open_ports ?? null,
    }));

  if (hosts.length === 0) {
    console.info("[Anomaly] Nessun host da analizzare");
    return;
  }

  // 1. MAC flip — usa ARP entries recenti (ultimi 2h)
  try {
    const db = getDb();
    const recentArp = db.prepare(
      `SELECT host_id, mac, ip, timestamp FROM arp_entries
       WHERE timestamp >= datetime('now', '-2 hours')
       ORDER BY timestamp DESC`
    ).all() as { host_id: number | null; mac: string; ip: string | null; timestamp: string }[];

    const macFlipEvents = checkMacFlip(hosts, recentArp);
    for (const ev of macFlipEvents) {
      if (ev.host_id && hasOpenAnomaly(ev.host_id, "mac_flip", 24)) continue;
      insertAnomalyEvent(ev);
      created++;
    }
  } catch (err) {
    console.error("[Anomaly] Errore check mac_flip:", err);
  }

  // 2. Nuovi host non censiti
  try {
    const newHostEvents = checkNewUnknownHosts(hosts);
    for (const ev of newHostEvents) {
      if (ev.host_id && hasOpenAnomaly(ev.host_id, "new_unknown_host", 4)) continue;
      insertAnomalyEvent(ev);
      created++;
    }
  } catch (err) {
    console.error("[Anomaly] Errore check new_unknown_host:", err);
  }

  // 3. Port changes — legge ultimi 3 scan per host con ports_open valorizzato
  try {
    const hostScans = new Map<number, ScanHistoryForAnomaly[]>();
    const hostsInScope = hosts.filter((h) => h.known_host === 1);

    for (const host of hostsInScope) {
      const scans = getScanHistory({ host_id: host.id, limit: 3 });
      const withPorts = scans
        .filter((s) => s.ports_open != null)
        .map((s) => ({ host_id: host.id, ports_open: s.ports_open, timestamp: s.timestamp }));
      if (withPorts.length >= 2) hostScans.set(host.id, withPorts);
    }

    const portChangeEvents = checkPortChanges(hostScans, hosts);
    for (const ev of portChangeEvents) {
      if (ev.host_id && hasOpenAnomaly(ev.host_id, "port_change", 12)) continue;
      insertAnomalyEvent(ev);
      created++;
    }
  } catch (err) {
    console.error("[Anomaly] Errore check port_change:", err);
  }

  // 4+5. Uptime e latency anomaly — solo known_host per limitare il carico
  const knownHosts = hosts.filter((h) => h.known_host === 1);
  for (const host of knownHosts) {
    // Uptime anomaly
    try {
      const history = getStatusHistory(host.id, 500) as StatusHistoryEntry[];
      const ev = checkUptimeAnomaly(host.id, host.network_id, host.ip, history);
      if (ev && !hasOpenAnomaly(host.id, "uptime_anomaly", 24)) {
        insertAnomalyEvent(ev);
        created++;
      }
    } catch (err) {
      console.error(`[Anomaly] Errore uptime_anomaly host #${host.id}:`, err);
    }

    // Latency anomaly
    try {
      const latHistory = getHostLatencyHistory(host.id, 72);
      const ev = checkLatencyAnomaly(host.id, host.network_id, host.ip, latHistory);
      if (ev && !hasOpenAnomaly(host.id, "latency_anomaly", 6)) {
        insertAnomalyEvent(ev);
        created++;
      }
    } catch (err) {
      console.error(`[Anomaly] Errore latency_anomaly host #${host.id}:`, err);
    }
  }

  console.info(`[Anomaly] Completato in ${Date.now() - start}ms — ${created} nuovi eventi`);
}

