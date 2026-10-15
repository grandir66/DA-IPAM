/**
 * Il modello per cavo: una linea per collegamento (spec topologia §13.7.2-13.7.6, §13.6.3; T2 in ombra, T3 a schermo). Le
 * prove per porta (prove.ts) diventano collegamenti — cavi, fasci, tunnel, ponti radio, collegamenti senza fili,
 * appartenenze a un segmento — con lo stato dai due capi (inoltra, bloccato, instradato, riserva del bond, giù), la fiducia e
 * il verso quando una prova lo dice. Le correzioni «ignora» valgono per cavo. Nessun prodotto: solo fatti neutri (I37).
 * Logica pura e deterministica (stessi dati, stessi collegamenti: I39).
 */
import { parseDbDate } from "@/lib/db-date";
import { correzioniOrfane, ignorato, regoleIgnora } from "@/lib/topology/ignorati";
import { eRadioDalleCapacita, indiceDelFascio } from "@/lib/topology/lettori/fonti";
import type { LinkOverrideRow } from "@/lib/topology/model-types";
import type { NodeIndex } from "@/lib/topology/node-index";
import { normale, type ElencoPorte, type Porta } from "./porte";
import { portaVuota, type IndiceFatti, type Prova } from "./prove";

export type Genere = "cavo" | "fascio" | "tunnel" | "radio" | "senza_fili" | "segmento";
export type StatoCollegamento = "inoltra" | "bloccato" | "bloccato_comune" | "instradato" | "riserva_bond" | "giu" | null;
export type Fiducia = "certo" | "probabile" | "dedotto" | "a_mano_confermato" | "a_mano";

export interface Collegamento {
  /** Il genere più i due capi ordinati con la chiave della porta. */
  id: string;
  /** Per il genere «segmento», `b` è il segmento. */
  a: Porta;
  b: Porta;
  genere: Genere;
  membri?: Array<{ a: Porta; b: Porta; stato: StatoCollegamento }>;
  /** Il nome del fascio dai due capi (per la porta radice di un bridge che è un fascio). */
  fascio?: { a: string | null; b: string | null };
  /** Fascio senza la prova del fascio: due cavi in inoltro con lo spanning tree attivo fra loro (§13.6.3). */
  fascioDedotto?: boolean;
  stato: StatoCollegamento;
  /** Bloccato nell'albero comune, attivo in un'istanza: le VLAN di quell'istanza. */
  attivoPerVlan?: number[];
  fiducia: Fiducia;
  /** Il figlio, se una prova di verso lo dice. */
  verso: string | null;
  velocitaMbps: number | null;
  /** La prova accoppia porte con velocità diverse (§13.6.1, I45). */
  porteDaVerificare: boolean;
  prove: Prova[];
  frasi: string[];
  /** Nessuna prova vista entro la soglia «non visto» (le correzioni a mano non invecchiano). */
  nonVisto: boolean;
  /** «Instradato (WAN)»: l'uplink di un gateway del controller (§13.8.3, punto 1). */
  wan?: boolean;
  /** Fra router, un annuncio di segmento come unico vicino: probabile, «attraverso apparati non letti». */
  attraverso?: boolean;
  /** VM accese dell'hypervisor che passano dalla porta (§12.5). */
  vm?: number;
}

export interface Segmento { id: string; membri: Porta[]; altriApparati: number; frase: string }

export interface ContestoCavi {
  nowMs: number;
  staleDays: number;
  /** nodo → elenco delle porte, con la precedenza del §13.5.7. */
  porte: ReadonlyMap<string, ElencoPorte>;
  /** I fatti di porta e di bridge, già filtrati all'ultimo giro (§13.5.7). */
  fatti: IndiceFatti;
  /** «nodo|chiave» → stato da switch_ports.status. */
  statoPorte: ReadonlyMap<string, "su" | "giu" | "spenta">;
  /** «nodo|chiave» → velocità in Mbps. */
  velocita: ReadonlyMap<string, number>;
  /** nodo → MAC dell'apparato (MAIUSCOLO), dai lettori e dall'inventario. */
  macApparati: ReadonlyMap<string, ReadonlySet<string>>;
  idx: NodeIndex;
  /** I router e i firewall (le regole dei router, §13.7.2 passo 5). */
  router: ReadonlySet<string>;
  /** VM → il suo hypervisor: un hypervisor e le sue VM sentiti sulla stessa porta sono un apparato solo. */
  vmIpervisore: ReadonlyMap<string, string>;
  /** La porta di una correzione salvata (`portaSalvata` di links.ts: anche la forma di prima di T1). */
  portaSalvata: (nodo: string, nome: string) => Porta | null;
}

export interface RisultatoCavi {
  collegamenti: Collegamento[];
  segmenti: Segmento[];
  /** Le prove che non diventano un collegamento: stessa rete, tunnel spenti o non letti. */
  stessaRete: Prova[];
  correzioniOrfane: number[];
}

const DAY_MS = 86_400_000;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
function tempo(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = parseDbDate(s).getTime();
  return Number.isNaN(t) ? null : t;
}
const chiaveDi = (p: Pick<Porta, "nodo" | "chiave" | "nome">): string => `${p.nodo}|${p.chiave ?? `?${normale(p.nome)}`}`;
const compatibili = (x: Porta, y: Porta): boolean => x.chiave === null || y.chiave === null || x.chiave === y.chiave;
const unisci = (x: Porta, y: Porta): Porta => (x.chiave !== null ? x : y.chiave !== null ? y : x.nome !== "" ? x : y);
export const capo = (c: Pick<Collegamento, "a" | "b">, nodo: string): Porta => (c.a.nodo === nodo ? c.a : c.b);
export const altroCapo = (c: Pick<Collegamento, "a" | "b">, nodo: string): Porta => (c.a.nodo === nodo ? c.b : c.a);
const macDelBridge = (id: string | null): string | null => (id ? (id.split(".").pop() ?? "").toUpperCase() : null);

interface Bozza {
  genere: Genere; a: Porta; b: Porta; prove: Prova[]; osservatori: Set<string>;
  verso: string | null; porteDaVerificare: boolean; wan: boolean; attraverso: boolean; vm: number;
}

const PAROLE_FIDUCIA: Readonly<Record<Fiducia, string>> = {
  certo: "certo: lo vedono tutti e due gli apparati", probabile: "probabile", dedotto: "dedotto",
  a_mano_confermato: "a mano, confermato dai dati", a_mano: "a mano, non visto dai dati",
};

function vlanDa(testo: string | null): number[] {
  const out: number[] = [];
  for (const parte of (testo ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "")) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(parte);
    if (!m) continue;
    const da = Number(m[1]), a = m[2] ? Number(m[2]) : da;
    for (let v = da; v <= a && out.length < 4096; v++) out.push(v);
  }
  return out;
}

export function costruisciCollegamenti(prove: readonly Prova[], correzioni: readonly LinkOverrideRow[], ctx: ContestoCavi): RisultatoCavi {
  const finestra = ctx.staleDays * DAY_MS;
  const velocitaDi = (p: Porta): number | null => (p.chiave ? (ctx.velocita.get(`${p.nodo}|${p.chiave}`) ?? null) : null);
  const contabile = (p: Porta): boolean => p.certa && p.chiave !== null && (p.fisica === true || p.senzaFili === true);

  // Passo 2: la freschezza di una prova rispetto alla lettura più recente dello stesso apparato e lettore (I43).
  const ultima = new Map<string, number>();
  for (const p of prove) {
    const t = tempo(p.visto);
    const k = `${p.da.nodo}|${p.lettore}`;
    if (t !== null) ultima.set(k, Math.max(ultima.get(k) ?? t, t));
  }
  const fresca = (p: Prova): boolean => {
    const t = tempo(p.visto);
    const u = ultima.get(`${p.da.nodo}|${p.lettore}`);
    return t === null || u === undefined || t >= u - finestra;
  };
  const apparato = (p: Prova): string => {
    const b = p.altro?.nodo ?? null;
    return b ? `nodo:${ctx.vmIpervisore.get(b) ?? b}` : (p.telaio ?? "?");
  };

  // Passo 2: gli apparati di ogni porta fisica e nota, sentiti con un annuncio di collegamento, contati per apparato.
  const vicini = prove.filter((p) => p.altro !== null && p.altro.nodo !== p.da.nodo && (p.classe === "annuncio_collegamento" || p.classe === "annuncio_segmento")
    && (p.tipo === "cavo" || p.tipo === "senza_fili" || p.tipo === "stessa_rete"));
  const sentiti = new Map<string, Map<string, Prova>>();
  for (const p of prove) {
    if ((p.tipo !== "cavo" && p.tipo !== "senza_fili") || p.classe !== "annuncio_collegamento") continue;
    if (!contabile(p.da) || !fresca(p) || p.altro?.nodo === p.da.nodo) continue;
    const m = sentiti.get(chiaveDi(p.da)) ?? new Map<string, Prova>();
    m.set(apparato(p), p);
    sentiti.set(chiaveDi(p.da), m);
  }
  // Le due radio di un ponte sulla stessa porta (§13.7.6, punto 3): non un segmento. La lontana annuncia da un'interfaccia
  // senza fili; se non si riconosce chi è la lontana, il segmento resta.
  const ponti = new Map<string, { vicina: Prova; lontana: Prova }>();
  for (const [k, m] of sentiti) {
    if (m.size !== 2) continue;
    const [x, y] = [...m.values()];
    if (!eRadioDalleCapacita(x.capacita ?? null) || !eRadioDalleCapacita(y.capacita ?? null)) continue;
    if (!!x.annunciaSenzaFili === !!y.annunciaSenzaFili) continue;
    ponti.set(k, x.annunciaSenzaFili ? { vicina: y, lontana: x } : { vicina: x, lontana: y });
  }
  const diSegmento = new Set([...sentiti].filter(([k, m]) => m.size >= 2 && !ponti.has(k)).map(([k]) => k));

  const bozze: Bozza[] = [];
  const aggiungi = (genere: Genere, pa: Porta, pb: Porta, p: Prova, osservatore: string | null, distinto = false): Bozza => {
    for (const z of bozze) {
      if (distinto || z.genere !== genere) continue;
      const diritto = z.a.nodo === pa.nodo && z.b.nodo === pb.nodo && compatibili(z.a, pa) && compatibili(z.b, pb);
      const rovescio = !diritto && z.a.nodo === pb.nodo && z.b.nodo === pa.nodo && compatibili(z.a, pb) && compatibili(z.b, pa);
      if (!diritto && !rovescio) continue;
      if (diritto) { z.a = unisci(z.a, pa); z.b = unisci(z.b, pb); } else { z.a = unisci(z.a, pb); z.b = unisci(z.b, pa); }
      z.prove.push(p);
      if (osservatore) z.osservatori.add(osservatore);
      if (p.vm) z.vm = Math.max(z.vm, p.vm);
      return z;
    }
    const z: Bozza = { genere, a: pa, b: pb, prove: [p], osservatori: new Set(osservatore ? [osservatore] : []), verso: null, porteDaVerificare: false, wan: false, attraverso: false, vm: p.vm ?? 0 };
    bozze.push(z);
    return z;
  };

  // Passi 1, 3, 5, 6: i vicini. Il ritorno serve alla conferma per porta dei router e al salto radio.
  const vede = (x: string, y: string, porta: Porta): boolean => vicini.some((q) => q.da.nodo === x && q.altro?.nodo === y
    && q.classe === "annuncio_collegamento" && (q.tipo === "cavo" || q.tipo === "senza_fili") && !diSegmento.has(chiaveDi(q.da))
    && porta.chiave !== null && q.altro.chiave === porta.chiave);
  const uplinkVerso = (figlio: string, padre: string, porta: Porta): boolean => prove.some((q) => q.classe === "uplink"
    && q.da.nodo === figlio && q.altro?.nodo === padre && porta.chiave !== null && q.altro.chiave === porta.chiave);
  const tuttiSu = new Map<string, Set<string>>();
  for (const p of vicini) {
    const s = tuttiSu.get(chiaveDi(p.da)) ?? new Set<string>();
    s.add(p.altro!.nodo);
    tuttiSu.set(chiaveDi(p.da), s);
  }
  const portaDelRouter = (p: Prova): boolean => p.da.senzaFili === true || (p.traduttoreLocale ? p.da.fisica === true : p.da.fisica !== false);
  const stessaRete: Prova[] = [];
  for (const p of vicini) {
    const k = chiaveDi(p.da);
    const b = p.altro!;
    if (diSegmento.has(k)) continue;                                        // passo 2 (I7)
    if (ponti.get(k)?.lontana === p) continue;                              // la radio lontana sta dopo il salto
    if (p.da.fisica === false && p.da.senzaFili !== true) { stessaRete.push(p); continue; }   // passo 1 (I5)
    const collegamento = p.classe === "annuncio_collegamento";
    if (ctx.router.has(p.da.nodo)) {
      if (!portaDelRouter(p)) { stessaRete.push(p); continue; }             // un nome scelto non è una porta fisica (I58)
      const confermato = vede(b.nodo, p.da.nodo, p.da) || uplinkVerso(b.nodo, p.da.nodo, p.da);
      if (!collegamento) {
        // Un annuncio di segmento non conferma mai (M-5): vale solo come unico vicino su una porta fisica, contando tutte le
        // righe della porta (§11.1, come oggi), probabile «attraverso apparati non letti» (I51).
        if ((tuttiSu.get(k)?.size ?? 0) !== 1 || p.da.fisica !== true) { stessaRete.push(p); continue; }
        aggiungi("cavo", p.da, b, p, null).attraverso = true;
        continue;
      }
      const unico = (sentiti.get(k)?.size ?? 0) <= 1 || ponti.has(k);   // le due radio di un ponte contano come il cavo verso la vicina
      if (p.da.chiave === null && !confermato) { stessaRete.push(p); continue; }
      if (p.da.senzaFili === true ? !confermato : !(unico || confermato)) { stessaRete.push(p); continue; }
    } else if (!collegamento || p.tipo === "stessa_rete") {
      stessaRete.push(p);
      continue;
    }
    const salto = p.da.senzaFili === true && vicini.some((q) => q.da.nodo === b.nodo && q.altro?.nodo === p.da.nodo && q.da.fisica === true);
    aggiungi(salto ? "radio" : p.da.senzaFili === true ? "senza_fili" : "cavo", p.da, b, p, p.da.nodo);
  }
  for (const { vicina, lontana } of ponti.values()) {
    if (vicina.altro && lontana.altro) aggiungi("radio", portaVuota(vicina.altro.nodo), portaVuota(lontana.altro.nodo), lontana, null);
  }

  // Passo 4: l'uplink del controller. Velocità diverse ai due capi: solo il verso (I45). Un gateway: la WAN (I68).
  const uplinkSuSegmento = new Map<string, string>();
  for (const p of prove) {
    if (p.classe !== "uplink" || !p.altro) continue;
    const figlio = p.da.nodo, padre = p.altro.nodo;
    if (diSegmento.has(chiaveDi(p.da))) { uplinkSuSegmento.set(chiaveDi(p.da), figlio); continue; }
    if (p.gateway) {
      // L'uplink di un gateway è la sua WAN (§13.8.3 punto 1): la porta locale dell'uplink è la WAN, quella remota è la porta del
      // cavo della LAN, e le due non sono i due capi di un cavo (§13.5.3, misurato sul controller dell'hub). La WAN è un
      // collegamento a parte, dalla porta dell'uplink all'apparato dell'uplink, instradato e senza verso; il cavo della LAN resta
      // quello dell'LLDP per indice. Si unisce a un cavo già letto solo se quel cavo parte dalla porta della WAN; se la porta
      // non si sa, non si unisce a nessuno (potrebbe essere il cavo della LAN).
      const wan = aggiungi("cavo", p.da, portaVuota(padre), p, figlio, p.da.chiave === null);
      wan.wan = true;
      continue;
    }
    const va = velocitaDi(p.da), vb = velocitaDi(p.altro);
    if (va !== null && vb !== null && va !== vb) {
      const fraLoro = bozze.filter((z) => (z.genere === "cavo" || z.genere === "senza_fili") && ((z.a.nodo === figlio && z.b.nodo === padre) || (z.a.nodo === padre && z.b.nodo === figlio)));
      const z = fraLoro.find((x) => p.altro?.chiave !== null && capo(x, padre).chiave === p.altro?.chiave) ?? fraLoro[0];
      const scelta = z ?? aggiungi("cavo", portaVuota(figlio), portaVuota(padre), p, null);
      if (z) z.prove.push(p);
      scelta.porteDaVerificare = true;
      scelta.verso ??= figlio;
      continue;
    }
    const z = aggiungi(p.tipo === "senza_fili" ? "senza_fili" : "cavo", p.da, p.altro, p, figlio);
    z.verso = figlio;
  }

  // Partner dei fasci, bordo (tabella MAC, VM, ripiego del router: le regole di oggi), correzioni «aggiungi», tunnel.
  for (const p of prove) {
    if (!p.altro) continue;
    if (p.classe === "fascio") aggiungi("cavo", p.da, p.altro, p, p.da.nodo);
    else if (p.tipo === "bordo") aggiungi("cavo", p.da, p.altro, p, null);
    else if (p.tipo === "a_mano") aggiungi(p.da.senzaFili === true || p.altro.senzaFili === true ? "senza_fili" : "cavo", p.da, p.altro, p, null);
    else if (p.tipo === "tunnel") aggiungi("tunnel", p.da, p.altro, p, p.da.nodo);
  }

  // Lo stato di un capo (passo 8): giù su una porta giù o spenta, qualunque stato dica lo spanning tree (I25, I67);
  // bloccato se discarding, alternate o backup su una porta accesa («disabled» su una porta accesa inoltra); fuori dal
  // bridge = instradato; il membro di riserva di un bond.
  // Il fascio ha un nome solo, comunque lo dica il lettore: «bond1», o «if:<indice>» tradotto col nome di quell'interfaccia.
  const nomeFascio = (nodo: string, gruppo: string | null): string | null => {
    const i = indiceDelFascio(gruppo);
    return i === null ? gruppo : (ctx.porte.get(nodo)?.perIndice.get(i) ?? gruppo);
  };
  const statoCapo = (p: Porta) => {
    const f = p.nodo.startsWith("seg:") ? [] : ctx.fatti.porta(p.nodo, p);
    const sp = p.chiave ? ctx.statoPorte.get(`${p.nodo}|${p.chiave}`) : undefined;
    const giu = sp === "giu" || sp === "spenta" || f.some((x) => x.running === 0);
    return {
      giu,
      bloccato: !giu && f.some((x) => x.stp_state === "discarding" || x.stp_role === "alternate" || x.stp_role === "backup"),
      instradato: f.some((x) => x.in_bridge === 0) || p.nelBridge === false,
      riserva: f.some((x) => x.lag_state === "riserva"),
      lag: nomeFascio(p.nodo, f.find((x) => x.lag_group !== null)?.lag_group ?? null),
      stpAttivo: f.some((x) => (x.edge === 0 && (x.bpdu_rx ?? 0) > 0) || (x.stp_state !== null && x.stp_state !== "disabled")),
    };
  };
  // Il tunnel si disegna solo se acceso; vale il capo letto più di recente (I48). Spento o non letto: solo nei dettagli.
  const accesoDi = (p: Porta): { acceso: boolean; quando: number } | null => {
    const f = ctx.fatti.porta(p.nodo, p).filter((x) => x.running !== null).sort((x, y) => cmp(y.seen_at, x.seen_at))[0];
    if (f) return { acceso: f.running === 1, quando: tempo(f.seen_at) ?? 0 };
    const sp = p.chiave ? ctx.statoPorte.get(`${p.nodo}|${p.chiave}`) : undefined;
    return sp ? { acceso: sp === "su", quando: 0 } : null;
  };
  const tenute: Bozza[] = [];
  for (const z of bozze) {
    if (z.genere !== "tunnel") { tenute.push(z); continue; }
    const letti = [accesoDi(z.a), accesoDi(z.b)].filter((x): x is { acceso: boolean; quando: number } => x !== null).sort((x, y) => y.quando - x.quando);
    if (letti[0]?.acceso === true) tenute.push(z);
    else stessaRete.push(...z.prove);
  }

  // I segmenti (§13.7.3): membri = la porta che sente e gli apparati sentiti con una porta nota; due segmenti con un membro in
  // comune sono uno solo. Id: «seg:<id apparato>:<porta>» del membro gestito con la chiave più piccola.
  const gruppi: Array<{ chiavi: Set<string>; membri: Map<string, Porta>; prove: Prova[]; altri: Set<string> }> = [];
  for (const k of [...diSegmento].sort()) {
    const m = sentiti.get(k)!;
    const chiavi = new Set<string>([k]);
    const membri = new Map<string, Porta>([[k, [...m.values()][0].da]]);
    const altri = new Set<string>();
    for (const p of m.values()) {
      if (p.altro && p.altro.chiave !== null) { chiavi.add(chiaveDi(p.altro)); membri.set(chiaveDi(p.altro), p.altro); }
      else altri.add(apparato(p));
    }
    const toccati = gruppi.filter((g) => [...chiavi].some((x) => g.chiavi.has(x)));
    const unito = { chiavi, membri, prove: [...m.values()], altri };
    for (const g of toccati) {
      for (const x of g.chiavi) unito.chiavi.add(x);
      for (const [x, p] of g.membri) unito.membri.set(x, p);
      unito.prove.push(...g.prove);
      for (const x of g.altri) unito.altri.add(x);
      gruppi.splice(gruppi.indexOf(g), 1);
    }
    gruppi.push(unito);
  }
  const idPorta = (p: Porta): string => (p.chiave?.startsWith("i:") ? p.chiave.slice(2) : `n-${encodeURIComponent(p.chiave ? p.chiave.slice(2) : normale(p.nome))}`);
  const segmenti: Segmento[] = [];
  for (const g of gruppi) {
    const gestiti = [...g.membri.values()].filter((p) => p.nodo.startsWith("dev:"))
      .sort((x, y) => Number(x.nodo.slice(4)) - Number(y.nodo.slice(4)) || cmp(idPorta(x), idPorta(y)));
    const primo = gestiti[0];
    if (!primo) continue;
    const id = `seg:${primo.nodo.slice(4)}:${idPorta(primo)}`;
    const nomi = [...g.membri.values()].map((p) => ctx.idx.nodes.get(p.nodo)?.name ?? p.nodo);
    const frase = `Sulla porta ${primo.nome} si sentono ${g.membri.size - 1 + g.altri.size} apparati (${nomi.join(", ")}${g.altri.size > 0 ? ` e altri ${g.altri.size} non gestiti` : ""}): in mezzo c'è un apparato che non si legge (un modem, uno switch non gestito o un ponte radio).`;
    segmenti.push({ id, membri: [...g.membri.values()], altriApparati: g.altri.size, frase });
    for (const [k, p] of g.membri) {
      const prova = g.prove.find((x) => chiaveDi(x.da) === k || (x.altro !== null && chiaveDi(x.altro) === k)) ?? g.prove[0];
      const z = aggiungi("segmento", p, portaVuota(id), prova, null);
      const figlio = uplinkSuSegmento.get(k);
      if (figlio) z.verso = figlio;
      tenute.push(z);
    }
  }

  // «Ignora» per cavo (§13.9): una correzione toglie il collegamento con quelle porte; le altre restano. Le orfane si contano.
  const ig = regoleIgnora(correzioni, ctx.idx, ctx.portaSalvata);
  const rimaste = [...new Set(tenute)].filter((z) => z.genere === "segmento" || !ignorato(ig, z.a.nodo, z.a, z.b.nodo, z.b));

  // I fasci (§13.6.3): provati (stesso fascio letto a un capo) o dedotti (due o più cavi in inoltro fra gli stessi due
  // apparati con lo spanning tree attivo fra loro). Una linea sola, i membri elencati, la velocità somma dei membri accesi.
  const perCoppia = new Map<string, Bozza[]>();
  for (const z of rimaste) {
    if (z.genere !== "cavo" || z.wan) continue;
    const k = [z.a.nodo, z.b.nodo].sort().join("|");
    const v = perCoppia.get(k) ?? [];
    v.push(z);
    perCoppia.set(k, v);
  }
  const fasci = new Map<Bozza, { membri: Bozza[]; dedotto: boolean; lagA: string | null; lagB: string | null }>();
  const neiFasci = new Set<Bozza>();
  for (const cavi of perCoppia.values()) {
    if (cavi.length < 2) continue;
    const perLag = new Map<string, Bozza[]>();
    for (const z of cavi) {
      const la = statoCapo(z.a).lag, lb = statoCapo(z.b).lag;
      const k = la !== null ? `a:${z.a.nodo}:${la}` : lb !== null ? `b:${z.b.nodo}:${lb}` : null;
      if (k === null) continue;
      const v = perLag.get(k) ?? [];
      v.push(z);
      perLag.set(k, v);
    }
    for (const membri of perLag.values()) {
      if (membri.length < 2) continue;
      fasci.set(membri[0], { membri, dedotto: false, lagA: statoCapo(membri[0].a).lag, lagB: statoCapo(membri[0].b).lag });
      for (const z of membri) neiFasci.add(z);
    }
    const liberi = cavi.filter((z) => !neiFasci.has(z));
    const attivi = liberi.filter((z) => {
      const sa = statoCapo(z.a), sb = statoCapo(z.b);
      return !sa.giu && !sb.giu && !sa.bloccato && !sb.bloccato && !sa.instradato && !sb.instradato && sa.stpAttivo && sb.stpAttivo;
    });
    if (attivi.length >= 2) {
      fasci.set(attivi[0], { membri: attivi, dedotto: true, lagA: null, lagB: null });
      for (const z of attivi) neiFasci.add(z);
    }
  }

  const FIDUCIA_ORDINE: Readonly<Record<Fiducia, number>> = { certo: 0, probabile: 1, dedotto: 2, a_mano_confermato: 3, a_mano: 4 };
  const fiduciaDi = (z: Bozza): Fiducia => {
    const dati = z.prove.filter((p) => p.tipo !== "a_mano" && p.tipo !== "bordo");
    if (dati.length > 0) {
      if (z.osservatori.has(z.a.nodo) && z.osservatori.has(z.b.nodo)) return "certo";
      // LLDP da un capo, e il bridge designato della porta radice dell'altro capo che indica lo stesso apparato, letto da chi
      // riceve RSTP dall'altro capo (la trappola della radice regionale, §13.8.3 punto 2).
      for (const [oss, altro] of [[z.a.nodo, z.b], [z.b.nodo, z.a]] as const) {
        if (!z.osservatori.has(oss) || altro.nodo.startsWith("seg:")) continue;
        const macOss = new Set([...(ctx.macApparati.get(oss) ?? []), ...ctx.fatti.bridge(oss).map((b) => macDelBridge(b.bridge_id)).filter((m): m is string => !!m)]);
        if (ctx.fatti.porta(altro.nodo, altro).some((f) => f.stp_role === "root" && f.sending_rstp !== 0 && macOss.has(macDelBridge(f.designated_bridge) ?? ""))) return "certo";
      }
      return "probabile";
    }
    if (z.prove.some((p) => p.tipo === "bordo")) return "dedotto";
    return z.prove.some((p) => p.tipo === "a_mano" && p.confermato) ? "a_mano_confermato" : "a_mano";
  };
  const statoDi = (z: Bozza, capi: Array<{ a: Porta; b: Porta }>): { stato: StatoCollegamento; vlan?: number[] } => {
    // Giù se è giù un capo di ogni cavo: per un cavo solo, un capo; per un fascio, tutti i membri.
    if (capi.length > 0 && capi.every((x) => statoCapo(x.a).giu || statoCapo(x.b).giu)) return { stato: "giu" };
    const s = capi.flatMap((x) => [statoCapo(x.a), statoCapo(x.b)]);
    if (s.some((x) => x.bloccato)) {
      // Bloccato nell'albero comune, attivo per le VLAN di un'istanza se i due capi sono della stessa regione MSTP e il
      // collegamento è la porta radice di un'istanza su uno dei due capi.
      const reg = (n: string) => ctx.fatti.bridge(n).find((b) => b.instance === 0 && b.region_name !== null);
      const ra = reg(z.a.nodo), rb = reg(z.b.nodo);
      if (ra && rb && ra.region_name === rb.region_name && ra.region_revision === rb.region_revision && ra.config_digest !== null && ra.config_digest === rb.config_digest) {
        for (const p of [z.a, z.b]) {
          const ist = ctx.fatti.bridge(p.nodo).find((b) => b.instance > 0 && b.root_port !== null && normale(b.root_port) === normale(p.nome));
          if (ist) return { stato: "bloccato_comune", vlan: vlanDa(ist.vlans) };
        }
      }
      return { stato: "bloccato" };
    }
    if (z.wan || s.some((x) => x.instradato)) return { stato: "instradato" };
    if (s.some((x) => x.riserva)) return { stato: "riserva_bond" };
    return { stato: "inoltra" };
  };
  const nonVistoDi = (z: Bozza): boolean => {
    if (z.prove.some((p) => p.tipo === "a_mano")) return false;
    const t = z.prove.map((p) => tempo(p.visto)).filter((x): x is number => x !== null);
    return t.length > 0 && ctx.nowMs - Math.max(...t) > finestra;
  };
  const velocitaCavo = (z: Bozza): number | null => {
    const v = [velocitaDi(z.a), velocitaDi(z.b)].filter((x): x is number => x !== null);
    return v.length > 0 ? Math.min(...v) : null;
  };

  const collegamenti: Collegamento[] = [];
  for (const z of rimaste) {
    if (neiFasci.has(z) && !fasci.has(z)) continue;
    const f = fasci.get(z);
    const membri = f?.membri ?? [z];
    const tutte = membri.flatMap((m) => m.prove);
    const sintesi: Bozza = { ...z, prove: tutte, osservatori: new Set(membri.flatMap((m) => [...m.osservatori])) };
    // Lo stato di un fascio è quello del fascio (lo spanning tree lo vede come una porta sola), letto sull'interfaccia del fascio.
    const capi = f && f.lagA ? [{ a: { ...z.a, chiave: `n:${normale(f.lagA)}`, nome: f.lagA }, b: f.lagB ? { ...z.b, chiave: `n:${normale(f.lagB)}`, nome: f.lagB } : z.b }] : membri.map((m) => ({ a: m.a, b: m.b }));
    const st = statoDi(sintesi, capi);
    const fiducia = fiduciaDi(sintesi);
    const membriStato = f ? membri.map((m) => ({ a: m.a, b: m.b, stato: statoDi(m, [{ a: m.a, b: m.b }]).stato })) : undefined;
    const velocita = f ? membri.filter((m, i) => membriStato?.[i].stato !== "giu").map(velocitaCavo).reduce<number | null>((s, v) => (v === null ? s : (s ?? 0) + v), null) : velocitaCavo(z);
    collegamenti.push({
      id: "", a: z.a, b: z.b, genere: f ? "fascio" : z.genere, ...(membriStato ? { membri: membriStato } : {}),
      ...(f ? { fascio: { a: f.lagA, b: f.lagB }, fascioDedotto: f.dedotto } : {}),
      stato: z.genere === "segmento" ? (statoCapo(z.a).giu ? "giu" : "inoltra") : st.stato, ...(st.vlan ? { attivoPerVlan: st.vlan } : {}),
      fiducia: z.genere === "segmento" || z.genere === "tunnel" ? (fiducia === "certo" ? "probabile" : fiducia) : z.attraverso && fiducia === "certo" ? "probabile" : fiducia,
      verso: sintesi.wan ? null : z.verso, velocitaMbps: velocita, porteDaVerificare: membri.some((m) => m.porteDaVerificare),
      prove: tutte, frasi: [...new Set(tutte.map((p) => p.frase))], nonVisto: nonVistoDi(sintesi),
      ...(z.wan ? { wan: true } : {}), ...(z.attraverso ? { attraverso: true } : {}), ...(z.vm > 0 ? { vm: z.vm } : {}),
    });
  }
  // L'id: il genere e i due capi ordinati con la chiave della porta; un doppio (due cavi con le porte non note) prende «#n».
  const visti = new Map<string, number>();
  for (const c of collegamenti.sort((x, y) => cmp([chiaveDi(x.a), chiaveDi(x.b)].sort().join("~"), [chiaveDi(y.a), chiaveDi(y.b)].sort().join("~")) || cmp(x.genere, y.genere))) {
    const base = `${c.genere}:${[chiaveDi(c.a), chiaveDi(c.b)].sort().join("~")}`;
    const n = visti.get(base) ?? 0;
    visti.set(base, n + 1);
    c.id = n === 0 ? base : `${base}#${n + 1}`;
    c.frasi.push(`→ ${PAROLE_FIDUCIA[c.fiducia]}${c.stato && c.stato !== "inoltra" ? `, ${c.stato.replace("_", " ")}` : ""}`);
  }
  collegamenti.sort((x, y) => cmp(x.id, y.id) || FIDUCIA_ORDINE[x.fiducia] - FIDUCIA_ORDINE[y.fiducia]);
  return { collegamenti, segmenti: segmenti.sort((x, y) => cmp(x.id, y.id)), stessaRete, correzioniOrfane: correzioniOrfane(ig, correzioni) };
}
