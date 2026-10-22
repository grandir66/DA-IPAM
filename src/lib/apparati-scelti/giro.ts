/**
 * Il giro del job `apparati_scelti` (piano 2026-10-22 scansione automatica, Task 5). Nessuna lettura sua: chiama quelle di
 * «Aggiorna» (informazioni) e del giro ARP (porte e MAC, VLAN). Per ogni apparato del job, in ordine e uno alla volta:
 * l'idoneità si ricontrolla qui (decisione 13: tolto o credenziale persa → «escluso» col motivo, l'apparato resta nel job);
 * il lucchetto per apparato è quello del giro ARP e di «Interroga» (occupato → «saltato», non si aspetta); solo le letture
 * scelte e valide per il tipo; al più TEMPO_APPARATO_MS per apparato, poi il prossimo. Un esito per apparato in
 * `job_apparati_esiti` (l'ultimo giro). Log, esiti e motivo: numeri, id e codici, mai nomi o IP (decisione 14).
 */
import {
  cancellaEsitiOrfani,
  getNetworkDevices,
  getNetworks,
  getScheduledJobById,
  scriviEsitiGiro,
  statoApparatiPerDevice,
} from "@/lib/db-tenant";
import {
  leggiApparatoArp,
  letturaSchedaMikrotik,
  letturaVlanSwitch,
  vlanSwitchDaLeggere,
  type ContestoArp,
  type RunArpPollOptions,
} from "@/lib/cron/jobs";
import { leggiInfoApparato } from "@/lib/devices/lettura-info";
import { conLucchettoApparato, entroTempoApparato, TEMPO_APPARATO_MS } from "@/lib/devices/lucchetto-apparato";
import { codiceTrasporto } from "@/lib/devices/mikrotik-letture";
import type { EsitoGiro } from "@/lib/topology/letture/cadenza";
import { oraUtc } from "@/lib/topology/letture/interruttori";
import type { NetworkDevice } from "@/types";
import {
  LETTURE,
  leggiConfig,
  lettureValide,
  valutaApparato,
  type EsitoLettura,
  type Lettura,
  type StatoEsito,
} from "./regole";

export { TEMPO_APPARATO_MS };

export interface OpzioniGiro extends Pick<RunArpPollOptions, "creaClientRouter" | "creaClientSwitch" | "creaWalkSnmp" | "apriEsecutore" | "adesso"> {
  /** Solo per le prove: la lettura delle informazioni al posto di quella vera. */
  leggiInfo?: typeof leggiInfoApparato;
  /** Solo per le prove: il tempo massimo per apparato. */
  tempoApparatoMs?: number;
}

export interface EsitoGiroApparati {
  /** Apparati con almeno una lettura riuscita (`ok` + `parziale`). */
  letti: number;
  /** Apparati del job, esclusi compresi. */
  totale: number;
  esclusi: number;
  /** Per ogni lettura: quanti apparati l'hanno letta su quanti l'hanno tentata (spenta e non valida non contano). */
  perLettura: Record<Lettura, { letti: number; su: number }>;
}

type Riga = { device_id: number; stato: StatoEsito; letture: Record<string, EsitoLettura>; motivo: string | null };

/** L'esito di una lettura con la cadenza (VLAN): spenta non è un errore (caso 4 del piano); gli altri salti sì, col codice. */
function daEsitoGiro(e: EsitoGiro<unknown>): EsitoLettura {
  if (e.stato === "letto") return { stato: "letto" };
  if (e.stato === "errore") return { stato: "errore", codice: e.esito.codice ?? "ERRORE" };
  return e.motivo === "spenta" ? { stato: "spenta" } : { stato: "errore", codice: e.motivo.toUpperCase() };
}

/**
 * Le letture scelte di un apparato incluso, in ordine (info, porte e MAC, VLAN). Ognuna scrive il suo esito in `out`
 * appena finisce: allo scadere del tempo chi chiama fotografa quelle già fatte. Un errore di una non ferma le altre.
 */
async function leggiApparato(device: NetworkDevice, daLeggere: Lettura[], out: Record<string, EsitoLettura>,
  opzioni: OpzioniGiro, ctx: ContestoArp, tempoMs: number): Promise<void> {
  const arp: RunArpPollOptions = {
    creaClientRouter: opzioni.creaClientRouter,
    creaClientSwitch: opzioni.creaClientSwitch,
    creaWalkSnmp: opzioni.creaWalkSnmp,
    apriEsecutore: opzioni.apriEsecutore,
    adesso: opzioni.adesso,
  };
  for (const l of daLeggere) {
    try {
      if (l === "info") {
        const r = await (opzioni.leggiInfo ?? leggiInfoApparato)(device, undefined, { tempoMs });
        out.info = r.stato === "letto" ? { stato: "letto" }
          : r.stato === "vuoto" ? { stato: "errore", codice: "NESSUN_DATO" }
          : { stato: "errore", codice: r.codice };
      } else if (l === "porte_mac") {
        // `vlan: "no"`: la VLAN la fa il job qui sotto, solo se scelta (decisione 8).
        await leggiApparatoArp(device, ctx, { ...arp, vlan: "no", tempoMs });
        out.porte_mac = { stato: "letto" };
      } else {
        // Senza la cadenza oraria (scelta esplicita di un admin), ma dietro l'interruttore: spenta resta spenta.
        const e = vlanSwitchDaLeggere(device)
          ? await letturaVlanSwitch(device, arp, { ignoraCadenza: true })
          : await letturaSchedaMikrotik(device, arp, { ignoraCadenza: true });
        out.vlan = daEsitoGiro(e);
      }
    } catch (err) {
      out[l] = { stato: "errore", codice: codiceTrasporto(err) };
    }
  }
}

/** Lo stato della riga dalle letture tentate: tutte lette → ok, alcune → parziale, nessuna → errore. */
function statoRiga(letture: Record<string, EsitoLettura>): StatoEsito {
  const tentate = Object.values(letture).filter((e) => e.stato === "letto" || e.stato === "errore");
  const lette = tentate.filter((e) => e.stato === "letto").length;
  if (tentate.length === 0) return "saltato"; // niente da leggere: tutte spente o non valide
  return lette === tentate.length ? "ok" : lette > 0 ? "parziale" : "errore";
}

export async function runApparatiScelti(jobId: number, opzioni: OpzioniGiro = {}): Promise<EsitoGiroApparati> {
  const job = getScheduledJobById(jobId);
  if (!job) throw new Error(`Job #${jobId} non trovato`);
  const cfg = leggiConfig(job.config);
  if (!cfg) throw new Error(`Config del job non valida (job #${jobId})`);
  const tempoMs = opzioni.tempoApparatoMs ?? TEMPO_APPARATO_MS;
  const giroIl = oraUtc(opzioni.adesso?.() ?? new Date());

  cancellaEsitiOrfani();
  const stati = statoApparatiPerDevice(cfg.device_ids);
  const idsInclusi = new Set<number>();
  for (const id of cfg.device_ids) {
    const s = stati.get(id);
    if (s && valutaApparato(s).incluso) idsInclusi.add(id);
  }
  // I record completi solo per gli inclusi, in una query (niente N+1): le letture vogliono l'apparato intero.
  const apparati = new Map(idsInclusi.size > 0 ? getNetworkDevices().filter((d) => idsInclusi.has(d.id)).map((d) => [d.id, d]) : []);
  const ctx: ContestoArp = { networks: idsInclusi.size > 0 ? getNetworks() : [], enrichSet: null, porteNonLette: [], esitiLetture: [] };
  const scelte = LETTURE.filter((l) => cfg.cosa[l]);

  const righe: Riga[] = [];
  const perLettura: EsitoGiroApparati["perLettura"] = { info: { letti: 0, su: 0 }, porte_mac: { letti: 0, su: 0 }, vlan: { letti: 0, su: 0 } };
  for (const id of cfg.device_ids) {
    const s = stati.get(id);
    const v = s ? valutaApparato(s) : ({ incluso: false, motivo: "TOLTO" } as const);
    const device = apparati.get(id);
    if (!v.incluso || !s || !device) {
      righe.push({ device_id: id, stato: "escluso", letture: {}, motivo: v.incluso ? "TOLTO" : v.motivo });
      continue;
    }
    const valide = lettureValide(s.tipo);
    const letture: Record<string, EsitoLettura> = {};
    for (const l of scelte) if (!valide.includes(l)) letture[l] = { stato: "non_valida" };
    const daLeggere = scelte.filter((l) => valide.includes(l));

    const parziali: Record<string, EsitoLettura> = {};
    let motivo: string | null = null;
    try {
      const r = await conLucchettoApparato(id, () => entroTempoApparato(leggiApparato(device, daLeggere, parziali, opzioni, ctx, tempoMs), tempoMs));
      if (r.stato === "occupato") {
        righe.push({ device_id: id, stato: "saltato", letture: {}, motivo: "OCCUPATO" });
        console.info(`[apparati_scelti] job #${jobId}, apparato #${id}: saltato, lettura già in corso`);
        continue;
      }
    } catch (err) {
      // Tempo scaduto (l'unico errore che arriva fin qui): le letture finite restano, le altre sono TEMPO_SCADUTO.
      motivo = codiceTrasporto(err);
    }
    // Fotografia: una lettura rimasta appesa dopo il tempo massimo non cambia più l'esito di questo giro.
    for (const l of daLeggere) letture[l] = parziali[l] ? { ...parziali[l] } : { stato: "errore", codice: motivo ?? "ERRORE" };
    const stato = statoRiga(letture);
    righe.push({ device_id: id, stato, letture, motivo: stato === "saltato" ? "NIENTE_DA_LEGGERE" : motivo });
    for (const l of daLeggere) {
      const e = letture[l];
      if (e.stato === "spenta") continue;
      perLettura[l].su++;
      if (e.stato === "letto") perLettura[l].letti++;
    }
    if (stato !== "ok") {
      const codici = daLeggere.filter((l) => letture[l].stato === "errore").map((l) => `${l} ${letture[l].codice ?? "ERRORE"}`);
      console.warn(`[apparati_scelti] job #${jobId}, apparato #${id}: ${stato}${codici.length ? ` (${codici.join(", ")})` : ""}`);
    }
  }

  scriviEsitiGiro(jobId, giroIl, righe);
  const esclusi = righe.filter((r) => r.stato === "escluso").length;
  const letti = righe.filter((r) => r.stato === "ok" || r.stato === "parziale").length;
  const n = (l: Lettura) => `${perLettura[l].letti}/${perLettura[l].su}`;
  console.info(`[Scheduler] apparati_scelti #${jobId}: ${letti} letti su ${righe.length - esclusi}, ${esclusi} esclusi; `
    + `info ${n("info")}, porte ${n("porte_mac")}, vlan ${n("vlan")}`);
  return { letti, totale: righe.length, esclusi, perLettura };
}

/** Il motivo per lo scheduler (decisione 12), in numeri: «2 letti su 3; 1 escluso». */
export function motivoGiroApparati(r: EsitoGiroApparati): string {
  const base = `${r.letti} letti su ${r.totale - r.esclusi}`;
  return r.esclusi > 0 ? `${base}; ${r.esclusi} ${r.esclusi === 1 ? "escluso" : "esclusi"}` : base;
}
