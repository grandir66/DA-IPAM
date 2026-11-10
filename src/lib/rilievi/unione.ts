/**
 * Elenco unico Findings: CVE + trunk + giri (TLS e controlli dalle sonde).
 * Niente tabella nuova: si legge quello che c'è già.
 */
import { getAggregatedVulnerabilities, getCurrentTenantCode, getTenantDb, getTriageRilievi } from "@/lib/db-tenant";
import { assicuraColonnaControlloServizi, assicuraColonnaNtlmServizi } from "@/lib/db-tenant-schema";
import { SEVERITY_RANK, type Severity } from "@/lib/severity-style";
import { getRilieviPaginated, TIPI_RILIEVO } from "@/lib/trunk/rilievi";
import type { GravitaRilievo } from "@/lib/trunk/rilievi-tipi";
import { rilieviDaTls, tlsDaJson } from "./da-servizi";
import {
  controlloDaJson,
  httpDaJson,
  ntlmDaJson,
  protocolloControllo,
  rilieviDaControllo,
  rilieviDaHttp,
  rilieviDaNtlm,
  rilieviDaPorta,
  rilieviDaSsh,
  sshDaJson,
} from "./controlli";
import { FONTI_RILIEVO, type ElencoRilievi, type FonteRilievo, type OspiteRilievo, type RilievoUnito, type RollupRilievi } from "./tipi";
import { agganciaTriage } from "./triage-aggancio";
import { indicatori, raggruppa, type Raggruppamento } from "./gruppi";
import type { ExploitInfo } from "@/lib/vuln/exploit-feed/archivio";
import type { StatoTriage } from "@/lib/triage/db";

function gravitaDaTrunk(g: GravitaRilievo): Severity {
  if (g === "alta") return "High";
  if (g === "media") return "Medium";
  return "Low";
}

type RilievoConFonti = RilievoUnito & { fonti?: FonteRilievo[] };

type ExploitDi = (cves: string[]) => Map<string, ExploitInfo>;

/** Tutti gli host del tenant con la loro rete, in una lettura sola (regola: niente query nel ciclo). */
function anagraficaHost(): Map<number, OspiteRilievo> {
  const tenant = getCurrentTenantCode();
  const mappa = new Map<number, OspiteRilievo>();
  if (!tenant) return mappa;
  const righe = getTenantDb(tenant)
    .prepare(
      `SELECT h.id, h.ip, COALESCE(NULLIF(h.custom_name, ''), NULLIF(h.hostname, '')) AS nome, h.network_id, n.name AS network_name
       FROM hosts h LEFT JOIN networks n ON n.id = h.network_id`,
    )
    .all() as Array<{ id: number; ip: string; nome: string | null; network_id: number | null; network_name: string | null }>;
  for (const h of righe) mappa.set(h.id, { host_id: h.id, ip: h.ip, nome: h.nome, network_id: h.network_id, network_name: h.network_name });
  return mappa;
}

function daCve(exploitDi?: ExploitDi): { righe: RilievoConFonti[]; parziale: boolean } {
  const { data, total } = getAggregatedVulnerabilities({ page: 1, pageSize: 2000, ...(exploitDi ? { exploitDi } : {}) });
  const anagrafica = anagraficaHost();
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
      exploit: v.exploit ? { kev: v.exploit.kev, edb: v.exploit.edb > 0 } : null,
      ospiti: (v.host_ids ?? []).map((id) => anagrafica.get(id)).filter((o): o is OspiteRilievo => !!o),
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

function daGiri(hostId?: number): { righe: RilievoUnito[]; parziale: boolean } {
  const tenant = getCurrentTenantCode();
  if (!tenant) return { righe: [], parziale: false };
  const d = getTenantDb(tenant);
  assicuraColonnaNtlmServizi(d);
  assicuraColonnaControlloServizi(d);
  const righe = d.prepare(
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
     ORDER BY s.ultimo_visto DESC, s.host_id, s.porta, s.protocollo
     LIMIT 4001`,
  ).all(...(hostId ? [hostId] : [])) as Array<{
    host_id: number;
    porta: number;
    protocollo: string;
    tls_json: string | null;
    ntlm_json: string | null;
    ssh_json: string | null;
    http_json: string | null;
    controllo_json: string | null;
    ip: string;
    hostname: string | null;
    network_id: number | null;
    network_name: string | null;
  }>;
  const out: RilievoUnito[] = [];
  for (const r of righe.slice(0, 4000)) {
    const ctx = {
      host_id: r.host_id,
      ip: r.ip,
      hostname: r.hostname,
      network_id: r.network_id,
      network_name: r.network_name,
      porta: r.porta,
      protocollo: r.protocollo,
    };
    const tls = tlsDaJson(r.tls_json);
    if (tls) out.push(...rilieviDaTls(tls, ctx));
    out.push(...rilieviDaNtlm(ntlmDaJson(r.ntlm_json), ctx));
    out.push(...rilieviDaSsh(sshDaJson(r.ssh_json), ctx));
    out.push(...rilieviDaHttp(httpDaJson(r.http_json), ctx));
    if (r.protocollo === "tcp") out.push(...rilieviDaPorta(ctx, Boolean(tls)));
    if (r.protocollo === protocolloControllo(r.porta)) out.push(...rilieviDaControllo(controlloDaJson(r.controllo_json), ctx));
  }
  return { righe: out, parziale: righe.length > 4000 };
}

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
  /** Gli exploit noti per CVE: la rotta passa l'archivio vero, le prove uno finto o niente. */
  exploitDi?: ExploitDi;
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
  const nonDisponibili: FonteRilievo[] = [];
  const parziali: FonteRilievo[] = [];
  const sorgenti = [
    { fonti: ["edge", "wazuh"] as const, leggi: () => daCve(filtro.exploitDi) },
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
  // Gli indicatori guardano il motore scelto, prima degli altri filtri: dicono dove guardare.
  const numeri = filtro.conIndicatori ? indicatori(tutti.filter((x) => (x.fonti ?? [x.fonte]).some((f) => setFonte.has(f)))) : undefined;

  if (filtro.exploit?.length) {
    const vuole = new Set(filtro.exploit);
    tutti = tutti.filter((x) => (vuole.has("kev") && !!x.exploit?.kev) || (vuole.has("edb") && !!x.exploit?.edb));
  }
  if (filtro.rete != null) {
    const rete = filtro.rete;
    tutti = tutti.filter((x) => (x.ospiti?.length ? x.ospiti.some((o) => o.network_id === rete) : x.network_id === rete));
  }
  if (filtro.ospite != null) {
    const ospite = filtro.ospite;
    tutti = tutti.filter((x) => (x.ospiti?.length ? x.ospiti.some((o) => o.host_id === ospite) : x.host_id === ospite));
  }
  const grav = filtro.gravita?.length ? new Set(filtro.gravita) : null;
  if (grav) tutti = tutti.filter((x) => grav.has(x.gravita));
  const q = filtro.q?.trim().toLowerCase();
  if (q) {
    tutti = tutti.filter(
      (x) =>
        x.titolo.toLowerCase().includes(q) ||
        x.prova.toLowerCase().includes(q) ||
        (x.ip ?? "").includes(q) ||
        (x.network_name ?? "").toLowerCase().includes(q),
    );
  }

  const totaleGlobale = tutti.length;
  const perFonte: Record<FonteRilievo, number> = { edge: 0, wazuh: 0, trunk: 0, giro: 0 };
  let selezionati: RilievoUnito[] = [];
  for (const { fonti: motori, ...x } of tutti) {
    const fontiRiga = motori ?? [x.fonte];
    for (const fonte of fontiRiga) perFonte[fonte] += 1;
    const fonte = fontiRiga.find((f) => setFonte.has(f));
    if (fonte) selezionati.push({ ...x, fonte });
  }

  const rollup = rollupDi(selezionati);
  selezionati.sort((a, b) => {
    const g = (SEVERITY_RANK[b.gravita] ?? 0) - (SEVERITY_RANK[a.gravita] ?? 0);
    if (g !== 0) return g;
    return (b.visto ?? "").localeCompare(a.visto ?? "") || a.id.localeCompare(b.id);
  });

  // Il triage si aggancia ai rilievi selezionati per il tab corrente (tutte le pagine): così «N di M
  // rivisti» è vero e il badge c'è anche oltre la prima pagina. `agganciaTriage` scrive `.triage`
  // sulle stesse istanze (le copie `{ ...x, fonte }`) che poi finiscono in `data`.
  const conteggiTriage = conteggiTriageElenco(selezionati);
  // Il filtro per stato viene dopo: i conteggi sopra restano quelli di tutta la vista.
  if (filtro.stato?.length) {
    const stati = new Set(filtro.stato);
    selezionati = selezionati.filter((x) => stati.has(x.triage?.stato ?? "da_fare"));
  }

  const pageSize = Math.min(Math.max(filtro.pageSize ?? 50, 1), 200);
  const page = Math.max(filtro.page ?? 1, 1);
  const total = selezionati.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Gli host di ogni rilievo servono solo qui: nell'elenco non viaggiano.
  const data = selezionati.slice((page - 1) * pageSize, page * pageSize).map(({ ospiti: _o, ...x }) => {
    void _o;
    return x;
  });
  const gruppi = filtro.raggruppa ? raggruppa(selezionati, filtro.raggruppa) : undefined;
  return {
    data, total, page, pageSize, totalPages, rollup, perFonte, totaleGlobale, nonDisponibili, parziali, conteggiTriage,
    ...(gruppi ? { gruppi } : {}),
    ...(numeri ? { indicatori: numeri } : {}),
  };
}
