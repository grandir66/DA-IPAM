/**
 * Il modello per cavo: una linea per collegamento (spec topologia §13.7.2-13.7.6, §13.6.3; T2 in ombra, T3 a schermo). Le
 * prove per porta (prove.ts) diventano collegamenti — cavi, fasci, tunnel, ponti radio, collegamenti senza fili,
 * appartenenze a un segmento — con lo stato dai due capi (inoltra, bloccato, instradato, riserva del bond, giù), la fiducia e
 * il verso quando una prova lo dice. Le correzioni «ignora» valgono per cavo. Da T3: una VM sta dentro il suo hypervisor
 * (§13.7.8), il router oltre un ponte radio non letto (§13.7.6 punto 5), il bordo per porta e i collegamenti «dalle VM» che
 * l'host non conferma (§13.7.2 passo 10), la verifica a mano per cavo e «Togli dal segmento» (§13.9). Nessun prodotto: solo
 * fatti neutri (I37). Logica pura e deterministica (stessi dati, stessi collegamenti: I39).
 */
import { parseDbDate } from "@/lib/db-date";
import { correzioniOrfane, ignorato, portaOccupata, regoleIgnora, type Ignorati } from "@/lib/topology/ignorati";
import { eRadioDalleCapacita, indiceDelFascio } from "@/lib/topology/lettori/fonti";
import type { Fiducia, Genere, LinkMedium, LinkOverrideRow, StatoCollegamento } from "@/lib/topology/model-types";
import type { NodeIndex } from "@/lib/topology/node-index";
import { normale, type ElencoPorte, type Porta } from "./porte";
import { portaVuota, type IndiceFatti, type Prova } from "./prove";

// I tipi stanno in model-types.ts (li legge la pagina, che non importa la logica del modello): qui si riesportano.
export type { Genere, StatoCollegamento, Fiducia } from "@/lib/topology/model-types";

export interface Collegamento {
  /** Il genere più i due capi ordinati con la chiave della porta. */
  id: string;
  /** Per il genere «segmento», `b` è il segmento. */
  a: Porta;
  b: Porta;
  genere: Genere;
  /** I membri di un fascio, ognuno col suo stato e la sua velocità (Caso 4: un membro giù resta, e non conta nella somma). */
  membri?: Array<{ a: Porta; b: Porta; stato: StatoCollegamento; velocitaMbps: number | null }>;
  /** Il nome del fascio dai due capi (per la porta radice di un bridge che è un fascio). */
  fascio?: { a: string | null; b: string | null };
  /** Fascio senza la prova del fascio: due cavi in inoltro con lo spanning tree attivo fra loro (§13.6.3). */
  fascioDedotto?: boolean;
  stato: StatoCollegamento;
  /** Bloccato nell'albero comune, attivo in un'istanza: le VLAN di quell'istanza. */
  attivoPerVlan?: number[];
  /** Bloccato fra due bridge della stessa regione di cui nessuna istanza è letta (§13.13.3 punto 8): «può portare altre VLAN». */
  istanzeNonLette?: boolean;
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
  /** «dedotto: oltre ‹radio›, salto non letto» (§13.7.6 punto 5): l'id della radio vicina. */
  oltre?: string;
  /** Una linea a mano su porte diverse da quelle viste fra gli stessi oggetti (§13.9). */
  aManoDiverse?: boolean;
  /** Un tunnel sentito da un capo solo fra due router (§13.7.5, I69). */
  unVerso?: boolean;
  /** Il tipo dichiarato di una correzione a mano. */
  medio?: LinkMedium | null;
  /** Il primo capo giù di un collegamento «giu»: «cavo giù: la porta ‹p› di ‹A›» (§13.10.3). */
  giuSu?: { nodo: string; porta: string };
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
  /** La velocità di una porta senza chiave dal nome: unica fra le porte con quel nome (I70), altrimenti null. */
  velocitaPerNome?: (nodo: string, nome: string) => number | null;
  /** nodo → MAC dell'apparato (MAIUSCOLO), dai lettori e dall'inventario. */
  macApparati: ReadonlyMap<string, ReadonlySet<string>>;
  idx: NodeIndex;
  /** I router e i firewall (le regole dei router, §13.7.2 passo 5). */
  router: ReadonlySet<string>;
  /** VM → il suo hypervisor: un hypervisor e le sue VM sentiti sulla stessa porta sono un apparato solo. */
  vmIpervisore: ReadonlyMap<string, string>;
  /** Le VM che stanno dentro il loro hypervisor (§13.7.8): accese nell'ultima lettura e abbinate al nodo per MAC, tranne la testa
   * confermata (§13.16 punto 3). Un sottoinsieme di `vmIpervisore`. */
  vmDentro: ReadonlyMap<string, string>;
  /** La porta di una correzione salvata (`portaSalvata` di links.ts: anche la forma di prima di T1). */
  portaSalvata: (nodo: string, nome: string) => Porta | null;
  /** Gli apparati che leggono vicini propri, qualunque fonte (§13.7.6 punto 5: la radio «non letta» non c'è). */
  letti: ReadonlySet<string>;
  /** Gli apparati di rete per le prove di ruolo (§13.8.2), senza i ponti radio, che si conoscono dopo. */
  rete: ReadonlySet<string>;
  /** Gli hypervisor: classe «hyper», o hypervisor di una VM. */
  ipervisori: ReadonlySet<string>;
}

export interface RisultatoCavi {
  collegamenti: Collegamento[];
  segmenti: Segmento[];
  /** Le prove che non diventano un collegamento: stessa rete, tunnel spenti o non letti. */
  stessaRete: Prova[];
  correzioniOrfane: number[];
  /** Porte di un router oltre una radio non letta che sentono due o più apparati di rete: nessun collegamento (§13.7.6 punto 5). */
  oltre: Array<{ porta: Porta; radio: string; apparati: string[] }>;
  /** Prove di bordo scartate perché la porta è il capo di un cavo (§13.7.2 passo 10, §13.9). */
  scartateBordo: Array<{ porta: Porta; verso: string; motivo: string }>;
  /** Collegamenti «dalle VM» su una porta che l'host con `lldpd` non conferma (§13.5.5, I56). */
  scartateVm: Array<{ porta: Porta; ipervisore: string }>;
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
/**
 * Il nome nell'id di un segmento resta entro i 90 caratteri che le rotte accettano (`ID_SEGMENTO` di api-input.ts): un nome
 * codificato più lungo (una porta col nome scelto, su un apparato senza elenco delle porte) si accorcia, mai a metà di un «%XX»,
 * e prende in coda «~» e un'impronta del nome intero, così due nomi lunghi con lo stesso inizio restano due segmenti. Senza,
 * l'id c'era nel modello ma ogni scrittura con quell'id (una mappa passo passo, «Togli dal segmento», la ★) era rifiutata
 * (revisione del Task 8 di T3). Un nome entro il limite resta com'è: gli id già salvati non cambiano.
 */
const MAX_NOME_ID = 90;
function impronta(s: string): string {
  let h = 0x811c9dc5;   // FNV-1a a 32 bit: deterministica, senza dipendenze (cavi/ gira anche nella pagina)
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}
function nomeNellId(nome: string): string {
  const intero = encodeURIComponent(nome);
  if (intero.length <= MAX_NOME_ID) return intero;
  let testa = intero.slice(0, MAX_NOME_ID - 9);
  const p = testa.lastIndexOf("%");
  if (p >= 0 && p > testa.length - 3) testa = testa.slice(0, p);
  return `${testa}~${impronta(nome)}`;
}
/** La porta nell'id di un segmento (§13.7.3): l'indice, oppure «n-» più il nome normalizzato codificato; mai «|», un solo «:». */
const idPorta = (p: Porta): string => (p.chiave?.startsWith("i:") ? p.chiave.slice(2) : `n-${nomeNellId(p.chiave ? p.chiave.slice(2) : normale(p.nome))}`);

/**
 * Alias «seg:<apparato>:<porta>» di ogni membro gestito con la chiave → id di oggi del segmento (§13.7.3: un id salvato si
 * risolve nel segmento che contiene ancora quel membro; l'id cambia quando esce il membro con la chiave più piccola). Lo usa
 * anche la mappa per `canonical`. Un id che nessun segmento contiene non ha alias: l'oggetto è perso, e si conta (R2).
 */
export function aliasDeiSegmenti(segmenti: readonly Segmento[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of segmenti) {
    out.set(s.id, s.id);
    for (const m of s.membri) if (m.nodo.startsWith("dev:") && m.chiave !== null) out.set(`seg:${m.nodo.slice(4)}:${idPorta(m)}`, s.id);
  }
  return out;
}

interface Bozza {
  genere: Genere; a: Porta; b: Porta; prove: Prova[]; osservatori: Set<string>;
  verso: string | null; porteDaVerificare: boolean; wan: boolean; attraverso: boolean; vm: number;
  oltre?: string; aManoDiverse?: boolean; medio?: LinkMedium | null;
}

const CAPO_DI_UN_CAVO = "la porta è il capo di un cavo verso un altro oggetto: non è di bordo";
const CAPO_IGNORATO = "la porta è il capo di un cavo ignorato a mano verso questo oggetto";

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
  const velocitaDi = (p: Porta): number | null => (p.chiave ? (ctx.velocita.get(`${p.nodo}|${p.chiave}`) ?? null)
    : p.nome !== "" ? (ctx.velocitaPerNome?.(p.nodo, p.nome) ?? null) : null);
  const contabile = (p: Porta): boolean => p.certa && p.chiave !== null && (p.fisica === true || p.senzaFili === true);
  const nome = (id: string): string => ctx.idx.nodes.get(id)?.name ?? id;
  // §13.9: le correzioni si leggono all'inizio: servono anche al bordo per porta (la porta di un cavo ignorato resta occupata) e
  // a «Togli dal segmento» (un capo «seg:…», risolto più sotto nel segmento di oggi).
  const ig = regoleIgnora(correzioni, ctx.idx, ctx.portaSalvata, { segmenti: true });

  // §13.7.8 (G15, I62): una VM sta dentro il suo hypervisor. I suoi annunci e la sua tabella MAC passano dal bridge
  // dell'hypervisor: stessa rete, mai un cavo; e fra lei e il suo hypervisor nessun collegamento (G9). Chi vede una VM via LLDP
  // vede il cavo dell'hypervisor che la ospita (Scelte del piano, 16). Restano le correzioni a mano e i tunnel: un tunnel di
  // una VM non è un percorso fisico (§13.7.5, il router virtuale dell'hub sul tunnel cifrato).
  const stessaRete: Prova[] = [];
  const normali: Prova[] = [];
  for (const p of prove) {
    if (p.tipo === "a_mano" || p.tipo === "tunnel") { normali.push(p); continue; }
    if (ctx.vmDentro.has(p.da.nodo)) { stessaRete.push(p); continue; }
    const h = p.altro ? (ctx.vmDentro.get(p.altro.nodo) ?? null) : null;
    if (h === null) { normali.push(p); continue; }
    if (p.da.nodo === h) { stessaRete.push(p); continue; }
    if (p.tipo === "bordo") continue;   // la VM vista su una porta: lo dice già la prova «dalle VM» del suo hypervisor
    normali.push({ ...p, altro: portaVuota(h), frase: `${p.frase} È una VM di ${nome(h)}: il cavo è il suo.` });
  }

  // Passo 2: la freschezza di una prova rispetto alla lettura più recente dello stesso apparato e lettore (I43).
  const ultima = new Map<string, number>();
  for (const p of normali) {
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
  const vicini = normali.filter((p) => p.altro !== null && p.altro.nodo !== p.da.nodo && (p.classe === "annuncio_collegamento" || p.classe === "annuncio_segmento")
    && (p.tipo === "cavo" || p.tipo === "senza_fili" || p.tipo === "stessa_rete"));
  const sentiti = new Map<string, Map<string, Prova>>();
  for (const p of normali) {
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
  /** I capi della prova combaciano con la bozza (porte compatibili), nel verso diritto o rovescio. */
  const combacia = (z: Bozza, pa: Porta, pb: Porta): "diritto" | "rovescio" | null =>
    z.a.nodo === pa.nodo && z.b.nodo === pb.nodo && compatibili(z.a, pa) && compatibili(z.b, pb) ? "diritto"
      : z.a.nodo === pb.nodo && z.b.nodo === pa.nodo && compatibili(z.a, pb) && compatibili(z.b, pa) ? "rovescio" : null;
  const unisciIn = (z: Bozza, pa: Porta, pb: Porta, p: Prova, osservatore: string | null): Bozza => {
    const verso = combacia(z, pa, pb);
    if (verso === "diritto") { z.a = unisci(z.a, pa); z.b = unisci(z.b, pb); } else if (verso === "rovescio") { z.a = unisci(z.a, pb); z.b = unisci(z.b, pa); }
    z.prove.push(p);
    if (osservatore) z.osservatori.add(osservatore);
    if (p.vm) z.vm = Math.max(z.vm, p.vm);
    return z;
  };
  const aggiungi = (genere: Genere, pa: Porta, pb: Porta, p: Prova, osservatore: string | null, distinto = false): Bozza => {
    const gia = distinto ? undefined : bozze.find((z) => z.genere === genere && combacia(z, pa, pb) !== null);
    if (gia) return unisciIn(gia, pa, pb, p, osservatore);
    const z: Bozza = { genere, a: pa, b: pb, prove: [p], osservatori: new Set(osservatore ? [osservatore] : []), verso: null, porteDaVerificare: false, wan: false, attraverso: false, vm: p.vm ?? 0 };
    bozze.push(z);
    return z;
  };

  // Passi 1, 3, 5, 6: i vicini. Il ritorno serve alla conferma per porta dei router e al salto radio.
  const vede = (x: string, y: string, porta: Porta): boolean => vicini.some((q) => q.da.nodo === x && q.altro?.nodo === y
    && q.classe === "annuncio_collegamento" && (q.tipo === "cavo" || q.tipo === "senza_fili") && !diSegmento.has(chiaveDi(q.da))
    && porta.chiave !== null && q.altro.chiave === porta.chiave);
  const uplinkVerso = (figlio: string, padre: string, porta: Porta): boolean => normali.some((q) => q.classe === "uplink"
    && q.da.nodo === figlio && q.altro?.nodo === padre && porta.chiave !== null && q.altro.chiave === porta.chiave);
  const tuttiSu = new Map<string, Set<string>>();
  for (const p of vicini) {
    const s = tuttiSu.get(chiaveDi(p.da)) ?? new Set<string>();
    s.add(p.altro!.nodo);
    tuttiSu.set(chiaveDi(p.da), s);
  }
  const portaDelRouter = (p: Prova): boolean => p.da.senzaFili === true || (p.traduttoreLocale ? p.da.fisica === true : p.da.fisica !== false);
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

  // §13.7.6 punto 5 (I18): il router dall'altra parte di un ponte radio non letto. Regola chiusa, eccezione a §11.1 e §11.1 bis
  // solo qui: la porta fisica P di un router ha il suo cavo verso N, che non legge vicini suoi; oltre N, sulla stessa porta, si
  // sente UN solo apparato di rete R (annunci freschi dell'ultimo giro; mai la tabella MAC, che su una porta di passaggio vede un
  // ramo intero). Allora R sta oltre N, dedotto. Con due o più nessun collegamento, e la porta lo dice. Una porta che sente due
  // apparati via LLDP è un segmento (§13.7.3, prima di questa regola): qui arrivano solo porte col loro cavo (Scelte, 15).
  const oltre: RisultatoCavi["oltre"] = [];
  const fraLoro = (z: Bozza, x: string, y: string): boolean => (z.a.nodo === x && z.b.nodo === y) || (z.a.nodo === y && z.b.nodo === x);
  // «Salto non letto né dichiarato» (revisione del Task 4): letto = le due radio sentite sulla porta, o la radio capo di un
  // collegamento «radio»; dichiarato = una correzione a mano senza fili che la tocca (le correzioni diventano bozze più sotto,
  // quindi si guardano le prove). Le radio capo di un salto non sono «apparati di rete oltre»: la radio lontana dava la voce falsa
  // «oltre ‹N› ci sono 2 apparati».
  const capiRadio = new Set(bozze.filter((z) => z.genere === "radio").flatMap((z) => [z.a.nodo, z.b.nodo]));
  const dichiarati = new Set(normali.flatMap((q) => (q.tipo === "a_mano" && q.altro !== null
    && (q.medio === "wireless" || q.da.senzaFili === true || q.altro.senzaFili === true) ? [q.da.nodo, q.altro.nodo] : [])));
  for (const z of [...bozze]) {
    if (z.genere !== "cavo") continue;
    for (const [P, N] of [[z.a, z.b.nodo], [z.b, z.a.nodo]] as const) {
      if (!ctx.router.has(P.nodo) || P.fisica !== true || P.chiave === null || ctx.letti.has(N)) continue;
      const k = chiaveDi(P);
      if (ponti.has(k) || capiRadio.has(N) || dichiarati.has(N)) continue;
      const sentitiOltre = vicini.filter((q) => chiaveDi(q.da) === k && fresca(q) && q.altro !== null && q.altro.nodo !== N && q.altro.nodo !== P.nodo
        && !capiRadio.has(q.altro.nodo) && ctx.rete.has(q.altro.nodo));
      const R = [...new Set(sentitiOltre.map((q) => q.altro!.nodo))].sort();
      if (R.length >= 2) { oltre.push({ porta: P, radio: N, apparati: R }); continue; }
      // Un cavo già visto fra la radio e R (R la sente da sé) non è un buco: la regola non serve.
      if (R.length !== 1 || bozze.some((x) => fraLoro(x, N, R[0]))) continue;
      const q = sentitiOltre[0];
      aggiungi("cavo", portaVuota(N), portaVuota(R[0]), {
        ...q, tipo: "cavo", da: portaVuota(N), altro: portaVuota(R[0]),
        frase: `${nome(R[0])} si sente dalla porta ${P.nome} oltre ${nome(N)}: sta oltre il ponte radio, il salto non è letto.`,
      }, null).oltre = N;
    }
  }

  // Passo 4: l'uplink del controller. Velocità diverse ai due capi: solo il verso (I45). Un gateway: la WAN (I68).
  // L'uplink dà il verso, mai un testimone (§13.7.2 passo 3; revisione del Task 11): il controller lo calcola dall'LLDP
  // dello stesso apparato, quindi il figlio non entra fra gli osservatori e un cavo visto da un capo resta probabile.
  const uplinkSuSegmento = new Map<string, string>();
  for (const p of normali) {
    if (p.classe !== "uplink" || !p.altro) continue;
    const figlio = p.da.nodo, padre = p.altro.nodo;
    if (diSegmento.has(chiaveDi(p.da))) {
      // La WAN di un gateway che dà su un segmento: instradata, senza verso (§13.8.3 punto 1; revisione del Task 11).
      if (!p.gateway) uplinkSuSegmento.set(chiaveDi(p.da), figlio);
      continue;
    }
    if (p.gateway) {
      // L'uplink di un gateway è la sua WAN (§13.8.3 punto 1): la porta locale dell'uplink è la WAN, quella remota è la porta del
      // cavo della LAN, e le due non sono i due capi di un cavo (§13.5.3, misurato sul controller dell'hub). La WAN è un
      // collegamento a parte, dalla porta dell'uplink all'apparato dell'uplink, instradato e senza verso; il cavo della LAN resta
      // quello dell'LLDP per indice. Si unisce a un cavo già letto solo se quel cavo parte dalla porta della WAN; se la porta
      // non si sa, non si unisce a nessuno (potrebbe essere il cavo della LAN).
      const wan = aggiungi("cavo", p.da, portaVuota(padre), p, null, p.da.chiave === null);
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
    const z = aggiungi(p.tipo === "senza_fili" ? "senza_fili" : "cavo", p.da, p.altro, p, null);
    z.verso = figlio;
  }

  // I partner dei fasci: sono cavi, e prima del bordo (le loro porte sono capi).
  for (const p of normali) if (p.altro && p.classe === "fascio") aggiungi("cavo", p.da, p.altro, p, p.da.nodo);

  // §13.7.2 passo 10 (I9): tabella MAC, VM e ripiego del router restano le regole di oggi, ma per porta. Una porta che è il capo
  // di un cavo verso un altro oggetto non è di bordo; la porta di un cavo ignorato resta occupata verso quell'oggetto (§13.9).
  const capiDati = new Map<string, Set<string>>();
  for (const z of bozze) {
    // Un cavo ignorato non è un capo: la sua porta resta occupata solo verso quell'oggetto (`portaOccupata` sotto, §13.9).
    if (!z.prove.some((p) => p.tipo !== "bordo" && p.tipo !== "a_mano") || ignorato(ig, z.a.nodo, z.a, z.b.nodo, z.b)) continue;
    for (const [x, y] of [[z.a, z.b], [z.b, z.a]] as const) {
      if (x.chiave !== null) capiDati.set(chiaveDi(x), (capiDati.get(chiaveDi(x)) ?? new Set<string>()).add(y.nodo));
    }
  }
  const occupata = (x: Porta, verso: string): boolean => x.chiave !== null && [...(capiDati.get(chiaveDi(x)) ?? [])].some((n) => n !== verso);
  // Le righe fresche della lettura dal lato dell'host (`lldpd`, §13.5.5), per hypervisor.
  const dallHost = new Map<string, Prova[]>();
  for (const q of normali) if (q.lettore === "host" && q.altro !== null && fresca(q)) dallHost.set(q.da.nodo, [...(dallHost.get(q.da.nodo) ?? []), q]);
  const scartateBordo: RisultatoCavi["scartateBordo"] = [];
  const scartateVm: RisultatoCavi["scartateVm"] = [];
  for (const p of normali) {
    if (!p.altro || p.classe === "fascio") continue;
    if (p.tipo === "bordo") {
      if (occupata(p.da, p.altro.nodo) || occupata(p.altro, p.da.nodo)) {
        scartateBordo.push({ porta: p.da, verso: p.altro.nodo, motivo: CAPO_DI_UN_CAVO });
        continue;
      }
      // La prova di bordo sa la porta del suo lato (`da`: lo switch, o il router del ripiego); l'altro capo non la dice.
      if (portaOccupata(ig, p.da.nodo, p.da, p.altro.nodo)) {
        scartateBordo.push({ porta: p.da, verso: p.altro.nodo, motivo: CAPO_IGNORATO });
        continue;
      }
      if (p.classe === "vm") {
        // Con `lldpd` sull'host (§13.5.5, §13.15 punto 4): un collegamento «dalle VM» su una porta che l'host non conferma si scarta.
        const [h, sw] = ctx.ipervisori.has(p.da.nodo) ? [p.da, p.altro] : [p.altro, p.da];
        const host = dallHost.get(h.nodo) ?? [];
        if (host.length > 0 && !host.some((q) => q.altro!.nodo === sw.nodo && compatibili(q.altro!, sw))) {
          scartateVm.push({ porta: sw, ipervisore: h.nodo });
          continue;
        }
      }
      aggiungi("cavo", p.da, p.altro, p, null);
    } else if (p.tipo === "a_mano") {
      // §13.9, «Verifica» da T3: la conferma un cavo visto CON LE STESSE PORTE (o il MAC sulla porta dichiarata, in prove.ts); un
      // cavo fra gli stessi oggetti su altre porte non conferma più, e la linea a mano è una linea sua. Due porte vuote: si unisce
      // solo a un cavo solo fra i due.
      // Senza tipo, il collegamento visto fra i due può essere di qualunque genere (un uplink senza fili, un salto radio, un
      // tunnel): come la linea della coppia di T1, una sola. Con le porte vuote si unisce prima a un'altra correzione senza porte
      // fra gli stessi due, poi al cavo solo, poi a un'altra correzione con le porte (revisione del Task 4: T1 ne mostra una).
      const genere: Genere = p.medio === "tunnel" ? "tunnel"
        : p.medio === "wireless" || p.da.senzaFili === true || p.altro.senzaFili === true ? "senza_fili" : "cavo";
      const altro = p.altro;
      const fraI = bozze.filter((z) => z.genere !== "segmento" && (p.medio ? z.genere === genere : true) && fraLoro(z, p.da.nodo, altro.nodo));
      const visti = fraI.filter((z) => z.prove.some((q) => q.tipo !== "a_mano"));
      const soloAMano = fraI.filter((z) => z.prove.every((q) => q.tipo === "a_mano"));
      const vuote = p.da.nome === "" && altro.nome === "";
      const dove = vuote
        ? (soloAMano.find((z) => z.a.nome === "" && z.b.nome === "") ?? (visti.length === 1 ? visti[0] : soloAMano[0]))
        : [...visti, ...soloAMano].find((z) => combacia(z, p.da, altro) !== null);
      const z = dove ? unisciIn(dove, p.da, altro, p, null) : aggiungi(genere, p.da, altro, p, null, true);
      if (p.medio) z.medio = p.medio;
      if (z.prove.every((q) => q.tipo === "a_mano") && visti.length > 0) z.aManoDiverse = true;
    } else if (p.tipo === "tunnel") aggiungi("tunnel", p.da, p.altro, p, p.da.nodo);
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
    if (z.prove.some((p) => p.tipo === "a_mano")) { tenute.push(z); continue; }   // un tunnel dichiarato a mano si disegna sempre
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
  // «Togli ‹A› dal segmento» è una correzione «ignore» con un capo «seg:…»: toglie solo quell'appartenenza. L'id salvato può
  // essere di prima: vale per il segmento che oggi contiene quel membro (come un id salvato in una mappa, §13.7.3).
  const alias = aliasDeiSegmenti(segmenti);
  const igSeg: Ignorati = { regole: ig.regole.map((r) => ({ ...r, a: alias.get(r.a) ?? r.a, b: alias.get(r.b) ?? r.b })), usate: ig.usate };
  const rimaste = [...new Set(tenute)].filter((z) => !ignorato(igSeg, z.a.nodo, z.a, z.b.nodo, z.genere === "segmento" ? null : z.b));

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
    // A mano (§13.9): confermata da un cavo visto con le stesse porte (è nella stessa bozza) o dal MAC sulla porta dichiarata.
    const aMano = z.prove.filter((p) => p.tipo === "a_mano");
    // Anche una prova di bordo della stessa bozza (VM o MAC sulla porta: la verifica di T1, per cavo) conferma.
    if (aMano.length > 0) return z.prove.some((p) => p.tipo !== "a_mano") || aMano.some((p) => p.confermato) ? "a_mano_confermato" : "a_mano";
    if (z.oltre !== undefined && z.osservatori.size === 0) return "dedotto";
    const dati = z.prove.filter((p) => p.tipo !== "bordo");
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
    return "dedotto";
  };
  const statoDi = (z: Bozza, capi: Array<{ a: Porta; b: Porta }>): { stato: StatoCollegamento; vlan?: number[]; istanzeNonLette?: boolean } => {
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
        // §13.13.3 punto 8: la stessa regione e nessuna riga d'istanza su nessuno dei due: le istanze non sono lette (oggi senza
        // T2-a), e il cavo bloccato nell'albero comune può portare altre VLAN.
        if (![z.a.nodo, z.b.nodo].some((n) => ctx.fatti.bridge(n).some((b) => b.instance > 0))) return { stato: "bloccato", istanzeNonLette: true };
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

  // Il primo capo giù (§13.10.3, «cavo giù: la porta ‹p› di ‹A›»).
  const giuDi = (capi: Array<{ a: Porta; b: Porta }>): { nodo: string; porta: string } | undefined => {
    const p = capi.flatMap((x) => [x.a, x.b]).find((x) => !x.nodo.startsWith("seg:") && statoCapo(x).giu);
    return p ? { nodo: p.nodo, porta: p.nome } : undefined;
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
    const membriStato = f ? membri.map((m) => ({ a: m.a, b: m.b, stato: statoDi(m, [{ a: m.a, b: m.b }]).stato, velocitaMbps: velocitaCavo(m) })) : undefined;
    const velocita = f ? (membriStato ?? []).filter((m) => m.stato !== "giu").map((m) => m.velocitaMbps).reduce<number | null>((s, v) => (v === null ? s : (s ?? 0) + v), null) : velocitaCavo(z);
    const stato = z.genere === "segmento" ? (statoCapo(z.a).giu ? "giu" : "inoltra") : st.stato;
    const giuSu = stato === "giu" ? giuDi(z.genere === "segmento" ? [{ a: z.a, b: z.a }] : capi) : undefined;
    // §13.7.5 (I69): un tunnel fra due router sentito da un capo solo: c'è, e gli annunci passano in un verso solo.
    // «Non sente» è un fatto solo se l'altro capo legge i suoi vicini (revisione del Task 4).
    const oss = sintesi.osservatori.size === 1 ? [...sintesi.osservatori][0] : null;
    const unVerso = z.genere === "tunnel" && oss !== null && !tutte.some((p) => p.tipo === "a_mano") && ctx.router.has(z.a.nodo) && ctx.router.has(z.b.nodo)
      && ctx.letti.has(altroCapo(z, oss).nodo);
    const frasi = [...new Set(tutte.map((p) => p.frase))];
    if (unVerso && oss !== null) {
      const altro = altroCapo(z, oss).nodo;
      frasi.push(`${nome(oss)} sente ${nome(altro)} sul tunnel ${capo(z, oss).nome}, ma ${nome(altro)} non sente ${nome(oss)}: il tunnel c'è, e gli annunci passano in un verso solo.`);
    }
    collegamenti.push({
      id: "", a: z.a, b: z.b, genere: f ? "fascio" : z.genere, ...(membriStato ? { membri: membriStato } : {}),
      ...(f ? { fascio: { a: f.lagA, b: f.lagB }, fascioDedotto: f.dedotto } : {}),
      stato, ...(st.vlan ? { attivoPerVlan: st.vlan } : {}), ...(st.istanzeNonLette ? { istanzeNonLette: true } : {}),
      fiducia: z.genere === "segmento" || z.genere === "tunnel" ? (fiducia === "certo" ? "probabile" : fiducia) : z.attraverso && fiducia === "certo" ? "probabile" : fiducia,
      verso: sintesi.wan ? null : z.verso, velocitaMbps: velocita, porteDaVerificare: membri.some((m) => m.porteDaVerificare),
      prove: tutte, frasi, nonVisto: nonVistoDi(sintesi),
      ...(z.wan ? { wan: true } : {}), ...(z.attraverso ? { attraverso: true } : {}), ...(z.vm > 0 ? { vm: z.vm } : {}),
      ...(z.oltre !== undefined ? { oltre: z.oltre } : {}), ...(z.aManoDiverse ? { aManoDiverse: true } : {}), ...(z.medio ? { medio: z.medio } : {}),
      ...(unVerso ? { unVerso: true } : {}), ...(giuSu ? { giuSu } : {}),
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
  return {
    collegamenti, segmenti: segmenti.sort((x, y) => cmp(x.id, y.id)), stessaRete, correzioniOrfane: correzioniOrfane(ig, correzioni),
    oltre, scartateBordo, scartateVm,
  };
}
