/**
 * Elenco unico Findings: CVE + trunk + giri (TLS e controlli dalle sonde).
 * Niente tabella nuova: si legge quello che c'è già.
 */
import { getAggregatedVulnerabilities, getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { assicuraColonnaControlloServizi, assicuraColonnaNtlmServizi } from "@/lib/db-tenant-schema";
import { SEVERITY_RANK, type Severity } from "@/lib/severity-style";
import { getRilieviPaginated, TIPI_RILIEVO } from "@/lib/trunk/rilievi";
import type { GravitaRilievo } from "@/lib/trunk/rilievi-tipi";
import { rilieviDaTls, tlsDaJson } from "./da-servizi";
import {
  controlloDaJson,
  httpDaJson,
  ntlmDaJson,
  rilieviDaControllo,
  rilieviDaHttp,
  rilieviDaNtlm,
  rilieviDaPorta,
  rilieviDaSsh,
  sshDaJson,
} from "./controlli";
import { FONTI_RILIEVO, type ElencoRilievi, type FonteRilievo, type RilievoUnito, type RollupRilievi } from "./tipi";

function gravitaDaTrunk(g: GravitaRilievo): Severity {
  if (g === "alta") return "High";
  if (g === "media") return "Medium";
  return "Low";
}

function daCve(): RilievoUnito[] {
  try {
    const { data } = getAggregatedVulnerabilities({ page: 1, pageSize: 2000 });
    return data.map((v) => {
      const titolo = v.cve_id ?? v.nvt_oid ?? v.key;
      const host = v.hosts_preview[0];
      const provaParti = [
        v.package_label ? `pacchetto ${v.package_label}` : null,
        v.cvss_score != null ? `CVSS ${v.cvss_score}` : null,
        v.sources.length ? `fonti ${v.sources.join(", ")}` : null,
        `${v.host_count} host`,
      ].filter(Boolean);
      return {
        id: `cve:${v.key}`,
        fonte: "cve" as const,
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
      };
    });
  } catch {
    return [];
  }
}

function daTrunk(): RilievoUnito[] {
  try {
    const { righe } = getRilieviPaginated({ limit: 500, offset: 0 });
    return righe.map((r) => {
      const meta = TIPI_RILIEVO[r.tipo];
      return {
        id: `trunk:${r.id}`,
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
  } catch {
    return [];
  }
}

function daGiri(): RilievoUnito[] {
  try {
    const tenant = getCurrentTenantCode();
    if (!tenant) return [];
    const d = getTenantDb(tenant);
    assicuraColonnaNtlmServizi(d);
    assicuraColonnaControlloServizi(d);
    const righe = d.prepare(
      `SELECT s.host_id, s.porta, s.tls_json, s.ntlm_json, s.ssh_json, s.http_json, s.controllo_json,
              h.ip, h.hostname, h.network_id, n.name AS network_name
       FROM servizi_rete s
       JOIN hosts h ON h.id = s.host_id
       LEFT JOIN networks n ON n.id = h.network_id
       WHERE (s.tls_json IS NOT NULL AND s.tls_json != '')
          OR (s.ntlm_json IS NOT NULL AND s.ntlm_json != '')
          OR (s.ssh_json IS NOT NULL AND s.ssh_json != '')
          OR (s.http_json IS NOT NULL AND s.http_json != '')
          OR (s.controllo_json IS NOT NULL AND s.controllo_json != '')
          OR s.porta IN (23, 5985, 5986, 8530)
       LIMIT 4000`,
    ).all() as Array<{
      host_id: number;
      porta: number;
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
    for (const r of righe) {
      const ctx = {
        host_id: r.host_id,
        ip: r.ip,
        hostname: r.hostname,
        network_id: r.network_id,
        network_name: r.network_name,
        porta: r.porta,
      };
      const tls = tlsDaJson(r.tls_json);
      if (tls) out.push(...rilieviDaTls(tls, ctx));
      out.push(...rilieviDaNtlm(ntlmDaJson(r.ntlm_json), ctx));
      out.push(...rilieviDaSsh(sshDaJson(r.ssh_json), ctx));
      out.push(...rilieviDaHttp(httpDaJson(r.http_json), ctx));
      out.push(...rilieviDaPorta(ctx, Boolean(tls)));
      out.push(...rilieviDaControllo(controlloDaJson(r.controllo_json), ctx));
    }
    return out;
  } catch {
    return [];
  }
}

export interface FiltroRilievi {
  fonti?: FonteRilievo[];
  gravita?: Severity[];
  q?: string;
  page?: number;
  pageSize?: number;
}

const ROLLUP_VUOTO: RollupRilievi = { Critical: 0, High: 0, Medium: 0, Low: 0 };

function rollupDi(righe: RilievoUnito[]): RollupRilievi {
  const r = { ...ROLLUP_VUOTO };
  for (const x of righe) {
    if (x.gravita in r) r[x.gravita] += 1;
  }
  return r;
}

/** Unisce le tre fonti, filtra, ordina per gravità e pagina. */
export function elencoRilievi(filtro: FiltroRilievi = {}): ElencoRilievi {
  const fonti = filtro.fonti?.length ? filtro.fonti : [...FONTI_RILIEVO];
  const setFonte = new Set(fonti);
  let tutti: RilievoUnito[] = [];
  if (setFonte.has("cve")) tutti = tutti.concat(daCve());
  if (setFonte.has("trunk")) tutti = tutti.concat(daTrunk());
  if (setFonte.has("giro")) tutti = tutti.concat(daGiri());

  const perFonte: Record<FonteRilievo, number> = { cve: 0, trunk: 0, giro: 0 };
  for (const x of tutti) perFonte[x.fonte] += 1;

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

  const rollup = rollupDi(tutti);
  tutti.sort((a, b) => {
    const g = (SEVERITY_RANK[b.gravita] ?? 0) - (SEVERITY_RANK[a.gravita] ?? 0);
    if (g !== 0) return g;
    return (b.visto ?? "").localeCompare(a.visto ?? "");
  });

  const pageSize = Math.min(Math.max(filtro.pageSize ?? 50, 1), 200);
  const page = Math.max(filtro.page ?? 1, 1);
  const total = tutti.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const data = tutti.slice((page - 1) * pageSize, page * pageSize);
  return { data, total, page, pageSize, totalPages, rollup, perFonte };
}
