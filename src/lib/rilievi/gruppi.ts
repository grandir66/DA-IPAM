/**
 * Findings a gruppi (revisione d'uso del 10/11/2026, Riccardo: «Sì, scrivila»; poi «le voci
 * Vulnerabilità e Findings dovrebbero dire la stessa cosa con motori diversi e raggruppati in
 * tutti i migliori modi»).
 *
 * Sull'hub c'erano 2.705 rilievi da rivedere e nessuno rivisto: una riga per CVE non si
 * smaltisce. Qui gli stessi rilievi si leggono in tre modi: per **cosa aggiornare** (il software
 * che li chiude), per **host** e per **rete**. Modulo puro: niente database, lo stato resta per
 * rilievo in `triage_rilievi`.
 */
import { SEVERITY_RANK } from "@/lib/severity-style";
import type { StatoTriage } from "@/lib/triage/db";
import type { OspiteRilievo, RilievoUnito, RollupRilievi } from "./tipi";

export const RAGGRUPPAMENTI = ["software", "host", "rete"] as const;
export type Raggruppamento = (typeof RAGGRUPPAMENTI)[number];

export type TipoGruppo = "software" | "edge" | "senza" | "host" | "rete";

export interface GruppoRilievi {
  /** Chiave stabile del gruppo (`sw:<nome>`, `edge`, `senza`, `host:<id>`, `ip:<ip>`, `rete:<id>`…). */
  chiave: string;
  tipo: TipoGruppo;
  nome: string;
  /** Riga sotto il nome: l'IP e la rete di un host; null dove non serve. */
  dettaglio: string | null;
  /** Quanti rilievi raccoglie. */
  rilievi: number;
  /** Host distinti toccati dal gruppo (per un host vale 1). */
  host: number;
  gravita: RollupRilievi;
  /** Rilievi sfruttati attivamente (CISA KEV) e con exploit pubblico (Exploit-DB). */
  kev: number;
  edb: number;
  triage: Record<StatoTriage, number>;
  /** Solo i rilievi ancora «Da rivedere»: «Prendi in carico» non tocca ciò che è già deciso. */
  chiaviDaFare: string[];
  /** I primi titoli, i più gravi in testa: l'anteprima del gruppo aperto. */
  anteprima: string[];
  /** Come restringere l'elenco per rilievo a questo gruppo («Apri l'elenco»). */
  filtro: { q?: string; rete?: number; ospite?: number } | null;
}

const ANTEPRIMA = 12;

/**
 * Il nome del software da un'etichetta «nome versione» di Wazuh. In coda possono esserci più
 * pezzi che non sono il nome: «67.0.2 (x64 it)», o la versione scritta due volte («… Standard
 * 10.0.17763.8880 10.0.17763.8880», visto sull'hub il 10/11). Un numero senza punti resta:
 * «Windows Server 2019» è un nome. I pacchetti del kernel Linux portano la versione dentro il
 * nome (`linux-image-6.8.0-147-generic`): sono lo stesso aggiornamento, un gruppo solo.
 */
export function nomeSoftware(etichetta: string | null | undefined): string | null {
  const t = (etichetta ?? "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  let nome = t;
  for (;;) {
    const senzaParentesi = nome.replace(/\s*\([^()]*\)$/, "");
    const senzaVersione = senzaParentesi.replace(/\s+v?\d+(?:[._-][\w+~:]+)+$/i, "");
    const prossimo = senzaVersione.trim();
    if (!prossimo || prossimo === nome) break;
    nome = prossimo;
  }
  if (/^linux-(image|headers|modules|tools)\b/i.test(nome)) return "Kernel Linux";
  return nome;
}

/** L'etichetta è il nome di un test di scansione, non un software («… RCE Vulnerability …», «Debian: Security Advisory»). */
export function eNomeDiTest(nome: string): boolean {
  return /\b(vulnerabilit(y|ies)|security advisory|detection)\b/i.test(nome) || /:\s/.test(nome);
}

interface Appartenenza {
  /** La gravità del rilievo dentro questo gruppo, quando non è quella della riga. */
  gravita?: RilievoUnito["gravita"];
  chiave: string;
  tipo: TipoGruppo;
  nome: string;
  dettaglio: string | null;
  filtro: GruppoRilievi["filtro"];
}

function ospitiDi(r: RilievoUnito): OspiteRilievo[] {
  if (r.ospiti?.length) return r.ospiti;
  if (r.host_id != null || r.ip) {
    return [{ host_id: r.host_id, ip: r.ip ?? "", nome: null, network_id: r.network_id, network_name: r.network_name }];
  }
  return [];
}

const chiaveOspite = (o: OspiteRilievo): string => (o.host_id != null ? `host:${o.host_id}` : `ip:${o.ip}`);

function appartenenze(r: RilievoUnito, per: Raggruppamento): Appartenenza[] {
  if (per === "software") {
    const sw = nomeSoftware(r.pacchetto);
    if (sw && !eNomeDiTest(sw)) {
      return [{ chiave: `sw:${sw.toLowerCase()}`, tipo: "software", nome: sw, dettaglio: null, filtro: { q: sw === "Kernel Linux" ? "linux-" : sw } }];
    }
    if (r.cve_key) return [{ chiave: "edge", tipo: "edge", nome: "Vulnerabilità senza un pacchetto indicato", dettaglio: null, filtro: null }];
    return [{ chiave: "senza", tipo: "senza", nome: "Senza un aggiornamento da fare", dettaglio: null, filtro: null }];
  }
  const ospiti = ospitiDi(r);
  if (per === "host") {
    if (ospiti.length === 0) return [{ chiave: "senza", tipo: "senza", nome: "Senza un host preciso", dettaglio: null, filtro: null }];
    return ospiti.map((o) => ({
      chiave: chiaveOspite(o),
      tipo: "host" as const,
      nome: o.nome || o.ip || "host senza nome",
      dettaglio: [o.nome ? o.ip : null, o.network_name].filter(Boolean).join(" · ") || null,
      filtro: o.host_id != null ? { ospite: o.host_id } : o.ip ? { q: o.ip } : null,
      gravita: o.gravita,
    }));
  }
  const reti = new Map<string, Appartenenza>();
  for (const o of ospiti) {
    if (o.network_id != null) {
      // In una rete il rilievo vale quanto il suo host più grave lì.
      const sua = o.gravita ?? r.gravita;
      const prima = reti.get(`rete:${o.network_id}`)?.gravita;
      reti.set(`rete:${o.network_id}`, {
        chiave: `rete:${o.network_id}`, tipo: "rete", nome: o.network_name ?? `rete ${o.network_id}`, dettaglio: null, filtro: { rete: o.network_id },
        gravita: prima && (SEVERITY_RANK[prima] ?? 0) >= (SEVERITY_RANK[sua] ?? 0) ? prima : sua,
      });
    } else if (o.network_name) {
      reti.set(`nome:${o.network_name}`, { chiave: `nome:${o.network_name}`, tipo: "rete", nome: o.network_name, dettaglio: null, filtro: { q: o.network_name } });
    }
  }
  if (reti.size === 0 && r.network_name) {
    reti.set(`nome:${r.network_name}`, { chiave: `nome:${r.network_name}`, tipo: "rete", nome: r.network_name, dettaglio: null, filtro: { q: r.network_name } });
  }
  if (reti.size === 0) return [{ chiave: "senza", tipo: "senza", nome: "Senza una rete di DA-IPAM", dettaglio: null, filtro: null }];
  return [...reti.values()];
}

interface InCostruzione extends GruppoRilievi {
  ordinati: RilievoUnito[];
  ospiti: Set<string>;
  hostDichiarati: number;
}

/**
 * Raccoglie i rilievi. Un rilievo su più host (una CVE) entra nel gruppo di ognuno dei suoi host
 * e di ognuna delle loro reti. Ordine: sfruttati attivamente, exploit pubblico, critici, alti.
 */
export function raggruppa(righe: readonly RilievoUnito[], per: Raggruppamento): GruppoRilievi[] {
  const mappa = new Map<string, InCostruzione>();
  for (const r of righe) {
    const tuttiGliOspiti = ospitiDi(r);
    for (const a of appartenenze(r, per)) {
      let gr = mappa.get(a.chiave);
      if (!gr) {
        gr = {
          ...a,
          rilievi: 0,
          host: 0,
          gravita: { Critical: 0, High: 0, Medium: 0, Low: 0 },
          kev: 0,
          edb: 0,
          triage: { da_fare: 0, in_corso: 0, fatto: 0, ignorato: 0 },
          chiaviDaFare: [],
          anteprima: [],
          ordinati: [],
          ospiti: new Set(),
          hostDichiarati: 0,
        };
        mappa.set(a.chiave, gr);
      }
      gr.rilievi += 1;
      // Per host e per rete conta la gravità che il rilievo ha LÌ, non la più alta fra tutti gli host.
      const grav = a.gravita ?? r.gravita;
      if (grav in gr.gravita) gr.gravita[grav as keyof RollupRilievi] += 1;
      if (r.exploit?.kev) gr.kev += 1;
      if (r.exploit?.edb) gr.edb += 1;
      const stato = r.triage?.stato ?? "da_fare";
      gr.triage[stato] += 1;
      if (stato === "da_fare") gr.chiaviDaFare.push(r.chiaveTriage);
      gr.ordinati.push(r);
      if (a.tipo === "host") gr.ospiti.add(a.chiave);
      else if (a.tipo === "rete") {
        for (const o of tuttiGliOspiti) if (a.filtro?.rete == null || o.network_id === a.filtro.rete) gr.ospiti.add(chiaveOspite(o));
      } else {
        for (const o of tuttiGliOspiti) gr.ospiti.add(chiaveOspite(o));
        gr.hostDichiarati = Math.max(gr.hostDichiarati, r.host_count);
      }
    }
  }
  const gruppi = [...mappa.values()].map(({ ordinati, ospiti, hostDichiarati, ...g }): GruppoRilievi => {
    ordinati.sort((a, b) => (SEVERITY_RANK[b.gravita] ?? 0) - (SEVERITY_RANK[a.gravita] ?? 0) || a.titolo.localeCompare(b.titolo));
    return {
      ...g,
      host: Math.max(ospiti.size, hostDichiarati),
      chiaviDaFare: [...new Set(g.chiaviDaFare)],
      anteprima: ordinati.slice(0, ANTEPRIMA).map((r) => r.titolo),
    };
  });
  // I gruppi-contenitore stanno in fondo: non sono «una cosa da fare».
  const peso = (g: GruppoRilievi) => (g.tipo === "edge" ? 1 : g.tipo === "senza" ? 2 : 0);
  gruppi.sort(
    (a, b) =>
      peso(a) - peso(b) ||
      Number(b.kev > 0) - Number(a.kev > 0) ||
      Number(b.edb > 0) - Number(a.edb > 0) ||
      b.gravita.Critical - a.gravita.Critical ||
      b.gravita.High - a.gravita.High ||
      b.rilievi - a.rilievi ||
      a.nome.localeCompare(b.nome),
  );
  return gruppi;
}

export interface IndicatoriRilievi {
  /** Rilievi con una CVE sfruttata attivamente, e su quanti host. */
  kev: number;
  kevHost: number;
  /** Quanti aggiornamenti bastano a chiudere metà dei rilievi critici (0 = nessun critico con un software). */
  aggiornamentiPerMeta: number;
  criticiConSoftware: number;
  /** L'host con più rilievi critici; null se nessun host ne ha. */
  hostPiuEsposto: { nome: string; critici: number; ospite: number | null } | null;
}

/** I numeri della fascia in testata: dicono dove guardare, e un clic li usa come filtro. */
export function indicatori(righe: readonly RilievoUnito[]): IndicatoriRilievi {
  const kevRighe = righe.filter((r) => r.exploit?.kev);
  const kevOspiti = new Set<string>();
  for (const r of kevRighe) for (const o of ospitiDi(r)) kevOspiti.add(chiaveOspite(o));

  const perSoftware = raggruppa(righe, "software").filter((g) => g.tipo === "software" && g.gravita.Critical > 0);
  const criticiConSoftware = perSoftware.reduce((a, g) => a + g.gravita.Critical, 0);
  let somma = 0;
  let aggiornamentiPerMeta = 0;
  for (const g of [...perSoftware].sort((a, b) => b.gravita.Critical - a.gravita.Critical)) {
    if (somma * 2 >= criticiConSoftware) break;
    somma += g.gravita.Critical;
    aggiornamentiPerMeta += 1;
  }

  const peggiore = raggruppa(righe, "host")
    .filter((g) => g.tipo === "host" && g.gravita.Critical > 0)
    .sort((a, b) => b.gravita.Critical - a.gravita.Critical || a.nome.localeCompare(b.nome))[0];

  return {
    kev: kevRighe.length,
    kevHost: kevOspiti.size,
    aggiornamentiPerMeta,
    criticiConSoftware,
    hostPiuEsposto: peggiore ? { nome: peggiore.nome, critici: peggiore.gravita.Critical, ospite: peggiore.filtro?.ospite ?? null } : null,
  };
}

export interface BarraRete {
  network_id: number;
  network_name: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

/**
 * Le barre «rilievi per rete» della fascia in testata, sugli stessi rilievi dell'elenco: una
 * tacca per ogni host toccato (una CVE su tre host di una rete conta tre). `soloOspite` restringe
 * il conto a un host, quando l'elenco è filtrato su di lui.
 */
export function barrePerRete(righe: readonly RilievoUnito[], soloOspite?: number): BarraRete[] {
  const reti = new Map<number, BarraRete>();
  for (const r of righe) {
    for (const o of ospitiDi(r)) {
      if (o.network_id == null) continue;
      if (soloOspite != null && o.host_id !== soloOspite) continue;
      let b = reti.get(o.network_id);
      if (!b) {
        b = { network_id: o.network_id, network_name: o.network_name ?? `rete ${o.network_id}`, critical: 0, high: 0, medium: 0, low: 0, total: 0 };
        reti.set(o.network_id, b);
      }
      const grav = o.gravita ?? r.gravita;
      if (grav === "Critical") b.critical += 1;
      else if (grav === "High") b.high += 1;
      else if (grav === "Medium") b.medium += 1;
      else b.low += 1;
      b.total += 1;
    }
  }
  return [...reti.values()].sort((a, b) => b.total - a.total || a.network_name.localeCompare(b.network_name));
}
