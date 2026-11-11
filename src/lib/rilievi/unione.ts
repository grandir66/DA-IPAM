/**
 * Elenco unico Findings: CVE + trunk + giri (TLS e controlli dalle sonde).
 * Niente tabella nuova: si legge quello che c'è già.
 */
import {
  classifyOsFamily,
  getAggregatedVulnerabilities,
  getCurrentTenantCode,
  getTenantDb,
  getTriageRilievi,
  OS_FAMILIES,
  type OsFamily,
} from "@/lib/db-tenant";
import { assicuraColonnaControlloServizi, assicuraColonnaNtlmServizi } from "@/lib/db-tenant-schema";
import { SEVERITY_RANK, type Severity } from "@/lib/severity-style";
import { getRilieviPaginated, TIPI_RILIEVO } from "@/lib/trunk/rilievi";
import type { GravitaRilievo } from "@/lib/trunk/rilievi-tipi";
import type Database from "better-sqlite3";
import { rilieviDelServizio, type ServizioPerRilievi } from "./del-servizio";
import { FONTI_RILIEVO, type ElencoRilievi, type FonteRilievo, type OspiteRilievo, type RilievoUnito, type RollupRilievi } from "./tipi";
import { agganciaTriage } from "./triage-aggancio";
import { barrePerRete, indicatori, raggruppa, type Raggruppamento } from "./gruppi";
import type { ExploitInfo } from "@/lib/vuln/exploit-feed/archivio";
import type { StatoTriage } from "@/lib/triage/db";

function gravitaDaTrunk(g: GravitaRilievo): Severity {
  if (g === "alta") return "High";
  if (g === "media") return "Medium";
  return "Low";
}

type RilievoConFonti = RilievoUnito & { fonti?: FonteRilievo[] };

/**
 * Cosa non entra MAI nei Findings (Riccardo, 10/11/2026: «i rilievi low, info e vecchi non
 * consideriamoli mai», «esiste un oggetto, ma non è stato scansionato recentemente: anche se ha dei
 * rilievi deve essere escluso»): la gravità bassa e gli informativi, e tutto ciò che non viene da
 * una scansione (o da un contatto dell'agente, o da un giro) degli ultimi giorni qui sotto.
 */
export const RILIEVO_RECENTE_GIORNI = 30;
const eRecente = (data: string | null | undefined): boolean => {
  if (!data) return false;
  const t = Date.parse(data.includes("T") ? data : `${data.replace(" ", "T")}Z`);
  return !Number.isNaN(t) && Date.now() - t <= RILIEVO_RECENTE_GIORNI * 86_400_000;
};

/** Tetto di sicurezza alle CVE lette: oltre, l'elenco si dichiara parziale. */
const TETTO_CVE = 100_000;

type CvssDi = (cves: string[]) => Map<string, { cvss: number | null }>;
type ExploitDi = (cves: string[]) => Map<string, ExploitInfo>;

/** Tutti gli host del tenant con la loro rete, in una lettura sola (regola: niente query nel ciclo). */
function anagraficaHost(): Map<number, OspiteRilievo & { os: OsFamily }> {
  const tenant = getCurrentTenantCode();
  const mappa = new Map<number, OspiteRilievo & { os: OsFamily }>();
  if (!tenant) return mappa;
  const righe = getTenantDb(tenant)
    .prepare(
      `SELECT h.id, h.ip, COALESCE(NULLIF(h.custom_name, ''), NULLIF(h.hostname, '')) AS nome, h.network_id, n.name AS network_name, h.os_info
       FROM hosts h LEFT JOIN networks n ON n.id = h.network_id`,
    )
    .all() as Array<{ id: number; ip: string; nome: string | null; network_id: number | null; network_name: string | null; os_info: string | null }>;
  for (const h of righe) {
    mappa.set(h.id, { host_id: h.id, ip: h.ip, nome: h.nome, network_id: h.network_id, network_name: h.network_name, os: classifyOsFamily(h.os_info) });
  }
  return mappa;
}

function daCve(
  anagrafica: Map<number, OspiteRilievo & { os: OsFamily }>,
  opzioni: { exploitDi?: ExploitDi; os?: OsFamily[]; precedenti?: boolean; soloMotore?: "edge" | "wazuh"; cvssDi?: CvssDi },
): { righe: RilievoConFonti[]; parziale: boolean } {
  // Tutte, non le prime 2.000: l'aggregazione le ordina per gravità, e il taglio lasciava di Edge
  // quasi solo le critiche (47 su 290) e di Wazuh 1.970 su oltre 17.000 (Riccardo, 10/11/2026:
  // «è realistico che quasi tutti i rilievi della sonda Edge siano critici?»).
  const { data, total } = getAggregatedVulnerabilities({
    page: 1,
    pageSize: TETTO_CVE,
    ...(opzioni.soloMotore ? { soloMotore: opzioni.soloMotore } : {}),
    ...(opzioni.cvssDi ? { cvssDi: opzioni.cvssDi } : {}),
    ...(opzioni.exploitDi ? { exploitDi: opzioni.exploitDi } : {}),
    ...(opzioni.os?.length ? { osFamilies: opzioni.os } : {}),
    soloRecentiGiorni: RILIEVO_RECENTE_GIORNI,
    senzaBassi: true,
  });
  const righe = data.map((v): RilievoConFonti => {
    const titolo = v.cve_id ?? v.nvt_oid ?? v.key;
    const host = v.hosts_preview[0];
    const fonti: FonteRilievo[] = [];
    if (v.sources.some((x) => x.startsWith("Edge"))) fonti.push("edge");
    if (v.sources.includes("Wazuh")) fonti.push("wazuh");
    const fonte = fonti[0] ?? "edge";
    const provaParti = [
      v.package_label ? `pacchetto ${v.package_label}` : null,
      v.cvss_score != null ? `CVSS ${v.cvss_score}` : null,
      v.sources.length ? `fonti ${v.sources.join(", ")}` : null,
      `${v.host_count} host`,
    ].filter(Boolean);
    return {
      id: `cve:${v.key}`,
      fonte,
      fonti: fonti.length > 0 ? fonti : [fonte],
      gravita: v.severity,
      titolo,
      prova: provaParti.join(" · ") || "Rilievo della scansione di vulnerabilità",
      rimedio: "Apri il dettaglio, applica la patch sul pacchetto indicato, poi rivedi l'host.",
      ip: host?.ip ?? null,
      host_id: host?.host_id ?? null,
      network_id: host?.network_id ?? null,
      network_name: host?.network_name ?? null,
      visto: v.latest_scanned_at,
      cve_key: v.key,
      host_count: v.host_count,
      // Il pacchetto è un software da aggiornare solo se lo dice Wazuh: per Edge l'etichetta è il nome del test.
      pacchetto: v.sources.includes("Wazuh") ? v.package_label : null,
      exploit: v.exploit ? { kev: v.exploit.kev, edb: v.exploit.edb > 0, epss: v.exploit.epss } : null,
      ospiti: (v.host_ids ?? [])
        .map((id) => anagrafica.get(id))
        .filter((o): o is OspiteRilievo & { os: OsFamily } => !!o)
        .map(({ os: _os, ...o }) => {
          void _os;
          const sua = o.host_id != null ? v.host_gravita?.[o.host_id] : undefined;
          return sua && sua !== v.severity ? { ...o, gravita: sua } : o;
        }),
      // Stessa chiave di triage della scheda Vulnerabilità (per CVE = cve_key).
      chiaveTriage: v.key,
    };
  });
  return { righe, parziale: data.length < total };
}

function daTrunk(): { righe: RilievoUnito[]; parziale: boolean } {
  const { righe, totale } = getRilieviPaginated({ limit: 500, offset: 0 });
  const risultati = righe.map((r) => {
    const meta = TIPI_RILIEVO[r.tipo];
    const id = `trunk:${r.id}`;
    return {
      id,
      chiaveTriage: id,
      fonte: "trunk" as const,
      gravita: gravitaDaTrunk(r.gravita),
      titolo: meta?.etichetta ?? r.descrizione,
      prova: r.descrizione,
      rimedio: meta?.cosaFare ?? "Prendilo in carico dalla pagina Reti dal trunk.",
      ip: r.ip,
      host_id: null,
      network_id: null,
      network_name: r.vid != null ? (r.vid === 0 ? "VLAN nativa" : `VLAN ${r.vid}`) : null,
      visto: r.ultima_vista ?? r.rilevato_il,
      cve_key: null,
      host_count: 1,
    };
  });
  return { righe: risultati, parziale: righe.length < totale };
}

/** I servizi che possono dare un rilievo, visti da un giro recente: al più 4001 (la 4001ª dice «parziale»). */
export function serviziPerRilievi(d: Database.Database, hostId?: number): ServizioPerRilievi[] {
  assicuraColonnaNtlmServizi(d);
  assicuraColonnaControlloServizi(d);
  return d.prepare(
    `SELECT s.host_id, s.porta, s.protocollo, s.tls_json, s.ntlm_json, s.ssh_json, s.http_json, s.controllo_json,
            h.ip, h.hostname, h.network_id, n.name AS network_name
     FROM servizi_rete s
     JOIN hosts h ON h.id = s.host_id
     LEFT JOIN networks n ON n.id = h.network_id
     WHERE ${hostId ? "s.host_id = ? AND" : ""} ((s.tls_json IS NOT NULL AND s.tls_json != '')
        OR (s.ntlm_json IS NOT NULL AND s.ntlm_json != '')
        OR (s.ssh_json IS NOT NULL AND s.ssh_json != '')
        OR (s.http_json IS NOT NULL AND s.http_json != '')
        OR (s.controllo_json IS NOT NULL AND s.controllo_json != '')
        OR (s.protocollo = 'tcp' AND s.porta IN (23, 135, 512, 513, 514, 5985, 5986, 631, 8530)))
       -- Solo i servizi visti da un giro recente (Riccardo, 10/11/2026); senza data non si nasconde.
       AND (s.ultimo_visto IS NULL OR julianday(s.ultimo_visto) >= julianday('now') - ${RILIEVO_RECENTE_GIORNI})
     ORDER BY s.ultimo_visto DESC, s.host_id, s.porta, s.protocollo
     LIMIT 4001`,
  ).all(...(hostId ? [hostId] : [])) as ServizioPerRilievi[];
}

function daGiri(hostId?: number): { righe: RilievoUnito[]; parziale: boolean } {
  const tenant = getCurrentTenantCode();
  if (!tenant) return { righe: [], parziale: false };
  const righe = serviziPerRilievi(getTenantDb(tenant), hostId);
  const out: RilievoUnito[] = [];
  for (const r of righe.slice(0, 4000)) out.push(...rilieviDelServizio(r));
  return { righe: out, parziale: righe.length > 4000 };
}

export const ORDINI_RILIEVI = ["gravita", "epss", "host", "visto", "titolo"] as const;
export type OrdineRilievi = (typeof ORDINI_RILIEVI)[number];

export interface FiltroRilievi {
  fonti?: FonteRilievo[];
  gravita?: Severity[];
  q?: string;
  /** Solo i rilievi di questo host: scheda dell'oggetto e cassetto in Subnet e Discovery. */
  hostId?: number;
  page?: number;
  pageSize?: number;
  /** Aggiunge all'elenco i gruppi per software, host o rete (su tutte le pagine). */
  raggruppa?: Raggruppamento;
  /** Solo i rilievi con una CVE sfruttata attivamente («kev») o con exploit pubblico («edb»). */
  exploit?: Array<"kev" | "edb">;
  /** Solo i rilievi in questi stati di revisione. */
  stato?: StatoTriage[];
  /** Solo i rilievi che toccano questa rete, o questo host. */
  rete?: number;
  ospite?: number;
  /** Aggiunge i numeri della fascia in testata. */
  conIndicatori?: boolean;
  /** Solo i rilievi su host di queste famiglie di sistema operativo. */
  os?: OsFamily[];
  /** Anche le CVE delle scansioni superate; di base solo l'ultima di ogni rete. */
  precedenti?: boolean;
  /** Ordinamento dell'elenco per rilievo; di base gravità, poi il più recente. */
  ordina?: OrdineRilievi;
  verso?: "asc" | "desc";
  /** Gli exploit noti per CVE: la rotta passa l'archivio vero, le prove uno finto o niente. */
  exploitDi?: ExploitDi;
  /** Il punteggio proprio di ogni CVE (archivio NVD locale), per gli avvisi di pacchetto di Greenbone. */
  cvssDi?: CvssDi;
}

const ROLLUP_VUOTO: RollupRilievi = { Critical: 0, High: 0, Medium: 0, Low: 0 };

function rollupDi(righe: RilievoUnito[]): RollupRilievi {
  const r = { ...ROLLUP_VUOTO };
  for (const x of righe) {
    if (x.gravita in r) r[x.gravita] += 1;
  }
  return r;
}

/**
 * Aggancia a ogni rilievo il suo triage (una query in blocco su `chiaveTriage`) e torna i conteggi
 * per stato su tutte le righe date. Se la lettura fallisce (niente tenant, tabella assente) vale
 * «Da rivedere» per tutti, così l'elenco si vede comunque.
 */
function conteggiTriageElenco(righe: RilievoUnito[]): Record<StatoTriage, number> {
  try {
    return agganciaTriage(righe, getTriageRilievi(righe.map((r) => r.chiaveTriage)));
  } catch {
    return agganciaTriage(righe, {});
  }
}

/** Unisce le tre fonti, filtra, ordina per gravità e pagina. */
export function elencoRilievi(filtro: FiltroRilievi = {}): ElencoRilievi {
  const fonti = filtro.fonti?.length ? filtro.fonti : [...FONTI_RILIEVO];
  const setFonte = new Set(fonti);
  let tutti: RilievoConFonti[] = [];
  const anagrafica = anagraficaHost();
  // Tutte le famiglie scelte = nessun filtro.
  const osScelti = filtro.os?.length && filtro.os.length < OS_FAMILIES.length ? filtro.os : undefined;
  // Un motore solo fra Edge e Wazuh: gravità e host sono quelli che dice lui, non il massimo fra i due.
  const soloMotore = setFonte.has("edge") && !setFonte.has("wazuh") ? ("edge" as const) : setFonte.has("wazuh") && !setFonte.has("edge") ? ("wazuh" as const) : undefined;
  const nonDisponibili: FonteRilievo[] = [];
  const parziali: FonteRilievo[] = [];
  const sorgenti = [
    { fonti: ["edge", "wazuh"] as const, leggi: () => daCve(anagrafica, { exploitDi: filtro.exploitDi, os: osScelti, precedenti: filtro.precedenti, cvssDi: filtro.cvssDi }) },
    { fonti: ["trunk"] as const, leggi: daTrunk },
    { fonti: ["giro"] as const, leggi: () => daGiri(filtro.hostId) },
  ];
  for (const sorgente of sorgenti) {
    try {
      const esito = sorgente.leggi();
      tutti = tutti.concat(esito.righe);
      if (esito.parziale) parziali.push(...sorgente.fonti);
    } catch (err) {
      nonDisponibili.push(...sorgente.fonti);
      console.error("[findings] fonte non disponibile:", sorgente.fonti.join(","), err);
    }
  }

  if (filtro.hostId) tutti = tutti.filter((x) => x.host_id === filtro.hostId);
  // Gli stessi filtri valgono per la lettura unita e per quella di un motore solo.
  const filtra = (ingresso: RilievoConFonti[]): RilievoConFonti[] => {
    let righe = ingresso;
    // Bassi e vecchi fuori, per le fonti che non passano dalla lettura delle CVE (trunk e giri):
  // le CVE li hanno già tolti alla fonte, host per host.
  righe = righe.filter((x) => !!x.cve_key || (x.gravita !== "Low" && (x.fonte !== "trunk" || eRecente(x.visto))));

  // Sistema operativo: le CVE le filtra già la lettura; trunk e giri si filtrano per l'host che toccano
    // (senza un host censito il sistema è «Unknown»).
    if (osScelti) {
      const vuole = new Set<OsFamily>(osScelti);
      righe = righe.filter((x) => !!x.cve_key || vuole.has((x.host_id != null ? anagrafica.get(x.host_id)?.os : undefined) ?? "Unknown"));
    }

    if (filtro.exploit?.length) {
      const vuole = new Set(filtro.exploit);
      righe = righe.filter((x) => (vuole.has("kev") && !!x.exploit?.kev) || (vuole.has("edb") && !!x.exploit?.edb));
    }
    if (filtro.ospite != null) {
      const ospite = filtro.ospite;
      righe = righe.filter((x) => (x.ospiti?.length ? x.ospiti.some((o) => o.host_id === ospite) : x.host_id === ospite));
    }
    const grav = filtro.gravita?.length ? new Set(filtro.gravita) : null;
    if (grav) righe = righe.filter((x) => grav.has(x.gravita));
    const q = filtro.q?.trim().toLowerCase();
    if (q) {
      righe = righe.filter(
        (x) =>
          x.titolo.toLowerCase().includes(q) ||
          x.prova.toLowerCase().includes(q) ||
          (x.ip ?? "").includes(q) ||
          (x.network_name ?? "").toLowerCase().includes(q),
      );
    }
    return righe;
  };
  tutti = filtra(tutti);

  const totaleGlobale = tutti.length;
  const perFonte: Record<FonteRilievo, number> = { edge: 0, wazuh: 0, trunk: 0, giro: 0 };
  let selezionati: RilievoUnito[] = [];
  for (const { fonti: motori, ...x } of tutti) {
    const fontiRiga = motori ?? [x.fonte];
    for (const fonte of fontiRiga) perFonte[fonte] += 1;
    const fonte = fontiRiga.find((f) => setFonte.has(f));
    if (fonte) selezionati.push({ ...x, fonte });
  }
  // Un motore solo: le sue righe si rileggono da sole, così gravità e host sono i suoi. I conteggi
  // delle schede restano quelli della lettura unita (quante CVE vede ciascun motore).
  if (soloMotore && !nonDisponibili.includes(soloMotore)) {
    try {
      const sole = daCve(anagrafica, { exploitDi: filtro.exploitDi, os: osScelti, precedenti: filtro.precedenti, soloMotore, cvssDi: filtro.cvssDi });
      selezionati = filtra(sole.righe).map(({ fonti: _f, ...x }) => {
        void _f;
        return { ...x, fonte: soloMotore };
      });
    } catch (err) {
      console.error("[findings] lettura per motore non riuscita:", soloMotore, err);
    }
  }

  const perGravita = (a: RilievoUnito, b: RilievoUnito): number => {
    const g = (SEVERITY_RANK[b.gravita] ?? 0) - (SEVERITY_RANK[a.gravita] ?? 0);
    if (g !== 0) return g;
    return (b.visto ?? "").localeCompare(a.visto ?? "") || a.id.localeCompare(b.id);
  };
  const ordina = filtro.ordina ?? "gravita";
  // Di base dal più grave / più alto / più recente; il titolo dalla A.
  const su = (filtro.verso ?? (ordina === "titolo" ? "asc" : "desc")) === "asc" ? 1 : -1;
  selezionati.sort((a, b) => {
    let c = 0;
    if (ordina === "gravita") return su === -1 ? perGravita(a, b) : -perGravita(a, b);
    // Chi non ha il dato (EPSS assente) sta sempre in fondo, in tutti e due i versi.
    if (ordina === "epss") {
      const ea = a.exploit?.epss ?? null;
      const eb = b.exploit?.epss ?? null;
      if (ea == null || eb == null) c = ea == null && eb == null ? 0 : ea == null ? 1 : -1;
      else c = (ea - eb) * su;
    } else if (ordina === "host") c = (a.host_count - b.host_count) * su;
    else if (ordina === "visto") c = (a.visto ?? "").localeCompare(b.visto ?? "") * su;
    else c = a.titolo.localeCompare(b.titolo) * su;
    return c || perGravita(a, b);
  });

  // Il triage si aggancia ai rilievi selezionati per il tab corrente (tutte le pagine): così «N di M
  // rivisti» è vero e il badge c'è anche oltre la prima pagina. `agganciaTriage` scrive `.triage`
  // sulle stesse istanze (le copie `{ ...x, fonte }`) che poi finiscono in `data`.
  conteggiTriageElenco(selezionati);
  const stati = filtro.stato?.length ? new Set(filtro.stato) : null;
  const conStato = (righe: RilievoUnito[]): RilievoUnito[] => (stati ? righe.filter((x) => stati.has(x.triage?.stato ?? "da_fare")) : righe);

  // La fascia in testata segue i filtri (Riccardo, 10/11/2026: «il grafico in alto non si aggiorna in
  // base alle opzioni dei filtri»). Le barre per rete seguono tutto tranne il filtro per rete:
  // altrimenti, scelta una rete, sparirebbero le altre e non si potrebbe passare a un'altra.
  const perRete = filtro.conIndicatori ? barrePerRete(conStato(selezionati), filtro.ospite) : undefined;

  if (filtro.rete != null) {
    const rete = filtro.rete;
    selezionati = selezionati.filter((x) => (x.ospiti?.length ? x.ospiti.some((o) => o.network_id === rete) : x.network_id === rete));
  }
  const rollup = rollupDi(selezionati);
  // I conteggi di revisione restano quelli della vista prima del filtro per stato.
  const conteggiTriage: Record<StatoTriage, number> = { da_fare: 0, in_corso: 0, fatto: 0, ignorato: 0 };
  for (const x of selezionati) conteggiTriage[x.triage?.stato ?? "da_fare"] += 1;
  selezionati = conStato(selezionati);
  const numeri = filtro.conIndicatori ? indicatori(selezionati) : undefined;

  const pageSize = Math.min(Math.max(filtro.pageSize ?? 50, 1), 200);
  const page = Math.max(filtro.page ?? 1, 1);
  const total = selezionati.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Gli host di ogni rilievo servono solo qui: nell'elenco non viaggiano.
  // Con un filtro per host o per rete la riga mostra QUELL'host e la gravità che il rilievo ha lì:
  // prima restava il primo host della CVE, e filtrando su eve-ng si leggeva un altro indirizzo.
  const data = selezionati.slice((page - 1) * pageSize, page * pageSize).map(({ ospiti, ...x }) => {
    const suo =
      filtro.ospite != null ? ospiti?.find((o) => o.host_id === filtro.ospite)
        : filtro.rete != null ? ospiti?.find((o) => o.network_id === filtro.rete)
          : undefined;
    if (!suo) return x;
    return { ...x, ip: suo.ip, host_id: suo.host_id, network_id: suo.network_id, network_name: suo.network_name, gravita: suo.gravita ?? x.gravita };
  });
  const gruppi = filtro.raggruppa ? raggruppa(selezionati, filtro.raggruppa) : undefined;
  return {
    data, total, page, pageSize, totalPages, rollup, perFonte, totaleGlobale, nonDisponibili, parziali, conteggiTriage,
    ...(gruppi ? { gruppi } : {}),
    ...(numeri ? { indicatori: numeri } : {}),
    ...(perRete ? { perRete } : {}),
  };
}
