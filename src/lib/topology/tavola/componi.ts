/**
 * Dal modello della mappa e dalle porte lette alla tavola (spec tavola §3): per ogni apparato del sito l'elenco delle
 * porte con tipo e destinazione, e i cavi fra due porte della tavola. Non ricalcola niente della Topologia: i
 * collegamenti sono quelli del modello, così le due viste non possono dire cose diverse sullo stesso cavo.
 * Le porte di un collegamento si abbinano all'elenco come fa `cavi/porte.ts` (indice, nome, nome normalizzato); un nome
 * che l'elenco non ha diventa una porta fantasma in fondo, invece di sparire (spec §7). Logica pura.
 */
import { elencoDa, indiciInElenco, normale } from "@/lib/topology/cavi/porte";
import type { MapLink, MapNode } from "@/lib/topology/model-types";
import type { ApparatoComposto, ApparatoPorte, CavoComposto, PortaComposta, PortaTavola, TavolaComposta, TipoPorta } from "./tipi";

const RETE = new Set(["router", "firewall", "switch", "access_point", "ap", "gateway", "wireless", "l3_switch"]);
const SERVER = new Set(["hypervisor", "server", "proxmox", "vmware", "nas", "storage"]);
const VENDOR_HYPERVISOR = /proxmox|vmware|esxi|hyper-?v/i;

export function eRete(n: MapNode): boolean {
  if (n.kind !== "device") return false;
  if (n.ruolo === "core" || n.ruolo === "accesso" || n.ruolo === "rete") return true;
  return RETE.has(n.type.toLowerCase());
}

export function eServer(n: MapNode): boolean {
  return n.proxmoxScan === true || SERVER.has(n.type.toLowerCase()) || VENDOR_HYPERVISOR.test(n.vendor ?? "");
}

/** 0 router e firewall, 1 nucleo, 2 accesso e gli altri switch, 3 hypervisor e server, 4 il resto (spec §3, righe). */
export function rangoDi(n: MapNode): number {
  const t = n.type.toLowerCase();
  if (t === "router" || t === "firewall" || t === "gateway") return 0;
  if (n.ruolo === "core") return 1;
  if (eRete(n)) return 2;
  if (eServer(n)) return 3;
  return 4;
}

/** Il numero corto dentro il quadrato: le ultime cifre del nome («Gi1/0/17» → 17), «S» davanti per una SFP. */
export function numeroCorto(nome: string, indice: number | null): string {
  const cifre = /(\d+)(?!.*\d)/.exec(nome);
  if (cifre) return /sfp/i.test(nome) ? `S${cifre[1]}` : cifre[1];
  if (indice !== null) return String(indice);
  return nome.trim().slice(0, 3) || "?";
}

/** Il tipo di un collegamento, uguale dai due capi: così il cavo e le sue due porte hanno lo stesso colore. */
export function tipoCollegamento(l: MapLink, a: MapNode | undefined, b: MapNode | undefined, sito: number): TipoPorta {
  const fuori = (n: MapNode | undefined) => !n || (n.siteId !== null && n.siteId !== sito);
  if (l.cavo?.wan || fuori(a) || fuori(b)) return "linea";
  if (l.cavo?.fascio || (a && b && eRete(a) && eRete(b))) return "trunk";
  if ((a && eServer(a)) || (b && eServer(b))) return "server";
  if (a && b && a.kind === "device" && b.kind === "device") return "trunk";
  return "client";
}

function destinazione(tipo: TipoPorta, altro: MapNode | undefined, portaAltra: string): string {
  const nome = altro?.name ?? "fuori dalla mappa";
  const p = portaAltra.trim();
  if (tipo === "trunk") return p ? `${nome} p${numeroCorto(p, null)}` : nome;
  if (tipo === "server") return p ? `${nome} ${p}` : nome;
  return nome;
}

/** La porta di un apparato senza collegamento: il tipo e cosa scrivere dai soli dati della porta. */
function senzaCollegamento(p: PortaTavola): { tipo: TipoPorta; destinazione: string | null } {
  if (p.stato === "down" || p.stato === "disabled") return { tipo: "libera", destinazione: null };
  if (p.macCount <= 1 && (p.nomeClient || p.ipClient)) return { tipo: "client", destinazione: p.nomeClient || p.ipClient };
  // Più MAC su una porta di bordo non vuol dire trunk 802.1Q (trappola in CONTEXT): si dice quanti sono.
  if (p.macCount > 1) return { tipo: "molti", destinazione: `${p.macCount} MAC` };
  return { tipo: "attiva", destinazione: null };
}

interface Lavoro {
  apparato: ApparatoComposto;
  righe: PortaTavola[];
  elenco: ReturnType<typeof elencoDa> | null;
  /** indice nella lista delle porte (posizione) → porta composta */
  composte: PortaComposta[];
}

export function componiTavola(input: { sito: number; nodi: readonly MapNode[]; collegamenti: readonly MapLink[]; apparati: readonly ApparatoPorte[] }): TavolaComposta {
  const perId = new Map(input.nodi.map((n) => [n.id, n]));
  const porteDi = new Map(input.apparati.map((a) => [a.node, a.porte]));
  const lavori = new Map<string, Lavoro>();
  for (const n of input.nodi) {
    if (n.kind !== "device" || n.hidden || n.siteId !== input.sito) continue;
    const righe = [...(porteDi.get(n.id) ?? [])].sort((x, y) => (x.indice ?? 1e9) - (y.indice ?? 1e9));
    const conIndice = righe.filter((r): r is PortaTavola & { indice: number } => r.indice !== null);
    const apparato: ApparatoComposto = { nodo: n.id, refId: n.refId, nome: n.name, tipo: n.type, ip: n.mgmtIp, rackId: n.rackId, rango: rangoDi(n), porte: [] };
    const composte = righe.map((r, i): PortaComposta => {
      const s = senzaCollegamento(r);
      return {
        id: `${n.id}|${i}`, nodo: n.id, numero: numeroCorto(r.nome, r.indice), nome: r.nome, tipo: s.tipo, destinazione: s.destinazione,
        dubbio: false, collegamento: null, altroNodo: null, fantasma: false, fascio: null, velocita: r.velocita, vlan: r.vlan,
      };
    });
    lavori.set(n.id, {
      apparato, righe, composte,
      elenco: conIndice.length > 0 ? elencoDa(conIndice.map((r) => ({ port_index: r.indice, port_name: r.nome }))) : null,
    });
  }

  /** La porta del collegamento sull'apparato: per indice o per nome; altrimenti una porta fantasma col nome letto. */
  const trova = (w: Lavoro, nome: string, chiaveFantasma: string): PortaComposta => {
    const n = nome.trim();
    if (n !== "") {
      if (w.elenco) {
        const ind = indiciInElenco(w.elenco, n);
        if (ind.length === 1) {
          const i = w.righe.findIndex((r) => r.indice === ind[0]);
          if (i >= 0) return w.composte[i];
        }
      }
      const i = w.righe.findIndex((r) => r.nome.trim() === n);
      if (i >= 0) return w.composte[i];
      const j = w.righe.findIndex((r) => normale(r.nome) === normale(n));
      if (j >= 0) return w.composte[j];
      const gia = w.composte.find((c) => c.fantasma && normale(c.nome) === normale(n));
      if (gia) return gia;
    } else {
      const gia = w.composte.find((c) => c.id === `${w.apparato.nodo}|f:${chiaveFantasma}`);
      if (gia) return gia;
    }
    const f: PortaComposta = {
      id: `${w.apparato.nodo}|f:${n !== "" ? normale(n) : chiaveFantasma}`, nodo: w.apparato.nodo, numero: n ? numeroCorto(n, null) : "?",
      nome: n || "porta non nota", tipo: "attiva", destinazione: null, dubbio: false, collegamento: null, altroNodo: null, fantasma: true,
      fascio: null, velocita: null, vlan: null,
    };
    w.composte.push(f);
    w.righe.push({ indice: null, nome: f.nome, stato: null, velocita: null, vlan: null, trunk: false, macCount: 0, nomeClient: null, ipClient: null, poeW: null });
    return f;
  };

  const segna = (p: PortaComposta, l: MapLink, tipo: TipoPorta, altro: MapNode | undefined, portaAltra: string, riga: PortaTavola | undefined, fascio: string | null) => {
    const dest = destinazione(tipo, altro, portaAltra);
    if (p.collegamento !== null && p.collegamento !== l.id) {
      // Più collegamenti sulla stessa porta (un segmento, un apparato non letto in mezzo): si dice il primo e quanti altri.
      const m = /\(\+(\d+)\)$/.exec(p.destinazione ?? "");
      p.destinazione = `${(p.destinazione ?? "").replace(/ \(\+\d+\)$/, "")} (+${m ? Number(m[1]) + 1 : 1})`;
      return;
    }
    p.tipo = tipo;
    p.destinazione = dest;
    p.collegamento = l.id;
    p.altroNodo = altro?.id ?? null;
    p.fascio = fascio;
    const giu = riga?.stato === "down" || riga?.stato === "disabled";
    p.dubbio = l.stale || l.cavo?.porteDaVerificare === true || giu;
  };

  const cavi: CavoComposto[] = [];
  const visti = new Set<string>();
  for (const l of input.collegamenti) {
    if (visti.has(l.id)) continue;
    visti.add(l.id);
    const wa = lavori.get(l.a), wb = lavori.get(l.b);
    if (!wa && !wb) continue;
    const na = perId.get(l.a), nb = perId.get(l.b);
    const tipo = tipoCollegamento(l, na, nb, input.sito);
    const membri = l.cavo?.fascio?.membri ?? [];
    const coppie = membri.length > 0
      ? membri.map((m, i) => ({ aPort: m.aPort, bPort: m.bPort, id: `${l.id}#${i}`, fascio: l.id as string | null }))
      : [{ aPort: l.aPort, bPort: l.bPort, id: l.id, fascio: null as string | null }];
    for (const c of coppie) {
      const pa = wa ? trova(wa, c.aPort, `${c.id}:a`) : null;
      const pb = wb ? trova(wb, c.bPort, `${c.id}:b`) : null;
      if (pa && wa) segna(pa, l, tipo, nb, c.bPort, wa.righe[wa.composte.indexOf(pa)], c.fascio);
      if (pb && wb) segna(pb, l, tipo, na, c.aPort, wb.righe[wb.composte.indexOf(pb)], c.fascio);
      if (pa && pb && pa.id !== pb.id) cavi.push({ id: c.id, collegamento: l.id, da: pa.id, a: pb.id, tipo, dubbio: pa.dubbio || pb.dubbio });
    }
  }

  const apparati = [...lavori.values()].map((w) => ({ ...w.apparato, porte: w.composte }));
  return { apparati, cavi };
}
