/**
 * La «vista» della tabella Apparati di DatIA Mon (Riccardo, 26/11/2026: «non ci sono filtri, colonne modificabili,
 * raggruppamenti gestibili»): quali colonne, in che ordine, come si raggruppa e si ordina, e i filtri. Pura: la
 * pagina la disegna, `/api/user/preferences` (chiave `zabbix-apparati-vista`) la conserva per utente.
 *
 * Una colonna = un fatto: il primo modello e «quanti altri» sono due colonne, non un elenco in una cella.
 */
import type { ApparatoElenco } from "./apparati";

export type IdColonna =
  | "stato" | "nome" | "ip" | "rete" | "marca" | "modello" | "famiglia" | "modelloZabbix" | "altriModelli"
  | "agente" | "credenziale" | "proxy" | "problemi" | "mac" | "nomeZabbix";

export interface Colonna {
  id: IdColonna;
  etichetta: string;
  /** Visibile finché l'utente non sceglie altro. */
  diSerie: boolean;
  /** Non si può nascondere. */
  fissa?: boolean;
  /** Il testo della cella: serve a ordinare e a cercare. */
  testo: (a: ApparatoElenco) => string;
}

export const TESTO_STATO: Record<ApparatoElenco["stato"], string> = {
  funziona: "Funziona", attenzione: "Attenzione", fermo: "Fermo", non_so: "Non so", da_aggiungere: "Da aggiungere",
};
export const TESTO_AGENTE: Record<ApparatoElenco["agente"], string> = {
  si: "attivo", no: "non manda dati", non_so: "non so", non_serve: "non serve", da_installare: "da installare",
};

export const testoRete = (a: ApparatoElenco): string => (a.rete ? (a.vlan != null ? `${a.rete} · VLAN ${a.vlan}` : a.rete) : "");

export const COLONNE: readonly Colonna[] = [
  { id: "stato", etichetta: "Stato", diSerie: true, testo: (a) => TESTO_STATO[a.stato] },
  { id: "nome", etichetta: "Apparato", diSerie: true, fissa: true, testo: (a) => a.nome },
  { id: "ip", etichetta: "IP", diSerie: true, testo: (a) => a.ip ?? "" },
  { id: "rete", etichetta: "Rete · VLAN", diSerie: true, testo: testoRete },
  { id: "marca", etichetta: "Marca", diSerie: true, testo: (a) => a.marca ?? "" },
  { id: "modello", etichetta: "Modello", diSerie: true, testo: (a) => a.modello ?? "" },
  { id: "famiglia", etichetta: "Famiglia", diSerie: true, testo: (a) => a.famiglia },
  { id: "modelloZabbix", etichetta: "Modello Zabbix", diSerie: true, testo: (a) => a.modelli[0] ?? "" },
  { id: "altriModelli", etichetta: "Altri", diSerie: true, testo: (a) => (a.modelli.length > 1 ? `+${a.modelli.length - 1}` : "") },
  { id: "agente", etichetta: "Agente", diSerie: true, testo: (a) => TESTO_AGENTE[a.agente] },
  { id: "credenziale", etichetta: "Credenziale", diSerie: true, testo: (a) => a.credenziali.join(" ") },
  { id: "problemi", etichetta: "Problemi", diSerie: true, testo: (a) => (a.hostid ? String(a.problemi) : "") },
  { id: "proxy", etichetta: "Proxy", diSerie: false, testo: (a) => a.proxy ?? "" },
  { id: "mac", etichetta: "MAC", diSerie: false, testo: (a) => a.mac ?? "" },
  { id: "nomeZabbix", etichetta: "Nome in Zabbix", diSerie: false, testo: (a) => a.hostTecnico ?? "" },
];
const PER_ID = new Map(COLONNE.map((c) => [c.id, c]));
export const colonna = (id: IdColonna): Colonna => PER_ID.get(id)!;

export const GRUPPI = [
  { id: "famiglia", etichetta: "Famiglia" },
  { id: "rete", etichetta: "Rete" },
  { id: "marca", etichetta: "Marca" },
  { id: "stato", etichetta: "Stato" },
  { id: "nessuno", etichetta: "Nessun gruppo" },
] as const;
export type IdGruppo = (typeof GRUPPI)[number]["id"];

export interface Vista {
  colonne: IdColonna[];
  gruppo: IdGruppo;
  ordine: { colonna: IdColonna; verso: "su" | "giu" };
}

export const VISTA_DI_SERIE: Vista = {
  colonne: COLONNE.filter((c) => c.diSerie).map((c) => c.id),
  gruppo: "famiglia",
  ordine: { colonna: "nome", verso: "su" },
};

/** La vista salvata, ripulita: ciò che non si riconosce torna quello di serie, le colonne fisse ci sono sempre. */
export function leggiVista(salvata: string | null | undefined): Vista {
  if (!salvata) return VISTA_DI_SERIE;
  let v: unknown;
  try {
    v = JSON.parse(salvata);
  } catch {
    return VISTA_DI_SERIE;
  }
  if (!v || typeof v !== "object") return VISTA_DI_SERIE;
  const o = v as { colonne?: unknown; gruppo?: unknown; ordine?: { colonna?: unknown; verso?: unknown } };
  const viste = Array.isArray(o.colonne)
    ? o.colonne.filter((x, i, a): x is IdColonna => typeof x === "string" && PER_ID.has(x as IdColonna) && a.indexOf(x) === i)
    : [];
  const colonne = viste.length ? viste : VISTA_DI_SERIE.colonne.slice();
  for (const c of COLONNE) if (c.fissa && !colonne.includes(c.id)) colonne.unshift(c.id);
  const gruppo = GRUPPI.some((g) => g.id === o.gruppo) ? (o.gruppo as IdGruppo) : VISTA_DI_SERIE.gruppo;
  const col = typeof o.ordine?.colonna === "string" && PER_ID.has(o.ordine.colonna as IdColonna) ? (o.ordine.colonna as IdColonna) : "nome";
  return { colonne, gruppo, ordine: { colonna: col, verso: o.ordine?.verso === "giu" ? "giu" : "su" } };
}

/** Accende o spegne una colonna (le fisse restano); una colonna nuova va in fondo. */
export function conColonna(v: Vista, id: IdColonna, visibile: boolean): Vista {
  if (colonna(id).fissa) return v;
  const colonne = visibile ? (v.colonne.includes(id) ? v.colonne : [...v.colonne, id]) : v.colonne.filter((x) => x !== id);
  return { ...v, colonne };
}

/** Sposta una colonna visibile di un posto. */
export function spostaColonna(v: Vista, id: IdColonna, di: -1 | 1): Vista {
  const i = v.colonne.indexOf(id);
  const j = i + di;
  if (i < 0 || j < 0 || j >= v.colonne.length) return v;
  const colonne = v.colonne.slice();
  [colonne[i], colonne[j]] = [colonne[j], colonne[i]];
  return { ...v, colonne };
}

export type FiltroStato = "tutti" | "monitorati" | "da_aggiungere" | "problemi" | "agente";
export const STATI: ReadonlyArray<{ id: FiltroStato; etichetta: string; vale: (a: ApparatoElenco) => boolean }> = [
  { id: "tutti", etichetta: "Tutti", vale: () => true },
  { id: "monitorati", etichetta: "In monitoraggio", vale: (a) => a.hostid !== null },
  { id: "da_aggiungere", etichetta: "Da aggiungere", vale: (a) => a.hostid === null },
  { id: "problemi", etichetta: "Con problemi", vale: (a) => a.stato === "attenzione" || a.stato === "fermo" },
  { id: "agente", etichetta: "Agente da installare", vale: (a) => a.agente === "no" || a.agente === "da_installare" },
];

/** I filtri a scelta: vuoto = tutti. `NESSUNO` sceglie chi quel dato non ce l'ha. */
export const NESSUNO = "__nessuno__";
export const CAMPI_FILTRO = [
  { id: "famiglia", etichetta: "Famiglia", valori: (a: ApparatoElenco) => [a.famiglia] },
  { id: "rete", etichetta: "Rete", valori: (a: ApparatoElenco) => (a.rete ? [testoRete(a)] : []) },
  { id: "marca", etichetta: "Marca", valori: (a: ApparatoElenco) => (a.marca ? [a.marca] : []) },
  { id: "modelloZabbix", etichetta: "Modello Zabbix", valori: (a: ApparatoElenco) => a.modelli },
  { id: "agente", etichetta: "Agente", valori: (a: ApparatoElenco) => [TESTO_AGENTE[a.agente]] },
  { id: "credenziale", etichetta: "Credenziale", valori: (a: ApparatoElenco) => a.credenziali },
] as const;
export type IdFiltro = (typeof CAMPI_FILTRO)[number]["id"];

export interface Filtri {
  testo: string;
  stato: FiltroStato;
  scelte: Partial<Record<IdFiltro, string>>;
}
export const FILTRI_VUOTI: Filtri = { testo: "", stato: "tutti", scelte: {} };

export function passa(a: ApparatoElenco, f: Filtri): boolean {
  if (!STATI.find((s) => s.id === f.stato)!.vale(a)) return false;
  for (const c of CAMPI_FILTRO) {
    const scelto = f.scelte[c.id];
    if (!scelto) continue;
    const v = c.valori(a);
    if (scelto === NESSUNO ? v.length > 0 : !v.includes(scelto)) return false;
  }
  const t = f.testo.trim().toLowerCase();
  if (!t) return true;
  return [a.nome, a.ip, a.mac, a.marca, a.modello, a.hostTecnico, ...a.modelli].some((x) => (x ?? "").toLowerCase().includes(t));
}

/** I valori che un filtro può prendere, con quanti apparati li hanno, in ordine alfabetico. */
export function valoriFiltro(apparati: readonly ApparatoElenco[], id: IdFiltro): Array<{ valore: string; quanti: number }> {
  const campo = CAMPI_FILTRO.find((c) => c.id === id)!;
  const conta = new Map<string, number>();
  let senza = 0;
  for (const a of apparati) {
    const v = campo.valori(a);
    if (v.length === 0) senza++;
    for (const x of v) conta.set(x, (conta.get(x) ?? 0) + 1);
  }
  const voci = [...conta.entries()].map(([valore, quanti]) => ({ valore, quanti })).sort((x, y) => x.valore.localeCompare(y.valore, "it", { numeric: true }));
  return senza > 0 ? [...voci, { valore: NESSUNO, quanti: senza }] : voci;
}

function confronta(x: string, y: string): number {
  // I vuoti in fondo, in tutti e due i versi dell'ordine no: prima i pieni quando si sale.
  if (!x && y) return 1;
  if (x && !y) return -1;
  return x.localeCompare(y, "it", { numeric: true, sensitivity: "base" });
}

export function ordina(apparati: readonly ApparatoElenco[], o: Vista["ordine"]): ApparatoElenco[] {
  const testo = colonna(o.colonna).testo;
  const segno = o.verso === "su" ? 1 : -1;
  return apparati.slice().sort((a, b) => segno * confronta(testo(a), testo(b)) || confronta(a.nome, b.nome));
}

export interface Gruppo {
  chiave: string;
  etichetta: string;
  lista: ApparatoElenco[];
}

/** Gli apparati divisi per gruppo, già ordinati. Le famiglie seguono l'ordine del centro; gli altri l'alfabeto. */
export function raggruppa(
  apparati: readonly ApparatoElenco[],
  v: Pick<Vista, "gruppo" | "ordine">,
  famiglie: ReadonlyArray<{ codice: string; etichetta: string }>,
): Gruppo[] {
  const lista = ordina(apparati, v.ordine);
  if (v.gruppo === "nessuno") return lista.length ? [{ chiave: "", etichetta: "", lista }] : [];
  const nomeFamiglia = new Map(famiglie.map((f) => [f.codice, f.etichetta]));
  const chiaveDi = (a: ApparatoElenco): [string, string] => {
    if (v.gruppo === "famiglia") return nomeFamiglia.has(a.famiglia) ? [a.famiglia, nomeFamiglia.get(a.famiglia)!] : ["altro", "Altro"];
    if (v.gruppo === "rete") return a.rete ? [testoRete(a), testoRete(a)] : ["", "Senza rete in DA-IPAM"];
    if (v.gruppo === "marca") return a.marca ? [a.marca, a.marca] : ["", "Marca non nota"];
    return [a.stato, TESTO_STATO[a.stato]];
  };
  const per = new Map<string, Gruppo>();
  for (const a of lista) {
    const [chiave, etichetta] = chiaveDi(a);
    const g = per.get(chiave) ?? { chiave, etichetta, lista: [] };
    g.lista.push(a);
    per.set(chiave, g);
  }
  const gruppi = [...per.values()];
  if (v.gruppo === "famiglia") {
    const posto = (c: string) => { const i = famiglie.findIndex((f) => f.codice === c); return i === -1 ? 999 : i; };
    return gruppi.sort((x, y) => posto(x.chiave) - posto(y.chiave));
  }
  return gruppi.sort((x, y) => confronta(x.chiave, y.chiave));
}
