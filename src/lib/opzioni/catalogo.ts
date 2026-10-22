/**
 * Il catalogo delle opzioni (spec pagina Opzioni §3.1): ogni funzione che si accende o si spegne, una volta, con la sua
 * lettura dal sistema vivo e la sua scrittura. Il censimento del 22/10 (spec §1) è la fonte: una funzione nuova con un
 * interruttore va qui, o in `fuori-catalogo.ts` col motivo, altrimenti la prova di completezza fallisce.
 *
 * `leggi` e `cambia` chiamano le funzioni che esistono già (letture, job, moduli, notifiche, DA-Link…): qui non si
 * riscrive la logica, la si indicizza. Si chiama nel contesto del tenant (rotte: `withTenantFromSession`).
 */
import {
  getCurrentTenantCode, getHypervisorSyncSchedule, getScheduledJobs, getTenantDb, getTenantSetting,
  getVulnScannerStato, listControllerClientScheduleJobs, listControllerScheduleJobs, listNetworksLite, schemaCaviPresente,
  setControllerSchedule, setHypervisorSyncSchedule, setPuliziaHostSchedule, setTenantSetting, setVulnScannerEnabled, toggleJob,
  updateScheduledJobInterval,
} from "@/lib/db-tenant";
import { getSetting, setSetting } from "@/lib/db-hub";
import { parseDbDate, FUSO_UTENTI } from "@/lib/db-date";
import { ETICHETTE_JOB, scheduledJobLabel } from "@/lib/scheduled-job-types";
import type { ScheduledJob } from "@/types";
import {
  LETTURE, leggiEsiti, leggiInterruttore, scriviInterruttore, type Lettura, type StatoInterruttore,
} from "@/lib/topology/letture/interruttori";
import { leggiMappaCavi, scriviMappaCavi } from "@/lib/topology/letture/mappa";
import { JOB_DI_SERIE, eJobDiSerie, lapide, scriviLapide, seminaJobDiSerie, togliLapide, type TipoJobDiSerie } from "./job-di-serie";
import { listControllerViews, setClientScheduleFor } from "@/lib/controllers/service";
import { getFeatureStatus } from "@/lib/patch/feature";
import { getMeshState } from "@/lib/integrations/meshcentral/feature";
import { getNetServicesState, uninstallNetServices } from "@/lib/network-services/feature";
import { installaModulo, disinstallaModulo } from "@/lib/modules/installa";
import { UNINSTALL_COPY, type UninstallableFeature } from "@/lib/modules/uninstall-copy";
import { leggiConfigLettura, impostaAccesoLettura } from "@/lib/zabbix-lettura/config";
import { getMdmConfig, saveMdmConfig } from "@/lib/integrations/mdm-config";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";
import { getIntegrationConfig } from "@/lib/integrations/config";
import { chocoAutomaticoAccesoDb, impostaChocoAutomaticoDb } from "@/lib/patch/choco-automatico";
import { CHIAVE_MODO, impostazioniDa } from "@/lib/scanner/offline-guard";
import { CHIAVE_SENZA_AGENTE, statoSenzaAgente } from "@/lib/integrations/meshcentral/senza-agente";
import { getNotificationConfig, setNotificationConfig } from "@/lib/notifications/config";
import { eLivello, impostaLivello, livelloAttuale, statoSegnale } from "@/lib/dalink/stato";
import { inviaAdesso } from "@/lib/dalink/segnale-job";
import { leggiConfigDalink } from "@/lib/dalink/config";
import { leggiConfigVulcan } from "@/lib/vulcan/config";
import { ErroreOpzione, type Opzione, type RichiestaCambio, type Scelta, type StatoOpzione, type TipoEsito } from "./tipi";

// ── Aiuti ────────────────────────────────────────────────────────────────────

/** Un'ora del DB (UTC) in ora italiana: «15:00» se è di oggi, altrimenti «21/10 15:00». */
export function oraItaliana(utc: string | null, adesso: Date = new Date()): string {
  if (!utc) return "";
  const d = parseDbDate(utc);
  if (Number.isNaN(d.getTime())) return utc;
  const giorno = (x: Date) => x.toLocaleDateString("it-IT", { timeZone: FUSO_UTENTI });
  const ora = d.toLocaleTimeString("it-IT", { timeZone: FUSO_UTENTI, hour: "2-digit", minute: "2-digit" });
  if (giorno(d) === giorno(adesso)) return ora;
  const gm = d.toLocaleDateString("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit" });
  return `${gm} ${ora}`;
}

const esito = (tipo: TipoEsito, testo: string): StatoOpzione["esito"] => ({ tipo, testo });
const diSerieStato = (acceso: boolean | null, e: StatoOpzione["esito"], valore?: string): StatoOpzione => ({
  acceso, da: null, il: null, esito: e, ...(valore !== undefined ? { valore } : {}),
});
const daInterruttore = (s: StatoInterruttore, e: StatoOpzione["esito"]): StatoOpzione => ({ acceso: s.acceso, da: s.da, il: s.il, esito: e });

function tenant(): string {
  const t = getCurrentTenantCode();
  if (!t) throw new Error("contesto del cliente assente");
  return t;
}

function soloAcceso(r: RichiestaCambio): boolean {
  if (typeof r.acceso !== "boolean") throw new ErroreOpzione("Indica se accendere o spegnere", 400);
  return r.acceso;
}

function minuti(valore: string | undefined, scelte: ReadonlyArray<Scelta>): number {
  if (!valore || !scelte.some((s) => s.valore === valore)) throw new ErroreOpzione("Ritmo non ammesso", 400);
  return Number(valore);
}

function etichettaMinuti(m: number): string {
  if (m % 1440 === 0) return m === 1440 ? "ogni giorno" : `ogni ${m / 1440} giorni`;
  if (m % 60 === 0) return m === 60 ? "ogni ora" : `ogni ${m / 60} ore`;
  return `ogni ${m} minuti`;
}

const ritmi = (...m: number[]): Scelta[] => m.map((x) => ({ valore: String(x), etichetta: etichettaMinuti(x) }));
/** Il ritmo attuale, se non è fra le scelte, si aggiunge: la tendina dice sempre il vero. */
function conAttuale(scelte: Scelta[], attuale: number | null): Scelta[] {
  if (attuale === null || scelte.some((s) => s.valore === String(attuale))) return scelte;
  return [...scelte, { valore: String(attuale), etichetta: etichettaMinuti(attuale) }].sort((a, b) => Number(a.valore) - Number(b.valore));
}

// ── Letture degli apparati ───────────────────────────────────────────────────

const LETTURE_TESTI: Record<Lettura, { nome: string; cosa: string }> = {
  mikrotik: { nome: "Spanning tree, bridge e fasci dei MikroTik", cosa: "sei comandi print/monitor via SSH sui MikroTik" },
  mikrotik_scheda: { nome: "VLAN, DNS e utenti dei MikroTik", cosa: "interfacce VLAN, VLAN dei bridge, DNS, nomi utente" },
  switch_vlan: { nome: "VLAN degli switch via SNMP", cosa: "Q-BRIDGE: VLAN, porte tagged/untagged, PVID" },
  snmp: { nome: "Spanning tree, LLDP e fasci via SNMP", cosa: "gli switch che non sono MikroTik né del controller" },
  controller: { nome: "Campi del controller", cosa: "porte, fasci e vicini dal controller UniFi" },
  host: { nome: "LLDP e bond degli hypervisor", cosa: "dentro la lettura notturna degli hypervisor" },
  librenms: { nome: "Dati degli apparati da LibreNMS", cosa: "porte, vicini, VLAN, MAC, ARP, sensori e inventario dall'API di LibreNMS; aggiunge a LibreNMS i vicini con SNMP che risponde (spenta di serie)" },
};

/** Ordine della tavola. */
const ORDINE_LETTURE: readonly Lettura[] = ["mikrotik", "mikrotik_scheda", "switch_vlan", "snmp", "controller", "host", "librenms"];

function esitoLettura(l: Lettura, acceso: boolean): StatoOpzione["esito"] {
  if (!acceso) return esito("neutro", "spenta");
  const esiti = Object.values(leggiEsiti(l));
  if (esiti.length === 0) return esito("neutro", "nessun apparato letto finora");
  const ultima = esiti.map((e) => e.il).sort().at(-1) ?? null;
  const conErrori = esiti.filter((e) => e.riusciti < e.comandi).length;
  const n = esiti.length;
  const quanti = n === 1 ? "1 apparato" : `${n} apparati`;
  if (conErrori > 0) return esito("attenzione", `letta alle ${oraItaliana(ultima)} · ${conErrori} di ${n} con errori`);
  return esito("ok", `letta alle ${oraItaliana(ultima)} · ${quanti}`);
}

function opzioneLettura(l: Lettura): Opzione {
  const t = LETTURE_TESTI[l];
  return {
    id: `lettura.${l}`,
    gruppo: "letture",
    nome: t.nome,
    cosa: t.cosa,
    valePer: "cliente",
    forma: "levetta",
    diSerie: "accesa",
    spegnendo: {
      siFerma: `la lettura «${t.nome}» a ogni giro degli apparati.`,
      resta: "quanto già letto, che invecchia; le schede mostrano la data dell'ultima lettura.",
    },
    leggi() {
      const s = leggiInterruttore(l);
      return daInterruttore(s, esitoLettura(l, s.acceso));
    },
    cambia(r, chi) {
      const acceso = soloAcceso(r);
      if (acceso && !schemaCaviPresente()) throw new ErroreOpzione("Letture in più non disponibili: lo schema di questo cliente non è aggiornato");
      scriviInterruttore(l, acceso, chi);
    },
  };
}

// ── Job pianificati ──────────────────────────────────────────────────────────

/** I tipi che in Opzioni hanno UNA riga per tipo (non una per job): i quattro di serie, il controllo degli host, la pulizia. */
type TipoAggregato = TipoJobDiSerie | "known_host_check" | "pulizia_host";

const AGGREGATI: ReadonlyArray<{
  tipo: TipoAggregato;
  nome: string;
  cosa: string;
  diSerie: string;
  scelte?: Scelta[];
  ritmoFisso?: string;
  siFerma: string;
  accendendo?: string;
}> = [
  { tipo: "arp_poll", nome: "Giro ARP di router e switch", cosa: "tabelle ARP e MAC, e dentro le letture degli apparati qui sopra", diSerie: "acceso, ogni 30 minuti", scelte: ritmi(15, 30, 60, 120), siFerma: "la lettura di ARP e MAC, e con lei le letture di VLAN, bridge e spanning tree dei MikroTik e degli switch." },
  { tipo: "hypervisor_sync", nome: "Lettura degli hypervisor", cosa: "VM e nodi di Proxmox, VMware, Hyper-V", diSerie: "accesa, ogni notte", ritmoFisso: "ogni notte, 03:00", siFerma: "la lettura notturna di VM e nodi degli hypervisor, e con lei LLDP e bond degli host." },
  { tipo: "dns_resolve", nome: "Nomi DNS degli host", cosa: "rilegge i nomi degli host conosciuti", diSerie: "accesa, ogni giorno", scelte: ritmi(360, 720, 1440), siFerma: "la rilettura dei nomi DNS degli host." },
  { tipo: "fast_scan", nome: "Scansione veloce delle reti", cosa: "una per rete; manda offline gli host che non rispondono", diSerie: "accesa, ogni 12 ore", scelte: ritmi(720, 1440), siFerma: "la scansione veloce di ogni rete: host nuovi e host spariti si vedono solo con una scansione a mano." },
  { tipo: "known_host_check", nome: "Controllo degli host conosciuti", cosa: "uno per rete; avvisa quando un host conosciuto sparisce", diSerie: "acceso, uno per rete", siFerma: "il controllo degli host conosciuti: nessun avviso se un host sparisce." },
  { tipo: "pulizia_host", nome: "Pulizia notturna degli host assenti", cosa: "toglie gli host non visti da tempo (cancella righe)", diSerie: "spenta", ritmoFisso: "ogni notte, 04:00", siFerma: "la pulizia notturna: gli host assenti restano nell'elenco.", accendendo: "Ogni notte alle 04:00 si archiviano, senza anteprima, gli host offline da tempo e i vecchi IP di un MAC che ha cambiato indirizzo; le righe d'archivio oltre i 90 giorni si cancellano per sempre. L'anteprima di oggi è nella scheda Pulizia degli host assenti (Impostazioni › Sistema)." },
];

const TIPI_AGGREGATI = new Set<string>(AGGREGATI.map((a) => a.tipo)); // = TIPI_PER_TIPO di ancore.ts (lo prova ancore.test.ts)

function esitoGiro(jobs: ScheduledJob[], perRete: boolean): StatoOpzione["esito"] {
  const ultima = jobs.map((j) => j.last_run).filter((x): x is string => !!x).sort().at(-1) ?? null;
  const reti = perRete ? ` · ${jobs.length === 1 ? "1 rete" : `${jobs.length} reti`}` : "";
  if (!ultima) return esito("neutro", `non ancora girato${reti}`);
  return esito("ok", `girato alle ${oraItaliana(ultima)}${reti}`);
}

function opzioneAggregata(a: (typeof AGGREGATI)[number]): Opzione {
  const diSerie = eJobDiSerie(a.tipo);
  const perRete = a.tipo === "fast_scan" || a.tipo === "known_host_check";
  return {
    id: `job.${a.tipo}`,
    gruppo: "job",
    nome: a.nome,
    cosa: a.cosa,
    valePer: "cliente",
    forma: "levetta",
    diSerie: a.diSerie,
    scelte: a.scelte,
    accendendo: a.accendendo,
    tocchiJob: true,
    spegnendo: {
      siFerma: a.siFerma,
      resta: "tutto quello già letto, che invecchia.",
    },
    leggi() {
      const jobs = getScheduledJobs().filter((j) => j.job_type === a.tipo);
      const accesi = jobs.filter((j) => j.enabled === 1);
      const intervalli = [...new Set(jobs.map((j) => j.interval_minutes))];
      const valore = a.scelte && intervalli.length === 1 ? String(intervalli[0]) : undefined;
      const scelte = a.scelte ? conAttuale(a.scelte, intervalli.length === 1 ? intervalli[0] : null) : undefined;
      if (scelte) this.scelte = scelte;
      const l = diSerie ? lapide(a.tipo as TipoJobDiSerie) : null;
      if (jobs.length === 0) {
        if (l) return { acceso: false, da: l.da, il: l.il, esito: esito("neutro", "spento") };
        if (diSerie) {
          if (a.tipo === "fast_scan" && listNetworksLite().length === 0) return diSerieStato(false, esito("neutro", "nessuna rete"));
          return diSerieStato(false, esito("attenzione", "manca: nasce al prossimo avvio, o accendilo da qui"));
        }
        if (a.tipo === "known_host_check") return diSerieStato(false, esito("neutro", "nessuna rete"));
        return diSerieStato(false, esito("neutro", "spenta"));
      }
      if (accesi.length === 0) return { acceso: false, da: l?.da ?? null, il: l?.il ?? null, esito: esito("neutro", "spento"), ...(valore ? { valore } : {}) };
      let e = esitoGiro(accesi, perRete);
      if (accesi.length < jobs.length) e = esito("attenzione", `${jobs.length - accesi.length} di ${jobs.length} spenti · ${e.testo}`);
      if (a.tipo === "hypervisor_sync") {
        const h = getHypervisorSyncSchedule();
        if (h.hypervisors === 0) e = esito("attenzione", "mai girata: nessun hypervisor con credenziale");
      }
      return { acceso: true, da: null, il: null, esito: e, ...(valore ? { valore } : {}) };
    },
    cambia(r, chi) {
      const jobs = getScheduledJobs().filter((j) => j.job_type === a.tipo);
      if (r.valore !== undefined) {
        if (!a.scelte) throw new ErroreOpzione(`Il ritmo è fisso: ${a.ritmoFisso ?? "deciso dal sistema"}`, 400);
        const m = minuti(r.valore, conAttuale(a.scelte, null));
        for (const j of jobs) updateScheduledJobInterval(j.id, m);
      }
      if (r.acceso === undefined) return;
      if (a.tipo === "pulizia_host") return setPuliziaHostSchedule(r.acceso);
      if (a.tipo === "hypervisor_sync") {
        if (r.acceso) togliLapide("hypervisor_sync");
        else scriviLapide("hypervisor_sync", chi);
        return setHypervisorSyncSchedule(r.acceso);
      }
      for (const j of jobs) toggleJob(j.id, r.acceso);
      if (!diSerie) return;
      const tipo = a.tipo as TipoJobDiSerie;
      if (r.acceso) {
        togliLapide(tipo);
        seminaJobDiSerie(tipo);
      } else {
        scriviLapide(tipo, chi);
      }
    },
  };
}

const RITMI_GENERICI = ritmi(15, 30, 60, 120, 360, 720, 1440);

/** Un job che non è di un tipo aggregato né di un controller: una riga sua. */
function opzioneJob(j: ScheduledJob, reti: Map<number, string>): Opzione {
  const rete = j.network_id !== null ? reti.get(j.network_id) : undefined;
  const nome = scheduledJobLabel(j, ETICHETTE_JOB) + (rete ? ` · ${rete}` : "");
  const apparatiScelti = j.job_type === "apparati_scelti";
  return {
    id: `job.${j.id}`,
    gruppo: "job",
    nome,
    cosa: apparatiScelti ? "creato da Discovery; la frequenza si cambia da lì" : `job n. ${j.id}`,
    valePer: "cliente",
    forma: "levetta",
    diSerie: "creato da un amministratore",
    scelte: apparatiScelti ? undefined : conAttuale(RITMI_GENERICI, j.interval_minutes),
    configura: apparatiScelti ? { href: "/discovery", etichetta: "Modifica ›" } : undefined,
    tocchiJob: true,
    spegnendo: { siFerma: `il job «${nome}».`, resta: "il job, spento: si riaccende da qui." },
    leggi() {
      const corrente = getScheduledJobs().find((x) => x.id === j.id);
      if (!corrente) return diSerieStato(null, esito("errore", "job non più presente"));
      const acceso = corrente.enabled === 1;
      return {
        acceso, da: null, il: null,
        esito: acceso ? esitoGiro([corrente], false) : esito("neutro", "spento"),
        ...(apparatiScelti ? {} : { valore: String(corrente.interval_minutes) }),
      };
    },
    cambia(r) {
      if (r.valore !== undefined) {
        if (apparatiScelti) throw new ErroreOpzione("La frequenza di questo job si cambia da Discovery, con «Modifica»");
        updateScheduledJobInterval(j.id, minuti(r.valore, conAttuale(RITMI_GENERICI, j.interval_minutes)));
      }
      if (r.acceso !== undefined) toggleJob(j.id, r.acceso);
    },
  };
}

function opzioniController(): Opzione[] {
  const controllers = listControllerViews().filter((c) => c.kind !== "omada");
  if (controllers.length === 0) {
    return [{
      id: "controller.nessuno",
      gruppo: "job",
      nome: "Lettura degli apparati UniFi",
      cosa: "serve un controller",
      valePer: "cliente",
      forma: "levetta",
      diSerie: "spenta",
      configura: { href: "/controllers", etichetta: "Aggiungi controller ›" },
      leggi: () => diSerieStato(null, esito("neutro", "nessun controller")),
    }];
  }
  const scelteApparati = ritmi(15, 30, 60, 120, 360, 1440);
  const out: Opzione[] = [];
  for (const c of controllers) {
    out.push({
      id: `controller.${c.id}.apparati`,
      gruppo: "job",
      nome: `Lettura degli apparati UniFi · ${c.name}`,
      cosa: "apparati, porte e vicini dal controller",
      valePer: "cliente",
      forma: "levetta",
      diSerie: "spenta",
      scelte: scelteApparati,
      configura: { href: "/controllers", etichetta: "Controller ›" },
      tocchiJob: true,
      spegnendo: { siFerma: `la lettura degli apparati dal controller «${c.name}».`, resta: "quanto già letto, che invecchia." },
      leggi() {
        const job = listControllerScheduleJobs().find((x) => x.controller_id === c.id);
        if (!job) return diSerieStato(false, esito("neutro", c.enabled ? "spenta" : "controller spento"));
        const dettaglio = getScheduledJobs().find((x) => x.id === job.job_id);
        this.scelte = conAttuale(scelteApparati, job.interval_minutes);
        return {
          acceso: job.enabled === 1, da: null, il: null, valore: String(job.interval_minutes),
          esito: job.enabled === 1 && dettaglio ? esitoGiro([dettaglio], false) : esito("neutro", "spenta"),
        };
      },
      cambia(r) {
        const job = listControllerScheduleJobs().find((x) => x.controller_id === c.id);
        if (r.acceso === false) return setControllerSchedule(c.id, null);
        if (r.acceso === true && !c.enabled) throw new ErroreOpzione("Controller spento: accendilo prima dalla sua finestra");
        const m = r.valore !== undefined ? minuti(r.valore, conAttuale(scelteApparati, job?.interval_minutes ?? null)) : (job?.interval_minutes ?? 60);
        if (r.acceso === true || job) setControllerSchedule(c.id, m);
      },
    });
    out.push({
      id: `controller.${c.id}.client`,
      gruppo: "job",
      nome: `Lettura dei client UniFi · ${c.name}`,
      cosa: "i client collegati, ogni ora dalle 7 alle 20",
      valePer: "cliente",
      forma: "levetta",
      diSerie: "spenta",
      configura: { href: "/controllers", etichetta: "Controller ›" },
      tocchiJob: true,
      spegnendo: { siFerma: `la lettura dei client dal controller «${c.name}».`, resta: "i client già letti, che invecchiano." },
      leggi() {
        const job = listControllerClientScheduleJobs().find((x) => x.controller_id === c.id);
        if (!job) return diSerieStato(false, esito("neutro", "spenta"));
        const dettaglio = getScheduledJobs().find((x) => x.id === job.job_id);
        return {
          acceso: job.enabled === 1, da: null, il: null,
          esito: job.enabled === 1 && dettaglio ? esitoGiro([dettaglio], false) : esito("neutro", "spenta"),
        };
      },
      cambia(r) {
        const esitoCambio = setClientScheduleFor(c.id, soloAcceso(r));
        if (!esitoCambio.ok) throw new ErroreOpzione(esitoCambio.error, esitoCambio.status === 404 ? 409 : esitoCambio.status);
      },
    });
  }
  return out;
}

function opzioniJob(): Opzione[] {
  const statiche = AGGREGATI.map(opzioneAggregata);
  const reti = new Map(listNetworksLite().map((n) => [n.id, n.name || n.cidr]));
  const dinamiche = getScheduledJobs()
    .filter((j) => !TIPI_AGGREGATI.has(j.job_type) && j.job_type !== "unifi_sync")
    .map((j) => opzioneJob(j, reti));
  return [...statiche, ...opzioniController(), ...dinamiche];
}

// ── Moduli ───────────────────────────────────────────────────────────────────

function opzioneModuloInstallabile(key: UninstallableFeature, nome: string, cosa: string): Opzione {
  const copia = UNINSTALL_COPY[key];
  return {
    id: `modulo.${key}`,
    gruppo: "moduli",
    nome,
    cosa,
    valePer: "cliente",
    forma: "modulo",
    diSerie: "non installato",
    configura: { href: `/settings/moduli/${key}`, etichetta: key === "meshcentral" ? "Installa ›" : "Scheda ›" },
    spegnendo: { siFerma: copia.effetto, resta: copia.senzaCasella },
    async leggi() {
      const installato = key === "meshcentral" ? getMeshState().installed : (await getFeatureStatus(tenant(), key)).enabled;
      return diSerieStato(installato, installato ? esito("ok", "installato") : esito("neutro", "non installato"));
    },
    cambia(r) {
      const acceso = soloAcceso(r);
      // Da qui si disinstalla senza cancellare i dati: per cancellarli c'è la scheda del modulo.
      // MeshCentral si installa solo dalla sua scheda: l'assistente crea il server; il solo flag lo lascerebbe inservibile.
      if (acceso && key === "meshcentral") throw new ErroreOpzione("MeshCentral si installa dalla sua scheda: l'assistente crea il server sull'appliance");
      if (acceso) installaModulo(key, tenant(), null);
      else disinstallaModulo(key, tenant(), false);
    },
  };
}

function opzioniModuli(): Opzione[] {
  return [
    {
      id: "modulo.nis2_inventory",
      gruppo: "moduli",
      nome: "Inventario NIS2",
      cosa: "la pagina Servizi",
      valePer: "cliente",
      forma: "levetta",
      diSerie: "acceso",
      spegnendo: { siFerma: "la voce Servizi del menu.", resta: "i dati dell'inventario, che ricompaiono se lo riaccendi." },
      leggi() {
        const raw = getTenantSetting("nis2_inventory_enabled");
        const acceso = raw === null ? true : raw === "1" || raw === "true";
        return diSerieStato(acceso, acceso ? esito("ok", "attivo") : esito("neutro", "spento"));
      },
      cambia(r) {
        setTenantSetting("nis2_inventory_enabled", soloAcceso(r) ? "1" : "0");
      },
    },
    opzioneModuloInstallabile("patch_management", "Patch Management", "aggiornamenti Windows via WinRM e Chocolatey"),
    opzioneModuloInstallabile("inventory_agent", "Inventory Agent", "agente sui PC"),
    opzioneModuloInstallabile("meshcentral", "MeshCentral", "controllo remoto degli host"),
    {
      id: "modulo.network_services",
      gruppo: "moduli",
      nome: "Network Services",
      cosa: "DNS e DHCP dell'appliance",
      valePer: "cliente",
      forma: "modulo",
      diSerie: "non installato",
      configura: { href: "/settings/moduli/network_services", etichetta: "Installa ›" },
      spegnendo: {
        siFerma: "la gestione di DNS e DHCP da DA-IPAM; i parametri di collegamento si cancellano.",
        resta: "la VM dei servizi di rete, che continua a funzionare per conto suo.",
      },
      async leggi() {
        const s = await getNetServicesState(tenant());
        if (!s.enabled) return diSerieStato(false, esito("neutro", "non installato"));
        if (!s.configured) return diSerieStato(true, esito("attenzione", "installato ma non configurato"));
        return diSerieStato(true, esito("ok", "attivo"));
      },
      cambia(r) {
        if (soloAcceso(r)) throw new ErroreOpzione("Si installa dalla sua scheda: servono i dati della VM dei servizi di rete");
        uninstallNetServices(tenant());
      },
    },
    {
      id: "modulo.edge",
      gruppo: "moduli",
      nome: "Scanner-Edge",
      cosa: "vulnerabilità dalla sonda del cliente",
      valePer: "cliente",
      forma: "levetta",
      diSerie: "spento",
      configura: { href: "/settings/moduli/edge", etichetta: "Configura ›" },
      tocchiJob: true,
      spegnendo: { siFerma: "la sincronizzazione delle vulnerabilità dalla sonda.", resta: "le vulnerabilità già lette e la configurazione." },
      leggi() {
        const s = getVulnScannerStato();
        if (!s) return diSerieStato(null, esito("neutro", "non configurato"));
        if (s.autoDisabledAt) return diSerieStato(false, esito("errore", `spento da solo dopo errori (${oraItaliana(s.autoDisabledAt)})`));
        if (!s.enabled) return diSerieStato(false, esito("neutro", "spento"));
        if (s.lastError) return diSerieStato(true, esito("attenzione", "ultimo giro con errore"));
        return diSerieStato(true, s.lastSyncAt ? esito("ok", `sincronizzato alle ${oraItaliana(s.lastSyncAt)}`) : esito("neutro", "non ancora sincronizzato"));
      },
      cambia(r) {
        if (!setVulnScannerEnabled(soloAcceso(r))) throw new ErroreOpzione("Scanner-Edge non configurato: si configura dalla sua scheda");
      },
    },
    {
      id: "modulo.zabbix",
      gruppo: "moduli",
      nome: "Pannello Zabbix",
      cosa: "lettura dei problemi da Zabbix",
      valePer: "cliente",
      forma: "levetta",
      diSerie: "spento",
      configura: { href: "/settings/moduli/zabbix", etichetta: "Configura ›" },
      spegnendo: { siFerma: "la lettura dei problemi da Zabbix.", resta: "la configurazione e gli abbinamenti già verificati." },
      leggi() {
        const c = leggiConfigLettura(getTenantDb(tenant()));
        if (!c) return diSerieStato(null, esito("neutro", "non configurato"));
        if (!c.enabled) return diSerieStato(false, esito("neutro", "spento"));
        if (c.ultimoErrore) return diSerieStato(true, esito("attenzione", "ultima lettura con errore"));
        return diSerieStato(true, c.ultimaLetturaOk ? esito("ok", `letto alle ${oraItaliana(c.ultimaLetturaOk)}`) : esito("neutro", "non ancora letto"));
      },
      cambia(r, chi) {
        if (!impostaAccesoLettura(getTenantDb(tenant()), soloAcceso(r), chi)) {
          throw new ErroreOpzione("Pannello Zabbix non configurato: si configura dalla sua scheda");
        }
      },
    },
    {
      id: "modulo.mdm",
      gruppo: "moduli",
      nome: "MDM Headwind",
      cosa: "telefoni e tablet",
      valePer: "cliente",
      forma: "levetta",
      diSerie: "spento",
      configura: { href: "/settings/mdm", etichetta: "Configura ›" },
      tocchiJob: true,
      spegnendo: { siFerma: "la sincronizzazione di telefoni e tablet (il suo job si cancella).", resta: "la configurazione e i dispositivi già letti." },
      leggi() {
        const c = getMdmConfig();
        if (!c.base_url || !c.username) return diSerieStato(null, esito("neutro", "non configurato"));
        if (c.auto_disabled) return diSerieStato(false, esito("errore", "spento da solo dopo errori di sincronizzazione"));
        if (!c.enabled) return diSerieStato(false, esito("neutro", "spento"));
        return diSerieStato(true, c.last_success_at ? esito("ok", `sincronizzato alle ${oraItaliana(c.last_success_at)}`) : esito("neutro", "non ancora sincronizzato"));
      },
      cambia(r) {
        const c = getMdmConfig();
        if (!c.base_url || !c.username) throw new ErroreOpzione("MDM non configurato: si configura dalla sua scheda");
        saveMdmConfig({ base_url: c.base_url, username: c.username, user_field: c.user_field, enabled: soloAcceso(r) });
      },
    },
    {
      id: "modulo.wazuh",
      gruppo: "moduli",
      nome: "Wazuh",
      cosa: "SIEM, eventi e allarmi; si accende salvando la sua configurazione",
      valePer: "hub",
      forma: "modulo",
      diSerie: "spento",
      configura: { href: "/settings/moduli/wazuh", etichetta: "Configura ›" },
      leggi() {
        const c = getWazuhConfig();
        const configurato = Boolean(c.enabled && c.url && c.username && c.password);
        return configurato ? diSerieStato(true, esito("ok", "configurato")) : diSerieStato(null, esito("neutro", "non configurato"));
      },
    },
    ...(["librenms", "graylog"] as const).map((k): Opzione => ({
      id: `modulo.${k}`,
      gruppo: "moduli",
      nome: k === "librenms" ? "LibreNMS" : "Graylog",
      cosa: k === "librenms" ? "monitoraggio degli apparati; si accende configurandolo" : "raccolta dei log; si accende configurandolo",
      valePer: "hub",
      forma: "modulo",
      diSerie: "spento",
      configura: { href: `/settings/moduli/${k}`, etichetta: "Configura ›" },
      leggi() {
        const c = getIntegrationConfig(k);
        if (c.mode === "disabled") return diSerieStato(null, esito("neutro", "non configurato"));
        return diSerieStato(true, c.url ? esito("ok", c.mode === "appliance" ? "sull'appliance" : "esterno") : esito("attenzione", "senza indirizzo"));
      },
    })),
  ];
}

// ── Automatismi ──────────────────────────────────────────────────────────────

const valoreHubAcceso = (chiave: string): boolean => {
  const v = (getSetting(chiave) ?? "").trim();
  return v !== "0" && v !== "false";
};

function opzioniAutomatismi(): Opzione[] {
  return [
    {
      id: "automatismo.choco_automatico",
      gruppo: "automatismi",
      nome: "Chocolatey automatico",
      cosa: "installa Chocolatey sugli host Windows, ogni notte alle 02:00",
      valePer: "cliente",
      forma: "levetta",
      diSerie: "acceso",
      spegnendo: { siFerma: "l'installazione automatica di Chocolatey, di notte e al salvataggio delle credenziali WinRM.", resta: "Chocolatey dove è già installato." },
      async leggi() {
        const acceso = chocoAutomaticoAccesoDb(getTenantDb(tenant()));
        if (!acceso) return diSerieStato(false, esito("neutro", "spento"));
        const patch = (await getFeatureStatus(tenant(), "patch_management")).enabled;
        return diSerieStato(true, patch ? esito("ok", "attivo") : esito("neutro", "non agisce: Patch Management non installato"));
      },
      cambia(r) {
        impostaChocoAutomaticoDb(getTenantDb(tenant()), soloAcceso(r));
      },
    },
    {
      id: "automatismo.sonde_attribuzione",
      gruppo: "automatismi",
      nome: "Sonde di attribuzione",
      cosa: "riconoscono a chi appartiene un host",
      valePer: "hub",
      forma: "levetta",
      diSerie: "accese",
      spegnendo: { siFerma: "le sonde che riconoscono a chi appartiene un host, su tutte le reti di tutti i clienti.", resta: "le attribuzioni già fatte." },
      leggi() {
        const acceso = valoreHubAcceso("attribution_probes_enabled");
        return diSerieStato(acceso, acceso ? esito("ok", "attive") : esito("neutro", "spente"));
      },
      cambia(r) {
        setSetting("attribution_probes_enabled", soloAcceso(r) ? "1" : "0");
      },
    },
    {
      id: "automatismo.naabu",
      gruppo: "automatismi",
      nome: "Naabu prima di Nmap",
      cosa: "scoperta delle porte più veloce",
      valePer: "hub",
      forma: "levetta",
      diSerie: "spento",
      spegnendo: { siFerma: "Naabu: le porte le cerca solo Nmap, più lento.", resta: "le porte già trovate." },
      leggi() {
        const acceso = (getSetting("port_discovery") ?? "nmap").trim() === "naabu+nmap";
        return diSerieStato(acceso, acceso ? esito("ok", "Naabu e poi Nmap") : esito("neutro", "solo Nmap"));
      },
      cambia(r) {
        setSetting("port_discovery", soloAcceso(r) ? "naabu+nmap" : "nmap");
      },
    },
    {
      id: "automatismo.freno_offline",
      gruppo: "automatismi",
      nome: "Freno sul passaggio a offline",
      cosa: "blocca le cadute di massa invece di registrarle soltanto",
      valePer: "cliente",
      forma: "scelta",
      diSerie: "registra",
      scelte: [
        { valore: "registra", etichetta: "registra soltanto" },
        { valore: "applica", etichetta: "blocca le cadute di massa" },
      ],
      leggi() {
        const modo = impostazioniDa(getTenantSetting).modo;
        return diSerieStato(modo === "applica", esito("neutro", modo === "applica" ? "blocca le cadute di massa" : "registra soltanto"), modo);
      },
      cambia(r) {
        if (r.valore !== "registra" && r.valore !== "applica") throw new ErroreOpzione("Scelta non ammessa: registra oppure applica", 400);
        setTenantSetting(CHIAVE_MODO, r.valore);
      },
    },
    {
      id: "automatismo.senza_agente",
      gruppo: "automatismi",
      nome: "MeshCentral senza agente",
      cosa: "controllo remoto senza installare l'agente",
      valePer: "cliente",
      forma: "levetta",
      diSerie: "spento",
      spegnendo: { siFerma: "il desktop remoto senza agente (RDP e VNC dal server MeshCentral).", resta: "il controllo remoto con l'agente." },
      leggi() {
        const s = statoSenzaAgente();
        if (s.daAmbiente) return diSerieStato(true, esito("attenzione", "acceso da file (MESHCENTRAL_SENZA_AGENTE=1): da qui non si spegne"));
        return diSerieStato(s.attivo, esito(s.attivo ? "ok" : "neutro", s.attivo ? "attivo" : "spento"));
      },
      cambia(r) {
        const acceso = soloAcceso(r);
        if (statoSenzaAgente().daAmbiente) {
          throw new ErroreOpzione("Acceso da MESHCENTRAL_SENZA_AGENTE=1 in .env.local: si spegne togliendo quella riga e riavviando il servizio.");
        }
        setTenantSetting(CHIAVE_SENZA_AGENTE, acceso ? "1" : "0");
      },
    },
    {
      id: "automatismo.mappa_cavi",
      gruppo: "automatismi",
      nome: "Mappa nuova con i cavi",
      cosa: "cambia ciò che si vede sulla mappa",
      valePer: "cliente",
      forma: "levetta",
      diSerie: "spenta",
      spegnendo: { siFerma: "la mappa nuova: si torna a quella di prima.", resta: "i cavi letti, che tornano visibili se la riaccendi." },
      leggi() {
        const s = leggiMappaCavi();
        return daInterruttore(s, esito("neutro", s.acceso ? "mappa nuova" : "mappa di prima"));
      },
      cambia(r, chi) {
        const acceso = soloAcceso(r);
        if (acceso && !schemaCaviPresente()) throw new ErroreOpzione("Mappa nuova non disponibile: lo schema di questo cliente non è aggiornato");
        scriviMappaCavi(acceso, chi);
      },
    },
  ];
}

// ── Notifiche e uscite ───────────────────────────────────────────────────────

function opzioniNotificheUscite(): Opzione[] {
  const notifica = (
    id: string, nome: string, cosa: string, campo: "enabled" | "smtpEnabled" | "webhookEnabled", configura: boolean,
  ): Opzione => ({
    id,
    gruppo: "notifiche_uscite",
    nome,
    cosa,
    valePer: "hub",
    forma: "levetta",
    diSerie: "spento",
    configura: configura ? { href: "/settings?tab=notifiche", etichetta: "Configura ›" } : undefined,
    spegnendo: campo === "enabled"
      ? { siFerma: "l'invio degli allarmi dell'appliance, per tutti i clienti.", resta: "gli allarmi nella pagina." }
      : { siFerma: `l'invio sul ${nome.toLowerCase()}.`, resta: "la configurazione del canale." },
    leggi() {
      const c = getNotificationConfig();
      const acceso = c[campo];
      if (campo === "enabled") return diSerieStato(acceso, acceso ? esito("ok", "attive") : esito("attenzione", "gli allarmi restano solo nella pagina"));
      return diSerieStato(acceso, esito(acceso ? "ok" : "neutro", acceso ? "acceso" : "spento"));
    },
    cambia(r) {
      setNotificationConfig({ [campo]: soloAcceso(r) });
    },
  });
  return [
    notifica("notifiche.attive", "Notifiche", "invia gli allarmi dell'appliance", "enabled", false),
    notifica("notifiche.email", "Canale email", "SMTP", "smtpEnabled", true),
    notifica("notifiche.webhook", "Canale webhook", "una chiamata HTTP per allarme", "webhookEnabled", true),
    {
      id: "uscite.dalink_livello",
      gruppo: "notifiche_uscite",
      nome: "Cosa esce verso DA-Link",
      cosa: "solo lo stato, oppure stato e inventario",
      valePer: "cliente",
      forma: "scelta",
      diSerie: "solo lo stato",
      scelte: [
        { valore: "solo_stato", etichetta: "solo lo stato" },
        { valore: "stato_inventario", etichetta: "stato e inventario" },
      ],
      configura: { href: "/settings/cosa-esce", etichetta: "Dettagli ›" },
      leggi() {
        const riga = livelloAttuale();
        const valore = riga?.livello ?? "solo_stato";
        const s = statoSegnale();
        const e = !s?.tentato_il
          ? esito("neutro", "nessun segnale inviato")
          : s.esito === "ok"
            ? esito("ok", `ultimo segnale alle ${oraItaliana(s.ok_il ?? s.tentato_il)}`)
            : esito("errore", `ultimo segnale non riuscito (${oraItaliana(s.tentato_il)})`);
        return { acceso: true, valore, da: riga?.scelto_da ?? null, il: riga?.scelto_il ?? null, esito: e };
      },
      cambia(r, chi) {
        if (!eLivello(r.valore)) throw new ErroreOpzione("Livello non ammesso: solo_stato oppure stato_inventario", 400);
        impostaLivello(r.valore, chi);
        inviaAdesso().catch(() => {
          // L'esito del giro finisce nello stato del segnale, che la pagina rilegge.
        });
      },
    },
    {
      id: "uscite.vulcan",
      gruppo: "notifiche_uscite",
      nome: "Invio a DA-Vul-can",
      cosa: "AD Health, inventario, battito",
      valePer: "cliente",
      forma: "file",
      diSerie: "spento",
      dove: "Si accende quando DA-Link scrive il gettone nel file dell'appliance /etc/dalink/oggetto.env (riga VULCAN_TOKEN). Da qui non si cambia: è una chiave, non una preferenza.",
      leggi() {
        const c = leggiConfigVulcan();
        if (c.stato === "spento") return diSerieStato(false, esito("neutro", "spento: manca il gettone"));
        if (c.stato === "non_valida") return diSerieStato(false, esito("errore", `file non valido: ${c.motivo}`));
        return diSerieStato(true, esito("ok", "acceso"));
      },
    },
    {
      id: "uscite.dalink_segnale",
      gruppo: "notifiche_uscite",
      nome: "Segnale di vita verso DA-Link",
      cosa: "ogni 5 minuti",
      valePer: "cliente",
      forma: "file",
      diSerie: "spento",
      dove: "Si accende quando c'è il file dell'appliance /etc/dalink/oggetto.env (lo scrive l'installazione di DA-Link; il percorso si cambia con DALINK_OGGETTO_ENV).",
      leggi() {
        const c = leggiConfigDalink();
        if (c.stato === "assente") return diSerieStato(false, esito("neutro", "spento: nessun file di DA-Link"));
        if (c.stato === "non_valida") return diSerieStato(false, esito("errore", `file non valido: ${c.motivo}`));
        return diSerieStato(true, esito("ok", "acceso"));
      },
    },
  ];
}

// ── Da file dell'appliance ───────────────────────────────────────────────────

/** Le variabili d'ambiente che accendono o spengono una funzione: si leggono qui, si cambiano solo sul server. */
export const VOCI_DA_AMBIENTE: ReadonlyArray<{ variabile: string; nome: string; cosa: string; accesaSe: (v: string | undefined) => boolean; diSerie: string }> = [
  { variabile: "DA_INVENT_FINGERPRINT", nome: "Riconoscimento degli apparati", cosa: "firme di porte, SNMP e servizi", accesaSe: (v) => v !== "false", diSerie: "acceso" },
  { variabile: "DA_INVENT_FINGERPRINT_PROBES", nome: "Sonde attive del riconoscimento", cosa: "HTTP, SSH e SMB sugli host", accesaSe: (v) => v !== "false", diSerie: "accese" },
  { variabile: "DA_INVENT_SNMPWALK_CLI", nome: "snmpwalk da riga di comando", cosa: "letture SNMP lunghe col comando di sistema", accesaSe: (v) => v !== "false", diSerie: "acceso" },
  { variabile: "DA_INVENT_DNS_ALWAYS_REFRESH", nome: "DNS: rilettura forzata", cosa: "rilegge i nomi a ogni scansione", accesaSe: (v) => v === "true", diSerie: "spento" },
  { variabile: "DA_INVENT_DNS_CRON_REFRESH_STORED", nome: "DNS: aggiorna i nomi già salvati", cosa: "il job dei nomi DNS riscrive anche quelli che ci sono", accesaSe: (v) => v === "true", diSerie: "spento" },
  { variabile: "DA_INVENT_DNS_VERBOSE", nome: "DNS: registro dettagliato", cosa: "scrive nel registro ogni domanda DNS", accesaSe: (v) => v === "true", diSerie: "spento" },
  { variabile: "MESHCENTRAL_TLS_INSECURE", nome: "MeshCentral: TLS senza verifica", cosa: "accetta il certificato del server MeshCentral senza controllarlo", accesaSe: (v) => v === "1", diSerie: "spento" },
  { variabile: "TLS_REDIRECT", nome: "Redirect da HTTP a HTTPS", cosa: "chi apre in http viene mandato in https", accesaSe: (v) => v === "true", diSerie: "spento" },
  { variabile: "AUTH_TRUST_HOST", nome: "Fidarsi del nome dell'host", cosa: "l'accesso accetta il nome con cui si apre la pagina", accesaSe: (v) => v !== "false", diSerie: "acceso" },
];

/** Sempre accesi: nessun interruttore, partono da server.ts (spec §3.6). */
const SEMPRE_ACCESI: ReadonlyArray<{ id: string; nome: string; cosa: string }> = [
  { id: "sempre.backup", nome: "Backup notturno di hub e clienti", cosa: "alle 03:00; l'orario si cambia con DA_INVENT_BACKUP_CRON" },
  { id: "sempre.allarme_salute", nome: "Allarme sulla salute dell'appliance", cosa: "disco e Docker, ogni 30 minuti" },
  { id: "sempre.allarme_job_fermi", nome: "Allarme sui job fermi", cosa: "ogni 30 minuti" },
  { id: "sempre.correzioni_avvio", nome: "Correzioni dei job all'avvio", cosa: "frena le scansioni frequenti sulle reti grandi, crea i job di serie che mancano" },
];

function opzioniDaFile(): Opzione[] {
  const ambiente = VOCI_DA_AMBIENTE.map((v): Opzione => ({
    id: `file.${v.variabile.toLowerCase()}`,
    gruppo: "da_file",
    nome: v.nome,
    cosa: v.cosa,
    valePer: "hub",
    forma: "file",
    diSerie: v.diSerie,
    dove: `Riga ${v.variabile} nel file .env.local dell'appliance, poi riavvio del servizio.`,
    leggi() {
      const acceso = v.accesaSe(process.env[v.variabile]);
      return diSerieStato(acceso, esito(acceso ? "ok" : "neutro", acceso ? "acceso" : "spento"));
    },
  }));
  const sempre = SEMPRE_ACCESI.map((s): Opzione => ({
    id: s.id,
    gruppo: "da_file",
    nome: s.nome,
    cosa: s.cosa,
    valePer: "hub",
    forma: "file",
    diSerie: "sempre acceso",
    dove: "Gira sempre: non ha un interruttore.",
    leggi: () => diSerieStato(true, esito("ok", "sempre acceso")),
  }));
  return [...ambiente, ...sempre];
}

// ── Il catalogo ──────────────────────────────────────────────────────────────

/** Un gruppo che non si riesce nemmeno a elencare diventa una riga d'errore: il resto della pagina regge. */
function gruppoSicuro(gruppo: Opzione["gruppo"], costruisci: () => Opzione[]): Opzione[] {
  try {
    return costruisci();
  } catch (e) {
    return [{
      id: `errore.${gruppo}`,
      gruppo,
      nome: "Elenco non leggibile",
      cosa: "le opzioni di questo gruppo non si sono potute elencare",
      valePer: "cliente",
      forma: "file",
      diSerie: "",
      leggi: () => ({ acceso: null, da: null, il: null, esito: { tipo: "errore", testo: `stato illeggibile (${codiceErrore(e)})` } }),
    }];
  }
}

/** Tutte le opzioni del cliente corrente, nell'ordine della tavola. Le righe dei job dipendono dai job del cliente. */
export function catalogo(): Opzione[] {
  return [
    ...gruppoSicuro("letture", () => ORDINE_LETTURE.map(opzioneLettura)),
    ...gruppoSicuro("job", opzioniJob),
    ...gruppoSicuro("moduli", opzioniModuli),
    ...gruppoSicuro("automatismi", opzioniAutomatismi),
    ...gruppoSicuro("notifiche_uscite", opzioniNotificheUscite),
    ...gruppoSicuro("da_file", opzioniDaFile),
  ];
}

/** Gli id delle letture, per la prova di completezza (devono essere tutte quelle di `LETTURE`). */
export const ID_LETTURE: readonly string[] = LETTURE.map((l) => `lettura.${l}`);
/** I tipi di job di serie, per la prova. */
export const TIPI_DI_SERIE: readonly string[] = JOB_DI_SERIE.map((j) => j.tipo);

/** Il codice di un errore, per la riga «stato illeggibile (codice)»: mai il messaggio intero, che può avere percorsi. */
function codiceErrore(e: unknown): string {
  if (e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string") return (e as { code: string }).code;
  if (e instanceof Error) return e.name;
  return "errore";
}

/** Lo stato di un'opzione; una `leggi` che lancia dà la riga d'errore, mai un'eccezione né «spenta» per ripiego. */
export async function leggiStato(o: Opzione): Promise<StatoOpzione> {
  try {
    return await o.leggi();
  } catch (e) {
    return { acceso: null, da: null, il: null, esito: { tipo: "errore", testo: `stato illeggibile (${codiceErrore(e)})` } };
  }
}

export async function leggiTutte(opzioni: Opzione[] = catalogo()): Promise<Array<{ opzione: Opzione; stato: StatoOpzione }>> {
  const out: Array<{ opzione: Opzione; stato: StatoOpzione }> = [];
  for (const opzione of opzioni) out.push({ opzione, stato: await leggiStato(opzione) });
  return out;
}
