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
import type { DopoFinestra, FattoCollector, RigaCollector } from "./lettura";

/** I controlli sul contenuto fatti dal collector (`collector-traffico/collector/controlli.py`): il tipo del fatto è il tipo dell'anomalia. */
export const TIPI_FATTO = [
  "chiaro_telnet", "chiaro_ftp", "chiaro_posta", "chiaro_http_basic", "chiaro_ldap", "snmp_vecchio",
  "smb1", "tls_vecchio", "ntlm1", "nome_conteso", "impianto_scrittura", "dns_anomalo",
] as const;
export type TipoFatto = (typeof TIPI_FATTO)[number];
export type TipoAnomalia = "coppia_nuova" | "porta_nuova" | "molti_contatti" | "impianto"
  | "vlan_chiuse" | "volume" | "non_censito" | TipoFatto;
export const TIPI_ANOMALIA: readonly TipoAnomalia[] = ["coppia_nuova", "porta_nuova", "molti_contatti", "impianto", "vlan_chiuse", "volume", "non_censito", ...TIPI_FATTO];
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

/** Dai fatti del collector alle anomalie. Conclamate: non aspettano l'apprendimento. */
export function valutaFatti(ingresso: {
  fatti: { tipo: string; client: string; server: string; porta: number; dettaglio: unknown }[];
  spenti: Set<string>;                   // `${network_id}|${tipo}`: controllo spento per quella rete
  reteDi: (ip: string) => number | null;
  confermate: Set<string>;               // abitudini confermate, chiave di `chiaveCoppia` (proto 6)
}): AnomaliaNuova[] {
  const uscite = new Map<string, AnomaliaNuova>();
  for (const f of ingresso.fatti) {
    if (!(TIPI_FATTO as readonly string[]).includes(f.tipo)) continue; // un collector più nuovo di IPAM: tipo sconosciuto, si salta
    const tipo = f.tipo as TipoFatto;
    const rete = ingresso.reteDi(interno(f.client) ? f.client : f.server) ?? RETE_NESSUNA;
    if (ingresso.spenti.has(`${rete}|${tipo}`)) continue;
    // Una scrittura verso un impianto da chi è già stato confermato (lo SCADA di sempre) non è una notizia.
    if (tipo === "impianto_scrittura" && ingresso.confermate.has(chiaveCoppia({ client: f.client, server: f.server, proto: 6, porta: f.porta }))) continue;
    const dettaglio: AnomaliaNuova["dettaglio"] = {};
    if (f.dettaglio && typeof f.dettaglio === "object" && !Array.isArray(f.dettaglio)) {
      for (const [k, v] of Object.entries(f.dettaglio as Record<string, unknown>).slice(0, 8)) {
        if (typeof v === "number" || typeof v === "boolean") dettaglio[k.slice(0, 40)] = v;
        else if (typeof v === "string") dettaglio[k.slice(0, 40)] = v.slice(0, 100);
      }
    }
    const a: AnomaliaNuova = {
      tipo, gravita: tipo === "tls_vecchio" || tipo === "snmp_vecchio" ? 2 : 3,
      client: f.client, server: f.server, proto: 0, porta: f.porta, dettaglio,
    };
    uscite.set(`${a.tipo}|${chiaveCoppia(a)}`, a);
  }
  return [...uscite.values()];
}

// ── Aggancio al database del tenant ──────────────────────────────────────────

function lettoreReti(): (ip: string) => number | null {
  const reti = getNetworks().map((n) => ({ id: n.id, cidr: n.cidr }));
  const memo = new Map<string, number | null>();
  return (ip: string): number | null => {
    if (!interno(ip)) return null;
    let r = memo.get(ip);
    if (r === undefined) {
      r = reti.find((n) => isIpInCidr(ip, n.cidr))?.id ?? null;
      memo.set(ip, r);
    }
    return r;
  };
}

/** Scrive le anomalie dei fatti letti da un collector. Da chiamare dentro la transazione della pagina. */
export function creaRegistratoreFatti(): (d: Database.Database, fatti: FattoCollector[]) => void {
  const reteDi = lettoreReti();
  return (d, fatti) => {
    const spenti = new Set((d.prepare("SELECT network_id, tipo FROM traffico_controlli WHERE acceso = 0").all() as { network_id: number; tipo: string }[])
      .map((r) => `${r.network_id}|${r.tipo}`));
    const confermate = new Set((d.prepare("SELECT client, server, proto, porta FROM traffico_abitudini WHERE confermata = 1").all() as
      { client: string; server: string; proto: number; porta: number }[]).map(chiaveCoppia));
    const perMomento = new Map<string, FattoCollector[]>();
    for (const f of fatti) perMomento.set(f.visto, [...(perMomento.get(f.visto) ?? []), f]);
    for (const [visto, gruppo] of perMomento) scriviAnomalie(d, visto, valutaFatti({ fatti: gruppo, spenti, reteDi, confermate }));
  };
}

/** I controlli spenti, rete per rete (assente = acceso). `network_id` 0 = fuori dalle reti censite. */
export function controlliSpenti(d: Database.Database): { network_id: number; tipo: TipoFatto }[] {
  return d.prepare("SELECT network_id, tipo FROM traffico_controlli WHERE acceso = 0 ORDER BY network_id, tipo").all() as { network_id: number; tipo: TipoFatto }[];
}

export function impostaControllo(d: Database.Database, networkId: number, tipo: TipoFatto, acceso: boolean): void {
  d.prepare(`INSERT INTO traffico_controlli (network_id, tipo, acceso) VALUES (?, ?, ?)
    ON CONFLICT(network_id, tipo) DO UPDATE SET acceso = excluded.acceso`).run(networkId, tipo, acceso ? 1 : 0);
}

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
  const reteDi = lettoreReti();
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
      SELECT giorno, collector_id, fonte, ip, SUM(byte) AS byte FROM (
        SELECT giorno, collector_id, fonte, client AS ip, byte FROM traffico_coppie WHERE giorno BETWEEN date(?, '-14 days') AND ?
        UNION ALL
        SELECT giorno, collector_id, fonte, server AS ip, byte FROM traffico_coppie WHERE giorno BETWEEN date(?, '-14 days') AND ?)
      WHERE ip NOT IN ('esterno', 'diffusione') GROUP BY giorno, collector_id, fonte, ip)
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
      // Le anomalie dai fatti non portano il protocollo (0): la loro abitudine è la coppia TCP su quella porta.
      d.prepare(`
        INSERT INTO traffico_abitudini (client, server, proto, porta, prima_vista, confermata) VALUES (?, ?, ?, ?, datetime('now'), 1)
        ON CONFLICT(client, server, proto, porta) DO UPDATE SET confermata = 1`).run(a.client, a.server, a.proto === 0 ? 6 : a.proto, a.porta);
    }
    return true;
  })();
}
