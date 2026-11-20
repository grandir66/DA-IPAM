/**
 * Abitudini e anomalie del traffico (20/11/2026). IPAM conosce gli host: le anomalie si
 * calcolano qui, non sul collector.
 *
 * `valutaFinestra` e `volumeAnomalo` sono pure (nessun database): le regole e le soglie
 * stanno lì e si provano da sole. Il resto del file le aggancia al database del tenant.
 *
 * Regole da non rompere:
 * - una rete nei primi 14 giorni è «in apprendimento»: le sue coppie entrano nelle
 *   abitudini senza avvisi. `vlan_chiuse` e `non_censito` non aspettano;
 * - un'anomalia segnata «normale» non torna «nuova», nemmeno se il fatto si ripete.
 */
import type Database from "better-sqlite3";
import { getAllHostsFlat, getCelleMatrice, getNetworks } from "@/lib/db-tenant";
import { isIpInCidr } from "@/lib/utils";
import { eImpianto } from "@/lib/vuln/impianti-in-rete";
import type { DopoFinestra, RigaCollector } from "./lettura";

export type TipoAnomalia = "coppia_nuova" | "porta_nuova" | "molti_contatti" | "impianto"
  | "vlan_chiuse" | "volume" | "non_censito";
export const TIPI_ANOMALIA: readonly TipoAnomalia[] = ["coppia_nuova", "porta_nuova", "molti_contatti", "impianto", "vlan_chiuse", "volume", "non_censito"];
export type StatoAnomalia = "nuova" | "vista" | "normale";
export const STATI_ANOMALIA: readonly StatoAnomalia[] = ["nuova", "vista", "normale"];

export const SOGLIA_MOLTI_CONTATTI = 30;
export const GIORNI_APPRENDIMENTO = 14;
export const VOLUME_VOLTE = 5;
export const VOLUME_MINIMO_BYTE = 500 * 1024 * 1024;
export const VOLUME_GIORNI_MINIMI = 7;
/** Rete «nessuna»: gli IP fuori dalle reti censite fanno l'apprendimento insieme. */
export const RETE_NESSUNA = 0;

export const ESTERNO = "esterno";
export const DIFFUSIONE = "diffusione";
const interno = (ip: string): boolean => ip !== ESTERNO && ip !== DIFFUSIONE && ip !== "";

export interface CoppiaFinestra {
  client: string;
  server: string;
  proto: number;
  porta: number;
  byte: number;
  esterni: number;
}
export interface AnomaliaNuova {
  tipo: TipoAnomalia;
  gravita: 1 | 2 | 3;
  client: string;
  server: string;
  proto: number;
  porta: number;
  dettaglio: Record<string, string | number | boolean>;
}
export interface IngressoFinestra {
  coppie: CoppiaFinestra[];              // le righe di una finestra di 5 minuti
  abitudini: Set<string>;                // chiave `${client}|${server}|${proto}|${porta}`
  serverNoti: Map<string, Set<number>>;  // server → porte già viste
  retiInApprendimento: Set<number>;      // network_id ancora nei 14 giorni
  reteDi: (ip: string) => number | null;
  impianti: Set<string>;                 // IP con eImpianto
  censiti: Set<string>;
  chiuse: Set<string>;                   // `${reteA}|${reteB}` dalla matrice di segmentazione
}

export const chiaveCoppia = (c: { client: string; server: string; proto: number; porta: number }): string =>
  `${c.client}|${c.server}|${c.proto}|${c.porta}`;

export function valutaFinestra(ingresso: IngressoFinestra): AnomaliaNuova[] {
  const { coppie, abitudini, serverNoti, retiInApprendimento, reteDi, impianti, censiti, chiuse } = ingresso;
  const uscite = new Map<string, AnomaliaNuova>();
  const metti = (a: AnomaliaNuova) => {
    const k = `${a.tipo}|${chiaveCoppia(a)}`;
    if (!uscite.has(k)) uscite.set(k, a);
  };
  const inApprendimento = (ip: string): boolean => retiInApprendimento.has(reteDi(ip) ?? RETE_NESSUNA);
  const contatti = new Map<string, Set<string>>();

  for (const c of coppie) {
    const ci = interno(c.client);
    const si = interno(c.server);
    const base = { client: c.client, server: c.server, proto: c.proto, porta: c.porta };

    // Non aspettano l'apprendimento.
    for (const ip of [ci ? c.client : "", si ? c.server : ""]) {
      // Solo dentro una rete censita: fuori, ogni indirizzo di passaggio sarebbe un avviso.
      if (ip && !censiti.has(ip) && reteDi(ip) !== null) {
        metti({ tipo: "non_censito", gravita: 2, client: ip, server: "", proto: 0, porta: 0, dettaglio: {} });
      }
    }
    if (ci && si) {
      const ra = reteDi(c.client);
      const rb = reteDi(c.server);
      if (ra !== null && rb !== null && ra !== rb && chiuse.has(`${ra}|${rb}`)) {
        metti({ tipo: "vlan_chiuse", gravita: 3, ...base, dettaglio: { rete_client: ra, rete_server: rb } });
      }
      let visti = contatti.get(c.client);
      if (!visti) contatti.set(c.client, (visti = new Set()));
      visti.add(c.server);
    }

    // Da qui in giù, la rete di chi apre la connessione deve aver finito l'apprendimento.
    if (inApprendimento(ci ? c.client : c.server)) continue;
    const nuova = !abitudini.has(chiaveCoppia(c));
    const diImpianto = (ci && impianti.has(c.client)) || (si && impianti.has(c.server));
    const versoFuori = c.client === ESTERNO || c.server === ESTERNO;
    if (diImpianto && ((nuova && ci && si) || versoFuori)) {
      metti({ tipo: "impianto", gravita: 3, ...base, dettaglio: versoFuori ? { esterni: c.esterni } : {} });
      continue; // una coppia, un avviso: il più grave
    }
    if (!nuova || !ci || !si) continue;
    const porte = serverNoti.get(c.server);
    if (porte && c.porta !== 0 && !porte.has(c.porta)) {
      metti({ tipo: "porta_nuova", gravita: 2, ...base, dettaglio: {} });
    } else {
      metti({ tipo: "coppia_nuova", gravita: 1, ...base, dettaglio: {} });
    }
  }

  for (const [client, server] of contatti) {
    if (server.size >= SOGLIA_MOLTI_CONTATTI && !inApprendimento(client)) {
      metti({ tipo: "molti_contatti", gravita: 3, client, server: "", proto: 0, porta: 0, dettaglio: { server: server.size } });
    }
  }
  return [...uscite.values()];
}

/** Volume lontano dall'abitudine: più di 5 volte la mediana dei giorni prima E più di 500 MB. */
export function volumeAnomalo(byteDelGiorno: number, giorniPrima: number[]): { mediana: number } | null {
  if (giorniPrima.length < VOLUME_GIORNI_MINIMI || byteDelGiorno <= VOLUME_MINIMO_BYTE) return null;
  const o = [...giorniPrima].sort((a, b) => a - b);
  const m = o.length % 2 ? o[(o.length - 1) / 2] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2;
  return byteDelGiorno > VOLUME_VOLTE * m ? { mediana: Math.round(m) } : null;
}

// ── Aggancio al database del tenant ──────────────────────────────────────────

/** `inizio` meno 14 giorni, nello stesso formato (`AAAA-MM-GG HH:MM:SS`, UTC). */
function quattordiciGiorniPrima(inizio: string): string {
  const t = Date.parse(inizio.replace(" ", "T") + "Z") - GIORNI_APPRENDIMENTO * 86_400_000;
  return new Date(t).toISOString().slice(0, 19).replace("T", " ");
}

export function scriviAnomalie(d: Database.Database, quando: string, anomalie: AnomaliaNuova[]): void {
  // Sul conflitto lo stato non si tocca: una «normale» resta normale.
  const ins = d.prepare(`
    INSERT INTO traffico_anomalie (tipo, gravita, client, server, proto, porta, dettaglio, prima_vista, ultima_vista)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tipo, client, server, proto, porta) DO UPDATE SET
      conteggio = traffico_anomalie.conteggio + 1,
      ultima_vista = MAX(traffico_anomalie.ultima_vista, excluded.ultima_vista),
      dettaglio = excluded.dettaglio`);
  for (const a of anomalie) ins.run(a.tipo, a.gravita, a.client, a.server, a.proto, a.porta, JSON.stringify(a.dettaglio), quando, quando);
}

/**
 * Il lavoro da fare dopo ogni finestra scritta: valutare, scrivere le anomalie, poi mettere le
 * coppie nelle abitudini. Reti, host e matrice si leggono una volta per giro, non per finestra.
 */
export function creaRegistratore(): DopoFinestra {
  const reti = getNetworks().map((n) => ({ id: n.id, cidr: n.cidr }));
  const memoRete = new Map<string, number | null>();
  const reteDi = (ip: string): number | null => {
    if (!interno(ip)) return null;
    let r = memoRete.get(ip);
    if (r === undefined) {
      r = reti.find((n) => isIpInCidr(ip, n.cidr))?.id ?? null;
      memoRete.set(ip, r);
    }
    return r;
  };
  const host = getAllHostsFlat();
  const censiti = new Set(host.map((h) => h.ip));
  const impianti = new Set(host.filter((h) => eImpianto(h)).map((h) => h.ip));
  const chiuse = new Set<string>();
  for (const c of getCelleMatrice()) {
    if (c.rete_sorgente !== null && c.rete_bersaglio !== null && c.totale > 0 && c.raggiunti === 0) {
      chiuse.add(`${c.rete_sorgente}|${c.rete_bersaglio}`);
    }
  }

  return (d: Database.Database, inizio: string, righe: RigaCollector[]) => {
    const haAbitudine = d.prepare("SELECT 1 FROM traffico_abitudini WHERE client = ? AND server = ? AND proto = ? AND porta = ?");
    const porteDi = d.prepare("SELECT DISTINCT porta FROM traffico_abitudini WHERE server = ?").pluck();
    const reteVista = d.prepare("SELECT prima_vista FROM traffico_reti WHERE network_id = ?").pluck();
    const nuovaRete = d.prepare("INSERT OR IGNORE INTO traffico_reti (network_id, prima_vista) VALUES (?, ?)");
    const nuovaAbitudine = d.prepare("INSERT OR IGNORE INTO traffico_abitudini (client, server, proto, porta, prima_vista) VALUES (?, ?, ?, ?, ?)");

    const abitudini = new Set<string>();
    const serverNoti = new Map<string, Set<number>>();
    const retiInApprendimento = new Set<number>();
    const soglia = quattordiciGiorniPrima(inizio);
    for (const r of righe) {
      if (haAbitudine.get(r.client, r.server, r.proto, r.porta)) abitudini.add(chiaveCoppia(r));
      if (interno(r.server) && !serverNoti.has(r.server)) {
        const porte = porteDi.all(r.server) as number[];
        if (porte.length > 0) serverNoti.set(r.server, new Set(porte));
      }
      const rete = reteDi(interno(r.client) ? r.client : r.server) ?? RETE_NESSUNA;
      let prima = reteVista.get(rete) as string | undefined;
      if (prima === undefined) {
        nuovaRete.run(rete, inizio);
        prima = inizio;
      }
      if (prima > soglia) retiInApprendimento.add(rete);
    }
    scriviAnomalie(d, inizio, valutaFinestra({ coppie: righe, abitudini, serverNoti, retiInApprendimento, reteDi, impianti, censiti, chiuse }));
    for (const r of righe) nuovaAbitudine.run(r.client, r.server, r.proto, r.porta, inizio);
  };
}

/**
 * Anomalia di volume, una volta al giorno sul giorno appena chiuso (`giorno`, AAAA-MM-GG).
 * Il totale di un host si fa collector per collector e si prende il massimo (stesso flusso
 * visto da due punti di ascolto). Ritorna quante ne ha scritte.
 */
export function calcolaVolumi(d: Database.Database, giorno: string): number {
  const righe = d.prepare(`
    SELECT giorno, ip, MAX(byte) AS byte FROM (
      SELECT giorno, collector_id, ip, SUM(byte) AS byte FROM (
        SELECT giorno, collector_id, client AS ip, byte FROM traffico_coppie WHERE giorno BETWEEN date(?, '-14 days') AND ?
        UNION ALL
        SELECT giorno, collector_id, server AS ip, byte FROM traffico_coppie WHERE giorno BETWEEN date(?, '-14 days') AND ?)
      WHERE ip NOT IN ('esterno', 'diffusione') GROUP BY giorno, collector_id, ip)
    GROUP BY giorno, ip`).all(giorno, giorno, giorno, giorno) as { giorno: string; ip: string; byte: number }[];
  const oggi = new Map<string, number>();
  const prima = new Map<string, number[]>();
  for (const r of righe) {
    if (r.giorno === giorno) oggi.set(r.ip, r.byte);
    else prima.set(r.ip, [...(prima.get(r.ip) ?? []), r.byte]);
  }
  const trovate: AnomaliaNuova[] = [];
  for (const [ip, byte] of oggi) {
    const v = volumeAnomalo(byte, prima.get(ip) ?? []);
    if (v) trovate.push({ tipo: "volume", gravita: 2, client: ip, server: "", proto: 0, porta: 0, dettaglio: { byte, mediana: v.mediana, giorno } });
  }
  d.transaction(() => scriviAnomalie(d, `${giorno} 23:59:59`, trovate))();
  return trovate.length;
}

export interface AnomaliaTraffico {
  id: number;
  tipo: TipoAnomalia;
  gravita: number;
  client: string;
  server: string;
  proto: number;
  porta: number;
  dettaglio: Record<string, unknown>;
  prima_vista: string;
  ultima_vista: string;
  conteggio: number;
  stato: StatoAnomalia;
}

export const ANOMALIE_PER_PAGINA = 50;

export function elencoAnomalie(
  d: Database.Database,
  filtro: { stato?: StatoAnomalia; tipo?: TipoAnomalia; pagina?: number },
): { anomalie: AnomaliaTraffico[]; totale: number; pagina: number; perPagina: number } {
  const dove: string[] = [];
  const valori: string[] = [];
  if (filtro.stato) { dove.push("stato = ?"); valori.push(filtro.stato); }
  if (filtro.tipo) { dove.push("tipo = ?"); valori.push(filtro.tipo); }
  const where = dove.length ? `WHERE ${dove.join(" AND ")}` : "";
  const pagina = Math.max(1, Math.trunc(filtro.pagina ?? 1));
  const totale = (d.prepare(`SELECT COUNT(*) AS n FROM traffico_anomalie ${where}`).get(...valori) as { n: number }).n;
  const righe = d.prepare(`
    SELECT id, tipo, gravita, client, server, proto, porta, dettaglio, prima_vista, ultima_vista, conteggio, stato
    FROM traffico_anomalie ${where} ORDER BY gravita DESC, ultima_vista DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...valori, ANOMALIE_PER_PAGINA, (pagina - 1) * ANOMALIE_PER_PAGINA) as (Omit<AnomaliaTraffico, "dettaglio"> & { dettaglio: string })[];
  return {
    anomalie: righe.map((r) => {
      let dettaglio: Record<string, unknown> = {};
      try {
        const letto: unknown = JSON.parse(r.dettaglio);
        if (letto && typeof letto === "object" && !Array.isArray(letto)) dettaglio = letto as Record<string, unknown>;
      } catch {
        // dettaglio illeggibile: l'anomalia si mostra lo stesso, senza
      }
      return { ...r, dettaglio };
    }),
    totale,
    pagina,
    perPagina: ANOMALIE_PER_PAGINA,
  };
}

/** «vista» o «normale». «normale» conferma anche l'abitudine della coppia: non torna più. */
export function segnaAnomalia(d: Database.Database, id: number, stato: "vista" | "normale"): boolean {
  return d.transaction(() => {
    const a = d.prepare("SELECT client, server, proto, porta FROM traffico_anomalie WHERE id = ?").get(id) as
      | { client: string; server: string; proto: number; porta: number }
      | undefined;
    if (!a) return false;
    d.prepare("UPDATE traffico_anomalie SET stato = ? WHERE id = ?").run(stato, id);
    if (stato === "normale" && a.server !== "") {
      d.prepare(`
        INSERT INTO traffico_abitudini (client, server, proto, porta, prima_vista, confermata) VALUES (?, ?, ?, ?, datetime('now'), 1)
        ON CONFLICT(client, server, proto, porta) DO UPDATE SET confermata = 1`).run(a.client, a.server, a.proto, a.porta);
    }
    return true;
  })();
}
