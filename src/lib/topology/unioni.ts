/**
 * Unioni e separazioni a mano (piano 2026-10-16, Task 3; ADR 0021): le decisioni delle rotte, pure. Che cosa si scrive (un
 * `PianoUnioni` per `scriviPianoUnioni`), che cosa si vedrà (l'anteprima, calcolata con lo stesso indice dei nodi della mappa,
 * `indiceDeiNodi`) e quando no (404/409 coi testi di `TESTI_UNIONI`). Nessun import del DB: lo legge `unioni-server.ts`.
 *
 * Le parole: un «oggetto» è un apparato o un host della mappa («dev:N», «host:N»); un «nodo» è l'oggetto che la mappa disegna
 * (un apparato coi suoi indirizzi, o un gruppo di host col rappresentante); un'«ancora» è ciò che si scrive per un oggetto
 * scelto: l'host (per un apparato il suo host), così l'unione regge alla promozione e alla rimozione dell'apparato (Scelte 3).
 */
import type { ModelHostRow, TopologyModelInput } from "@/lib/topology/model-types";
import { canonical, indiceDeiNodi, type NodeIndex, type SceltePerNodi } from "@/lib/topology/node-index";
import {
  LIMITE_CANDIDATI, MIN_CARATTERI_RICERCA, NON_SEPARABILI, PAROLA_COME, TESTI_UNIONI,
  type AnteprimaSeparazione, type AnteprimaUnione, type CandidatiUnione, type ComeFuso, type MembroDelNodo, type ModelSeparazioneRow,
  type ModelUnioneRow, type OggettoDaUnire, type PianoUnioni, type RigaSeparazione, type RigaUnione, type StatoDelNodo,
} from "@/lib/topology/unioni-tipi";
import { normalizeMacForStorage } from "@/lib/utils";

/** L'ingresso leggero dell'indice dei nodi (`getIngressoNodi`): basta per decidere, cercare e mostrare lo stato. */
export type IngressoNodi = Pick<TopologyModelInput, "devices" | "hosts" | "knownMacs" | "neighbors">;
/** Le righe attive delle due tabelle, con id, chi e quando (`getRigheScelte`). */
export interface RigheScelte { unioni: RigaUnione[]; separazioni: RigaSeparazione[] }
export type Esito<T> = { ok: true; dati: T } | { ok: false; status: 404 | 409; error: string };
/** Le righe come le legge l'indice dei nodi (solo gruppo e membro; membro e altro). */
export interface RigheDelModello { unioni: ModelUnioneRow[]; separazioni: ModelSeparazioneRow[] }

/** «Separa…» su un indirizzo che sulla mappa è già un oggetto da solo: niente da separare. */
export const TESTO_OGGETTO_SOLO = "Questo indirizzo sulla mappa è un oggetto solo: non c'è niente da separare.";

const ok = <T>(dati: T): Esito<T> => ({ ok: true, dati });
const no = (status: 404 | 409, error: string): { ok: false; status: 404 | 409; error: string } => ({ ok: false, status, error });
const OGGETTO = /^(host|dev):([1-9]\d{0,9})$/;
const HOST = /^host:(\d+)$/;
/** Ordine degli id della mappa: per tipo, poi per numero («host:9» prima di «host:10»). */
const perId = (a: string, b: string): number => a.localeCompare(b, "it", { numeric: true });

/**
 * L'ingresso con le righe date al posto di quelle che aveva (le rotte decidono sulle righe lette con `getRigheScelte`, la misura
 * su quelle in memoria). Gli elenchi sono copie nella forma del modello: l'indice ordina per conto suo. Il tipo è quello di
 * `SceltePerNodi` con elenchi modificabili, come li vuole `indiceDeiNodi`.
 */
export function conRighe(ing: IngressoNodi, r: Readonly<SceltePerNodi>): IngressoNodi & SceltePerNodi & RigheDelModello {
  return {
    devices: ing.devices, hosts: ing.hosts, knownMacs: ing.knownMacs, neighbors: ing.neighbors,
    unioni: r.unioni.map(({ gruppo, membro }) => ({ gruppo, membro })),
    separazioni: r.separazioni.map(({ membro, altro }) => ({ membro, altro })),
  };
}

/**
 * Le righe attive dopo il piano, in memoria (per l'anteprima): tolte quelle del piano, aggiunte le nuove. Un gruppo «nuovo» viene
 * dopo tutti quelli attivi, come nel DB (`MAX(gruppo) + 1`): l'indice applica i gruppi in ordine, l'anteprima e la mappa coincidono.
 */
export function righeDopo(righe: RigheScelte, piano: PianoUnioni): RigheDelModello {
  const viaU = new Set(piano.togliUnioni), viaS = new Set(piano.togliSeparazioni);
  const restano = righe.unioni.filter((u) => !viaU.has(u.id));
  const nuovo = righe.unioni.reduce((m, u) => Math.max(m, u.gruppo), 0) + 1;
  return {
    unioni: [
      ...restano.map(({ gruppo, membro }) => ({ gruppo, membro })),
      ...piano.aggiungiUnioni.map((u) => ({ gruppo: u.gruppo === "nuovo" ? nuovo : u.gruppo, membro: u.membro })),
    ],
    separazioni: [
      ...righe.separazioni.filter((s) => !viaS.has(s.id)).map(({ membro, altro }) => ({ membro, altro })),
      ...piano.aggiungiSeparazioni.map(({ membro, altro }) => ({ membro, altro })),
    ],
  };
}

/**
 * Che cosa si scrive per un oggetto scelto (Scelte 3): un host che c'è è sé stesso; un apparato è il suo host (`host_id`, se
 * c'è ancora, altrimenti l'host di id più basso con l'IP dell'apparato), sé stesso solo se non ne ha; altrimenti null (404).
 */
export function ancoraDi(ing: IngressoNodi, id: string): string | null {
  const m = OGGETTO.exec(id);
  if (!m) return null;
  const n = Number(m[2]);
  if (m[1] === "host") return ing.hosts.some((h) => h.id === n) ? id : null;
  const d = ing.devices.find((x) => x.id === n);
  if (!d) return null;
  if (d.host_id != null && ing.hosts.some((h) => h.id === d.host_id)) return `host:${d.host_id}`;
  const conIp = d.host ? ing.hosts.filter((h) => h.ip === d.host).map((h) => h.id).sort((a, b) => a - b) : [];
  return conIp.length > 0 ? `host:${conIp[0]}` : id;
}

/** Il nodo che contiene l'oggetto: `canonical`; un host in nessun nodo è il nodo di sé stesso; un apparato che non c'è → null. */
export function nodoDi(idx: NodeIndex, id: string): string | null {
  const c = canonical(idx, id);
  if (idx.nodes.has(c)) return c;
  const m = HOST.exec(c);
  return m && idx.hostById.has(Number(m[1])) ? c : null;
}

/** I membri di un nodo: l'oggetto (l'apparato o il rappresentante), poi gli host fusi in ordine di id. Un host solo è sé stesso. */
function membriDi(idx: NodeIndex, nodo: string): string[] {
  const n = idx.nodes.get(nodo);
  return n ? [nodo, ...n.fusedHostIds.map((h) => `host:${h}`)] : [nodo];
}

const nomeHost = (h: ModelHostRow): string => h.custom_name || h.hostname || h.ip || `host:${h.id}`;

/** Il nome di un oggetto (di un host il suo, non quello del nodo che lo contiene). */
function nomeOggetto(idx: NodeIndex, id: string): string {
  const m = HOST.exec(id);
  if (m) {
    const h = idx.hostById.get(Number(m[1]));
    return h ? nomeHost(h) : id;
  }
  return idx.nodes.get(id)?.name ?? id;
}

/** Il nome del nodo, come lo scrive la mappa. */
const nomeNodo = (idx: NodeIndex, nodo: string): string => idx.nodes.get(nodo)?.name ?? nomeOggetto(idx, nodo);

const dueApparati = (idx: NodeIndex, apparati: readonly string[]): string =>
  TESTI_UNIONI.dueApparati(nomeNodo(idx, apparati[0]), nomeNodo(idx, apparati[1]));

/**
 * Il gemello che ha portato `id` in un nodo: fra i `candidati` (membri delle unioni), quello che sta con lui nell'indice delle
 * sole regole automatiche (`auto`, senza unioni: lo stesso MAC, lo stesso nome). Null se non c'è.
 */
function gemelloDi(auto: NodeIndex, id: string, candidati: readonly string[]): string | null {
  const suo = nodoDi(auto, id);
  if (suo === null) return null;
  return candidati.find((g) => g !== id && nodoDi(auto, g) === suo) ?? null;
}

/** L'indice delle sole regole automatiche, con le separazioni date: dice chi è il gemello di chi. */
const indiceAutomatico = (ing: IngressoNodi, separazioni: readonly ModelSeparazioneRow[]): NodeIndex =>
  indiceDeiNodi(conRighe(ing, { unioni: [], separazioni }));

/** Le ancore distinte degli oggetti scelti, in ordine; null alla prima che non c'è (404). */
function ancoreDi(ing: IngressoNodi, idx: NodeIndex, scelti: readonly string[]): { ancore: string[] } | { manca: string } {
  const ancore: string[] = [];
  for (const s of scelti) {
    const a = ancoraDi(ing, s);
    if (a === null || nodoDi(idx, a) === null) return { manca: s };
    if (!ancore.includes(a)) ancore.push(a);
  }
  return { ancore };
}

/**
 * L'anteprima di un'unione: il nodo della prima ancora con le righe `dopo`, chi ora ne fa parte e prima no (col perché: la
 * parola della regola, «insieme a ‹nome›» per chi arriva col gemello), e le separazioni tolte con la loro data. La usa
 * `decidiUnione` sulle righe del piano in memoria e la rotta, scritto il piano, sulle righe rilette dal DB.
 */
export function anteprimaUnione(
  ing: IngressoNodi, righe: RigheScelte, dopo: Readonly<SceltePerNodi>, scelti: readonly string[], tolte: readonly RigaSeparazione[],
): Esito<Omit<AnteprimaUnione, "scritto">> {
  const prima = indiceDeiNodi(conRighe(ing, righe));
  const a = ancoreDi(ing, prima, scelti);
  if ("manca" in a) return no(404, TESTI_UNIONI.nonTrovato(a.manca));
  return anteprimaFra(ing, prima, indiceDeiNodi(conRighe(ing, dopo)), dopo, a.ancore, tolte);
}

/** `anteprimaUnione` dagli indici di prima e di dopo, con le ancore già trovate (`decidiUnione` gli indici li ha già). */
function anteprimaFra(
  ing: IngressoNodi, prima: NodeIndex, idx: NodeIndex, dopo: Readonly<SceltePerNodi>, ancore: readonly string[], tolte: readonly RigaSeparazione[],
): Esito<Omit<AnteprimaUnione, "scritto">> {
  const nodo = nodoDi(idx, ancore[0]);
  const fuori = ancore.find((x) => nodo === null || nodoDi(idx, x) !== nodo);
  if (nodo === null || fuori !== undefined) {
    // Mai un'unione a metà, e mai un'eccezione (sarebbe un 500): le ancore non finiscono insieme perché il gruppo non si applica
    // (due apparati) o perché un'altra unione le tiene divise (righe scritte col gruppo più basso, prima della revisione finale).
    const na = idx.nonApplicate.find((n) => ancore.some((x) => n.membri.includes(x)));
    if (na) return no(409, dueApparati(idx, na.apparati));
    const via = fuori ?? ancore[0];
    return no(409, TESTI_UNIONI.cambiaAltra(nomeNodo(idx, nodoDi(idx, via) ?? via)));
  }
  const giaDentro = new Set(membriDi(prima, nodoDi(prima, nodo) ?? nodo));
  // Scritti da questa unione: le ancore e le righe del loro gruppo. Il membro di un'altra unione che arriva col suo gemello entra
  // «insieme a» lui (revisione finale, 16/10).
  const finali = new Set(dopo.unioni.filter((u) => ancore.includes(u.membro)).map((u) => u.gruppo));
  const espliciti = [...ancore, ...dopo.unioni.filter((u) => finali.has(u.gruppo) && !ancore.includes(u.membro)).map((u) => u.membro).sort(perId)];
  const auto = indiceAutomatico(ing, dopo.separazioni);
  const perche = (id: string): string => {
    const come: ComeFuso = idx.come.get(Number(id.slice(5))) ?? "a_mano";
    if (come !== "a_mano" || espliciti.includes(id)) return PAROLA_COME[come];
    const g = gemelloDi(auto, id, espliciti);
    return g ? `insieme a ${nomeOggetto(idx, g)}` : PAROLA_COME.a_mano;
  };
  return ok({
    nodo, nome: nomeNodo(idx, nodo),
    // Un apparato non entra mai in un altro nodo: chi entra è un host.
    entrano: membriDi(idx, nodo).filter((m) => !giaDentro.has(m)).map((m) => ({ id: m, nome: nomeOggetto(idx, m), perche: perche(m) })),
    separazioniTolte: tolte.map((s) => ({ membro: s.membro, altro: s.altro, il: s.creato_il })),
  });
}

/**
 * Un'unione cambia solo i nodi che si uniscono (`insieme`, con le righe di prima): con le righe di dopo ogni host di quei nodi
 * sta nel nodo finale, ogni altro host nel suo nodo di prima, e ogni altro gruppo attivo (`altriGruppi`) si applica come prima.
 * Il nome, com'è sulla mappa, dell'oggetto che cambierebbe; null se non cambia niente.
 */
function altroCambia(prima: NodeIndex, dopo: NodeIndex, insieme: ReadonlySet<string>, finale: string, altriGruppi: ReadonlySet<number>): string | null {
  for (const id of prima.hostById.keys()) {
    const h = `host:${id}`;
    const p = nodoDi(prima, h) ?? h, d = nodoDi(dopo, h) ?? h;
    if (insieme.has(p) ? d !== finale : d !== p) return insieme.has(p) ? nomeNodo(dopo, d) : nomeNodo(prima, p);
  }
  const giaFuori = new Set(prima.nonApplicate.map((g) => g.gruppo));
  const na = dopo.nonApplicate.find((g) => altriGruppi.has(g.gruppo) && !giaFuori.has(g.gruppo));
  if (!na) return null;
  const dove = na.membri.map((m) => nodoDi(prima, m)).find((x): x is string => x !== null);
  return nomeNodo(prima, dove ?? na.membri[0]);
}

/**
 * «Unisci con…»: gli oggetti scelti diventano uno sulla mappa. Si scrivono le ancore, sempre in un gruppo nuovo, e le righe dei
 * gruppi attivi in cui stanno già si tolgono e si rimettono lì: l'indice applica i gruppi in ordine, e un'unione scritta in un
 * gruppo più vecchio si applicherebbe prima di unioni più recenti, portandone via i membri (revisione finale, 16/10: Casi A e B
 * delle prove). Due apparati fra i nodi che finiscono insieme (contando i gruppi delle ancore) no (Scelte 5). Le separazioni fra
 * due nodi che si uniscono si tolgono (Caso 5): l'unione a mano le contraddirebbe. Se con le righe di dopo cambierebbe un altro
 * nodo o un'altra unione (`altroCambia`), 409 e niente piano.
 */
export function decidiUnione(ing: IngressoNodi, righe: RigheScelte, scelti: string[]): Esito<{ piano: PianoUnioni; anteprima: Omit<AnteprimaUnione, "scritto"> }> {
  if (new Set(scelti).size !== scelti.length) return no(409, TESTI_UNIONI.doppio);
  const idx = indiceDeiNodi(conRighe(ing, righe));
  const a = ancoreDi(ing, idx, scelti);
  if ("manca" in a) return no(404, TESTI_UNIONI.nonTrovato(a.manca));
  const { ancore } = a;
  const nodiAncore = new Set(ancore.map((x) => nodoDi(idx, x)!));
  if (nodiAncore.size < 2) return no(409, TESTI_UNIONI.giaStesso);

  const gruppoDi = new Map(righe.unioni.map((u) => [u.membro, u.gruppo]));
  const gruppi = new Set(ancore.flatMap((x) => (gruppoDi.has(x) ? [gruppoDi.get(x)!] : [])));
  const righeGruppi = righe.unioni.filter((u) => gruppi.has(u.gruppo));
  const insieme = new Set(nodiAncore);
  for (const u of righeGruppi) {
    const n = nodoDi(idx, u.membro);
    if (n !== null) insieme.add(n);
  }
  const apparati = [...insieme].filter((n) => n.startsWith("dev:")).sort();
  if (apparati.length >= 2) return no(409, dueApparati(idx, apparati));

  const giaScritti = [...new Set(righeGruppi.map((u) => u.membro))];
  const tolte = righe.separazioni.filter((s) => {
    const x = nodoDi(idx, s.membro), y = nodoDi(idx, s.altro);
    return x !== null && y !== null && insieme.has(x) && insieme.has(y);
  });
  const piano: PianoUnioni = {
    togliUnioni: righeGruppi.map((u) => u.id),
    togliSeparazioni: tolte.map((s) => s.id),
    aggiungiUnioni: [...giaScritti, ...ancore.filter((x) => !giaScritti.includes(x))].map((membro) => ({ gruppo: "nuovo" as const, membro })),
    aggiungiSeparazioni: [],
  };
  const dopo = righeDopo(righe, piano);
  const idxDopo = indiceDeiNodi(conRighe(ing, dopo));
  const anteprima = anteprimaFra(ing, idx, idxDopo, dopo, ancore, tolte);
  if (!anteprima.ok) return anteprima;
  const altri = new Set(righe.unioni.map((u) => u.gruppo).filter((g) => !gruppi.has(g)));
  const cambia = altroCambia(idx, idxDopo, insieme, anteprima.dati.nodo, altri);
  return cambia === null ? ok({ piano, anteprima: anteprima.dati }) : no(409, TESTI_UNIONI.cambiaAltra(cambia));
}

/**
 * L'anteprima di una separazione: dove finiscono, con le righe `dopo`, i membri che il nodo aveva con le righe di prima. `resta`
 * è il nodo dell'oggetto (o, se si separa il rappresentante di un gruppo di host, quello degli altri); `escono` ogni altro nodo,
 * per primo quello del membro (con chi c'era per lui: il gemello, il resto di una catena, Caso 4).
 */
export function anteprimaSeparazione(
  ing: IngressoNodi, righe: RigheScelte, dopo: Readonly<SceltePerNodi>, nodo: string, membro: string,
): Omit<AnteprimaSeparazione, "scritto"> {
  const prima = indiceDeiNodi(conRighe(ing, righe));
  const idx = indiceDeiNodi(conRighe(ing, dopo));
  const membri = membriDi(prima, nodoDi(prima, nodo) ?? nodo);
  const delMembro = nodoDi(idx, membro);
  const resta = nodo !== membro ? nodoDi(idx, nodo) : (membri.filter((m) => m !== membro).map((m) => nodoDi(idx, m)).find((x) => x !== delMembro) ?? null);
  if (resta === null || delMembro === null || resta === delMembro) {
    throw new Error(`separazione incoerente: ${membro} da ${nodo}`);
  }
  const altri = [...new Set(membri.map((m) => nodoDi(idx, m)).filter((x): x is string => x !== null && x !== resta && x !== delMembro))].sort(perId);
  const vista = (n: string) => ({ nodo: n, nome: nomeNodo(idx, n), membri: membriDi(idx, n) });
  return { resta: vista(resta), escono: [delMembro, ...altri].map(vista) };
}

/**
 * «Separa…»: l'indirizzo `membro` esce dall'oggetto `nodo` della mappa. Non l'apparato e non i suoi indirizzi (il suo host, quello
 * con l'IP di gestione: NON_SEPARABILI). Si toglie la riga del membro, e l'ultima del gruppo se ne resta una; le coppie (Scelte
 * 2): in un apparato con l'apparato (il gemello esce col membro), fra soli host con ogni altro membro, senza ripetere le attive.
 */
export function decidiSeparazione(ing: IngressoNodi, righe: RigheScelte, nodo: string, membro: string): Esito<{ piano: PianoUnioni; anteprima: Omit<AnteprimaSeparazione, "scritto"> }> {
  const idx = indiceDeiNodi(conRighe(ing, righe));
  const n = nodoDi(idx, nodo);
  if (n === null) return no(404, TESTI_UNIONI.nonTrovato(nodo));
  const delMembro = nodoDi(idx, membro);
  if (delMembro === null) return no(404, TESTI_UNIONI.nonTrovato(membro));
  if (delMembro !== n) return no(409, TESTI_UNIONI.nonNelNodo);
  const mh = HOST.exec(membro);
  if (!mh) return no(409, TESTI_UNIONI.eLApparato);
  const come = idx.come.get(Number(mh[1]));
  if (come !== undefined && NON_SEPARABILI.has(come)) return no(409, TESTI_UNIONI.nonSeparabile(come as "host_dell_apparato" | "stesso_ip"));
  const membri = membriDi(idx, n);
  if (membri.length < 2) return no(409, TESTO_OGGETTO_SOLO);

  const togliUnioni: number[] = [];
  const riga = righe.unioni.find((u) => u.membro === membro);
  if (riga) {
    togliUnioni.push(riga.id);
    const resto = righe.unioni.filter((u) => u.gruppo === riga.gruppo && u.id !== riga.id);
    if (resto.length === 1) togliUnioni.push(resto[0].id); // un gruppo di una riga sola non è un'unione
  }
  // Fra due host la coppia vale nei due versi (node-index.ts): una scritta dall'altro verso c'è già.
  const attiva = (a: string, b: string): boolean =>
    righe.separazioni.some((s) => (s.membro === a && s.altro === b) || (s.membro === b && s.altro === a));
  const altri = n.startsWith("dev:") ? [n] : membri.filter((m) => m !== membro);
  const piano: PianoUnioni = {
    togliUnioni, togliSeparazioni: [], aggiungiUnioni: [],
    aggiungiSeparazioni: altri.filter((x) => !attiva(membro, x)).map((x) => ({ membro, altro: x })),
  };
  return ok({ piano, anteprima: anteprimaSeparazione(ing, righe, righeDopo(righe, piano), n, membro) });
}

/** Ordine degli IPv4 per numero («10.71.2.20» prima di «10.71.10.20»); senza IP in fondo. */
function perIp(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return (pa[i] || 0) - (pb[i] || 0);
  return a.localeCompare(b);
}

/**
 * Lo stato sulla mappa di un oggetto (la scheda e il dialogo di «Separa…»): il nodo che lo contiene e i suoi membri, prima
 * l'oggetto del nodo e poi per IP, ognuno col perché sta lì, se si separa (e se no perché), chi e quando l'ha unito a mano (la
 * riga del membro, o quella del gemello che l'ha portato); un'unione del nodo che non si applica, e i membri spariti dei suoi gruppi.
 */
export function statoDelNodo(ing: IngressoNodi, righe: RigheScelte, oggetto: string): Esito<Omit<StatoDelNodo, "disponibile">> {
  const idx = indiceDeiNodi(conRighe(ing, righe));
  const nodo = nodoDi(idx, oggetto);
  if (nodo === null) return no(404, TESTI_UNIONI.nonTrovato(oggetto));
  const ids = membriDi(idx, nodo);
  const rigaDi = new Map(righe.unioni.map((u) => [u.membro, u]));
  const conRiga = [...rigaDi.keys()].sort(perId);
  const auto = indiceAutomatico(ing, righe.separazioni);
  const membro = (id: string): MembroDelNodo => {
    const m = HOST.exec(id);
    const h = m ? idx.hostById.get(Number(m[1])) : undefined;
    const ip = h ? h.ip || null : (idx.nodes.get(id)?.mgmtIp ?? null);
    const come: ComeFuso | "oggetto" = id === nodo || !m ? "oggetto" : (idx.come.get(Number(m[1])) ?? "a_mano");
    const propria = rigaDi.get(id);
    const gemello = !propria && come === "a_mano" ? gemelloDi(auto, id, conRiga) : null;
    const r = propria ?? (gemello ? rigaDi.get(gemello) : undefined);
    const [separabile, perche]: [boolean, string | null] = come === "oggetto"
      ? (id.startsWith("dev:") ? [false, TESTI_UNIONI.eLApparato] : [ids.length > 1, null])
      : NON_SEPARABILI.has(come) ? [false, TESTI_UNIONI.nonSeparabile(come as "host_dell_apparato" | "stesso_ip")] : [true, null];
    return { id, nome: nomeOggetto(idx, id), ip, come, separabile, perche, aMano: r ? { da: r.creato_da, il: r.creato_il } : null };
  };
  const [primo, ...resto] = ids.map(membro);
  const membri = [primo, ...resto.sort((x, y) => perIp(x.ip, y.ip) || perId(x.id, y.id))];
  const dentro = (m: string): boolean => nodoDi(idx, m) === nodo;
  const na = idx.nonApplicate.find((g) => g.membri.some(dentro));
  const gruppi = new Set(righe.unioni.filter((u) => dentro(u.membro)).map((u) => u.gruppo));
  if (na) gruppi.add(na.gruppo);
  const mancanti = [...new Set(righe.unioni.filter((u) => gruppi.has(u.gruppo) && nodoDi(idx, u.membro) === null).map((u) => u.membro))].sort(perId);
  return ok({
    oggetto, nodo, nome: nomeNodo(idx, nodo), membri,
    nonApplicata: na ? { membri: na.membri, motivo: dueApparati(idx, na.apparati) } : null, mancanti,
  });
}

/** Una voce dell'elenco in cui si cerca: un nodo della mappa o un host solo, coi testi in cui cercare. */
interface Voce { id: string; nome: string; tipo: "apparato" | "host"; indirizzi: string[]; nomi: string[]; macs: string[] }

/**
 * «Unisci con…», la ricerca (Scelte 12): da 2 caratteri, fra i nodi della mappa e gli host soli (VM e segmenti non ci sono),
 * escluso il nodo di partenza; il testo (minuscolo) nel nome, negli alias, negli IP o nei MAC (anche senza separatori). Prima
 * l'IP uguale, poi il nome che comincia così, poi il resto, a pari per nome e id. Due apparati sono bloccati col motivo (Scelte 5).
 */
export function cercaCandidati(ing: IngressoNodi, righe: RigheScelte, da: string, testo: string, limite: number = LIMITE_CANDIDATI): Esito<CandidatiUnione> {
  const q = testo.trim().toLowerCase();
  if (q.length < MIN_CARATTERI_RICERCA) return ok({ candidati: [], altri: 0 });
  const idx = indiceDeiNodi(conRighe(ing, righe));
  const partenza = nodoDi(idx, da);
  if (partenza === null) return no(404, TESTI_UNIONI.nonTrovato(da));

  const macDiApparato = new Map<number, string[]>();
  for (const d of ing.devices) if (d.controller_mac) macDiApparato.set(d.id, [d.controller_mac]);
  for (const k of ing.knownMacs) macDiApparato.set(k.device_id, [...(macDiApparato.get(k.device_id) ?? []), k.mac]);
  const macDiHost = (hs: readonly number[]): string[] => hs.flatMap((h) => idx.hostById.get(h)?.mac ?? []);
  const voci: Voce[] = [];
  for (const n of idx.nodes.values()) {
    if (n.kind !== "device" && n.kind !== "host") continue;
    const indirizzi = n.addresses.length > 0 ? n.addresses.map((x) => x.ip) : n.mgmtIp ? [n.mgmtIp] : [];
    const macs = n.kind === "device" ? [...(macDiApparato.get(n.refId) ?? []), ...macDiHost(n.fusedHostIds)] : macDiHost([n.refId, ...n.fusedHostIds]);
    voci.push({ id: n.id, nome: n.name, tipo: n.kind === "device" ? "apparato" : "host", indirizzi, nomi: [n.name, ...n.aliases], macs });
  }
  for (const h of idx.hostById.values()) {
    const id = `host:${h.id}`;
    if (canonical(idx, id) !== id || idx.nodes.has(id)) continue;
    voci.push({
      id, nome: nomeHost(h), tipo: "host", indirizzi: h.ip ? [h.ip] : [],
      nomi: [nomeHost(h), h.hostname ?? "", h.custom_name ?? ""], macs: h.mac ? [h.mac] : [],
    });
  }
  // Un MAC si trova anche scritto senza separatori o con altri («02007b», «02-00-7b»); un IP parziale non è un pezzo di MAC.
  const qMac = /^[\d.]+$/.test(q) ? "" : q.replace(/[^0-9a-f]/g, "");
  const compatto = (m: string): string => (normalizeMacForStorage(m) ?? m).toLowerCase().replace(/[^0-9a-f]/g, "");
  const trovata = (v: Voce): boolean =>
    v.nomi.some((s) => s.toLowerCase().includes(q)) || v.indirizzi.some((ip) => ip.includes(q))
    || v.macs.some((m) => (normalizeMacForStorage(m) ?? m).toLowerCase().includes(q) || (qMac.length >= 4 && compatto(m).includes(qMac)));
  const rango = (v: Voce): number => (v.indirizzi.includes(q) ? 0 : v.nome.toLowerCase().startsWith(q) ? 1 : 2);
  const trovate = voci.filter((v) => v.id !== partenza && trovata(v))
    .sort((x, y) => rango(x) - rango(y) || x.nome.localeCompare(y.nome, "it") || perId(x.id, y.id));
  const apparatoDa = partenza.startsWith("dev:");
  const candidati: OggettoDaUnire[] = trovate.slice(0, limite).map((v) => ({
    id: v.id, nome: v.nome, tipo: v.tipo, indirizzi: v.indirizzi,
    bloccato: apparatoDa && v.tipo === "apparato" ? TESTI_UNIONI.dueApparati(nomeNodo(idx, partenza), v.nome) : null,
  }));
  return ok({ candidati, altri: Math.max(0, trovate.length - limite) });
}
