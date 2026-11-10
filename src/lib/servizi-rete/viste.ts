/**
 * «Servizi di rete» con la logica dei Findings (Riccardo, 10/11/2026: «probabilmente dovremmo
 * ridisegnarla con la logica dei findings»).
 *
 * Sull'hub la pagina era un elenco piatto di 1.085 righe, una per porta: la 22 erano 133 righe,
 * il 57% dei servizi non era identificato e 13 certificati scaduti si scoprivano aprendo una
 * riga alla volta. Qui le stesse righe si leggono in gruppi (porta, prodotto, host, rete), con
 * quattro segnali che dicono dove guardare e i rilievi agganciati alla porta da cui nascono.
 * Modulo puro: niente database.
 */
import { SEVERITY_RANK, type Severity } from "@/lib/severity-style";
import { isIpInCidr } from "@/lib/utils";
import { rilieviDelServizio } from "@/lib/rilievi/del-servizio";
import type { RollupRilievi } from "@/lib/rilievi/tipi";
import type { StatoTriage } from "@/lib/triage/db";
import type { ServizioRete, ServizioReteCompleto } from "./db";

export const SEGNALI = ["chiaro", "certificati", "non-identificati", "non-rivisti"] as const;
export type Segnale = (typeof SEGNALI)[number];

export const RAGGRUPPAMENTI_SERVIZI = ["porta", "prodotto", "host", "rete"] as const;
export type RaggruppamentoServizi = (typeof RAGGRUPPAMENTI_SERVIZI)[number];

export const TIPI_SERVIZIO = ["http", "tls", "ssh", "ntlm", "banner", "silenzio", "da-sondare"] as const;
export type TipoServizio = (typeof TIPI_SERVIZIO)[number];

/** Accessi che passano utente e password in chiaro (solo TCP). */
export const PORTE_IN_CHIARO: Record<number, string> = {
  21: "FTP",
  23: "Telnet",
  512: "rexec",
  513: "rlogin",
  514: "rsh",
  5900: "VNC",
  5901: "VNC",
};

/** Oltre questi giorni senza rivederla, una porta è «non rivista»: forse non c'è più. */
export const GIORNI_NON_RIVISTO = 7;

export interface RilievoServizio {
  /** Chiave del triage, la stessa di Findings (`giro:<slug>:<host_id>:<porta>`). */
  chiave: string;
  gravita: Severity;
  titolo: string;
  prova: string;
  rimedio: string;
  triage?: { stato: StatoTriage; nota: string; aggiornato_il: string; aggiornato_da: string | null };
}

export interface ServizioVista extends ServizioRete {
  segnali: Segnale[];
  certificato: "scaduto" | "autofirmato" | null;
  rilievi: RilievoServizio[];
}

function dataDb(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? `${s.replace(" ", "T")}Z` : s);
  return Number.isNaN(t) ? null : t;
}

function certificatoDi(tlsJson: string | null, adesso: number): ServizioVista["certificato"] {
  if (!tlsJson) return null;
  try {
    const v = JSON.parse(tlsJson) as { expired?: unknown; self_signed?: unknown; not_after?: unknown };
    const fine = typeof v.not_after === "string" ? Date.parse(v.not_after) : NaN;
    if (v.expired === true || (!Number.isNaN(fine) && fine <= adesso)) return "scaduto";
    return v.self_signed === true ? "autofirmato" : null;
  } catch {
    return null;
  }
}

/** Aggiunge a ogni riga i suoi segnali e i suoi rilievi; `controllo_json` non esce dal server. */
export function preparaServizi(righe: readonly ServizioReteCompleto[], adesso: Date = new Date()): ServizioVista[] {
  const ora = adesso.getTime();
  const soglia = ora - GIORNI_NON_RIVISTO * 86_400_000;
  return righe.map((r) => {
    const { controllo_json, ...base } = r;
    const certificato = certificatoDi(r.tls_json, ora);
    const segnali: Segnale[] = [];
    if (r.protocollo === "tcp" && PORTE_IN_CHIARO[r.porta]) segnali.push("chiaro");
    if (certificato) segnali.push("certificati");
    if (r.metodo === "silenzio" || r.ultima_sonda == null) segnali.push("non-identificati");
    const visto = dataDb(r.ultimo_visto);
    if (visto != null && visto < soglia) segnali.push("non-rivisti");
    const rilievi = rilieviDelServizio({
      host_id: r.host_id,
      porta: r.porta,
      protocollo: r.protocollo,
      tls_json: r.tls_json,
      ntlm_json: r.ntlm_json,
      ssh_json: r.ssh_json,
      http_json: r.http_json,
      controllo_json,
      ip: r.ip,
      hostname: r.hostname,
      network_id: r.network_id,
      network_name: r.rete,
    })
      .map((x): RilievoServizio => ({ chiave: x.chiaveTriage, gravita: x.gravita, titolo: x.titolo, prova: x.prova, rimedio: x.rimedio }))
      .sort((a, b) => (SEVERITY_RANK[b.gravita] ?? 0) - (SEVERITY_RANK[a.gravita] ?? 0) || a.titolo.localeCompare(b.titolo));
    return { ...base, segnali, certificato, rilievi };
  });
}

export function eTipo(r: ServizioRete, tipo: TipoServizio): boolean {
  switch (tipo) {
    case "http": return r.http_json != null;
    case "tls": return r.tls_json != null;
    case "ssh": return r.ssh_json != null;
    case "ntlm": return r.ntlm_json != null;
    case "banner": return r.metodo === "banner";
    case "silenzio": return r.metodo === "silenzio";
    case "da-sondare": return r.ultima_sonda == null;
  }
}

export interface FiltroVista {
  rete?: number;
  tipo?: TipoServizio;
  segnale?: Segnale;
  /** `192.168.4.0/24`: la ricerca per rete scritta a mano. */
  cidr?: string;
  /** Solo i servizi con almeno un rilievo. */
  conRilievi?: boolean;
}

export function eCidr(q: string | null | undefined): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec((q ?? "").trim());
  return m != null && m.slice(1, 5).every((n) => Number(n) <= 255) && Number(m[5]) <= 32;
}

export function filtraServizi(righe: readonly ServizioVista[], f: FiltroVista): ServizioVista[] {
  return righe.filter(
    (r) =>
      (f.rete == null || r.network_id === f.rete) &&
      (f.tipo == null || eTipo(r, f.tipo)) &&
      (f.segnale == null || r.segnali.includes(f.segnale)) &&
      (f.cidr == null || isIpInCidr(r.ip, f.cidr)) &&
      (!f.conRilievi || r.rilievi.length > 0),
  );
}

export interface IndicatoriServizi {
  servizi: number;
  host: number;
  chiaro: { totale: number; voci: Array<{ nome: string; n: number }> };
  certificati: { totale: number; scaduti: number; autofirmati: number };
  nonIdentificati: { totale: number; muti: number; daSondare: number };
  nonRivisti: number;
  rilievi: number;
}

export function indicatoriServizi(righe: readonly ServizioVista[]): IndicatoriServizi {
  const host = new Set<number>();
  const chiaro = new Map<string, number>();
  const out: IndicatoriServizi = {
    servizi: righe.length,
    host: 0,
    chiaro: { totale: 0, voci: [] },
    certificati: { totale: 0, scaduti: 0, autofirmati: 0 },
    nonIdentificati: { totale: 0, muti: 0, daSondare: 0 },
    nonRivisti: 0,
    rilievi: 0,
  };
  for (const r of righe) {
    host.add(r.host_id);
    out.rilievi += r.rilievi.length;
    if (r.segnali.includes("chiaro")) {
      out.chiaro.totale += 1;
      const nome = PORTE_IN_CHIARO[r.porta];
      chiaro.set(nome, (chiaro.get(nome) ?? 0) + 1);
    }
    if (r.certificato === "scaduto") out.certificati.scaduti += 1;
    else if (r.certificato === "autofirmato") out.certificati.autofirmati += 1;
    if (r.segnali.includes("non-identificati")) {
      out.nonIdentificati.totale += 1;
      if (r.ultima_sonda == null) out.nonIdentificati.daSondare += 1;
      else out.nonIdentificati.muti += 1;
    }
    if (r.segnali.includes("non-rivisti")) out.nonRivisti += 1;
  }
  out.host = host.size;
  out.certificati.totale = out.certificati.scaduti + out.certificati.autofirmati;
  out.chiaro.voci = [...chiaro.entries()].map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome));
  return out;
}

export function conteggiPerTipo(righe: readonly ServizioVista[]): Record<TipoServizio, number> {
  const out = { http: 0, tls: 0, ssh: 0, ntlm: 0, banner: 0, silenzio: 0, "da-sondare": 0 } as Record<TipoServizio, number>;
  for (const r of righe) for (const t of TIPI_SERVIZIO) if (eTipo(r, t)) out[t] += 1;
  return out;
}

export interface BarraReteServizi {
  network_id: number;
  nome: string;
  host: number;
  identificati: number;
  nonIdentificati: number;
  totale: number;
}

/** Servizi per rete, divisi fra letti dalla risposta e non identificati. */
export function barreReteServizi(righe: readonly ServizioVista[]): BarraReteServizi[] {
  const reti = new Map<number, BarraReteServizi & { ospiti: Set<number> }>();
  for (const r of righe) {
    if (r.network_id == null) continue;
    let b = reti.get(r.network_id);
    if (!b) {
      b = { network_id: r.network_id, nome: r.rete ?? `rete ${r.network_id}`, host: 0, identificati: 0, nonIdentificati: 0, totale: 0, ospiti: new Set() };
      reti.set(r.network_id, b);
    }
    b.ospiti.add(r.host_id);
    b.totale += 1;
    if (r.segnali.includes("non-identificati")) b.nonIdentificati += 1;
    else b.identificati += 1;
  }
  return [...reti.values()]
    .map(({ ospiti, ...b }) => ({ ...b, host: ospiti.size }))
    .sort((a, b) => b.totale - a.totale || a.nome.localeCompare(b.nome));
}

export interface GruppoServizi {
  /** `porta:22/tcp`, `prodotto:OpenSSH`, `host:12`, `rete:3`. */
  chiave: string;
  nome: string;
  /** Riga accanto al nome: il servizio di una porta, l'IP di un host. */
  dettaglio: string | null;
  servizi: number;
  host: number;
  /** Cosa risponde, in una riga: i prodotti di una porta, le porte di un host. */
  sintesi: string;
  rilievi: number;
  gravita: RollupRilievi;
  chiaro: number;
  scaduti: number;
  autofirmati: number;
  nonIdentificati: number;
  /** Come restringere l'elenco dei servizi a questo gruppo. */
  filtro: { porta?: number; prodotto?: string; ospite?: number; rete?: number };
}

interface Chiave {
  chiave: string;
  nome: string;
  dettaglio: string | null;
  filtro: GruppoServizi["filtro"];
}

function chiaveDi(r: ServizioVista, per: RaggruppamentoServizi): Chiave {
  if (per === "porta") {
    return { chiave: `porta:${r.porta}/${r.protocollo}`, nome: `${r.porta}/${r.protocollo}`, dettaglio: null, filtro: { porta: r.porta } };
  }
  if (per === "prodotto") {
    const p = r.prodotto ?? "(senza)";
    return { chiave: `prodotto:${p}`, nome: r.prodotto ?? "Prodotto non riconosciuto", dettaglio: null, filtro: { prodotto: p } };
  }
  if (per === "host") {
    return {
      chiave: `host:${r.host_id}`,
      nome: r.hostname || r.ip,
      dettaglio: [r.hostname ? r.ip : null, r.rete].filter(Boolean).join(" · ") || null,
      filtro: { ospite: r.host_id },
    };
  }
  return { chiave: `rete:${r.network_id}`, nome: r.rete ?? `rete ${r.network_id}`, dettaglio: r.cidr, filtro: { rete: r.network_id } };
}

/** I più frequenti in testa: «OpenSSH 70 · dropbear 13 · ROSSSH 15». */
function piuFrequenti(conta: Map<string, number>, quanti: number, coiNumeri: boolean): string {
  const voci = [...conta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const testo = voci.slice(0, quanti).map(([nome, n]) => (coiNumeri ? `${nome} ${n}` : nome)).join(coiNumeri ? " · " : ", ");
  return voci.length > quanti ? `${testo} · altri ${voci.length - quanti}` : testo;
}

interface InCostruzione extends GruppoServizi {
  ospiti: Set<number>;
  nomi: Map<string, number>;
  prodotti: Map<string, number>;
  versioni: Set<string>;
  porte: Map<string, number>;
}

/** Raccoglie i servizi. In cima i gruppi coi rilievi più gravi, poi i più numerosi. */
export function raggruppaServizi(righe: readonly ServizioVista[], per: RaggruppamentoServizi): GruppoServizi[] {
  const mappa = new Map<string, InCostruzione>();
  for (const r of righe) {
    const c = chiaveDi(r, per);
    let g = mappa.get(c.chiave);
    if (!g) {
      g = {
        ...c,
        servizi: 0, host: 0, sintesi: "", rilievi: 0,
        gravita: { Critical: 0, High: 0, Medium: 0, Low: 0 },
        chiaro: 0, scaduti: 0, autofirmati: 0, nonIdentificati: 0,
        ospiti: new Set(), nomi: new Map(), prodotti: new Map(), versioni: new Set(), porte: new Map(),
      };
      mappa.set(c.chiave, g);
    }
    g.servizi += 1;
    g.ospiti.add(r.host_id);
    if (r.nome) g.nomi.set(r.nome, (g.nomi.get(r.nome) ?? 0) + 1);
    if (r.prodotto) g.prodotti.set(r.prodotto, (g.prodotti.get(r.prodotto) ?? 0) + 1);
    if (r.versione) g.versioni.add(r.versione);
    g.porte.set(String(r.porta), (g.porte.get(String(r.porta)) ?? 0) + 1);
    g.rilievi += r.rilievi.length;
    for (const x of r.rilievi) g.gravita[x.gravita] += 1;
    if (r.segnali.includes("chiaro")) g.chiaro += 1;
    if (r.certificato === "scaduto") g.scaduti += 1;
    else if (r.certificato === "autofirmato") g.autofirmati += 1;
    if (r.segnali.includes("non-identificati")) g.nonIdentificati += 1;
  }
  const gruppi = [...mappa.values()].map(({ ospiti, nomi, prodotti, versioni, porte, ...g }): GruppoServizi => {
    let sintesi: string;
    let dettaglio = g.dettaglio;
    if (per === "porta") {
      // Il nome più frequente, non `tcpwrapped`: sulla 22 dell'hub nmap lo scriveva per primo.
      const nome = [...nomi.entries()].filter(([n]) => n !== "tcpwrapped").sort((a, b) => b[1] - a[1])[0]?.[0];
      dettaglio = nome ?? null;
      sintesi = prodotti.size ? piuFrequenti(prodotti, 3, true) : "nessun prodotto riconosciuto";
    } else if (per === "prodotto") {
      const v = versioni.size;
      sintesi = `${v === 0 ? "versione non letta" : v === 1 ? `versione ${[...versioni][0]}` : `${v} versioni`} · porte ${piuFrequenti(porte, 4, false)}`;
    } else if (per === "host") {
      const tutte = [...porte.keys()].map(Number).sort((a, b) => a - b);
      sintesi = `porte ${tutte.slice(0, 10).join(", ")}${tutte.length > 10 ? ` · altre ${tutte.length - 10}` : ""}`;
    } else {
      sintesi = `${porte.size} porte diverse · ${prodotti.size ? piuFrequenti(prodotti, 3, true) : "nessun prodotto riconosciuto"}`;
    }
    return { ...g, dettaglio, sintesi, host: ospiti.size };
  });
  gruppi.sort(
    (a, b) =>
      b.gravita.Critical - a.gravita.Critical ||
      b.gravita.High - a.gravita.High ||
      b.chiaro - a.chiaro ||
      b.scaduti - a.scaduti ||
      b.servizi - a.servizi ||
      a.nome.localeCompare(b.nome, "it", { numeric: true }),
  );
  return gruppi;
}
