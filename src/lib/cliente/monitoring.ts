/**
 * DATIA MONITORING: lo stato degli apparati del cliente dai dati di Zabbix, per famiglia
 * (Riccardo, 13/11/2026: «i clienti devono vedere lo stato dei servizi da quella UI senza
 * avere accesso al sistema»). Piano: `docs/superpowers/plans/2026-11-13-datia-monitoring.md`.
 *
 * Qui c'è solo la logica, pura: dalla lettura del centro alla pagina. Regole:
 * - **non so** è uno stato a sé: lettura vecchia, proxy fermo o nessun segno di vita non
 *   diventano mai un «funziona» di prima;
 * - **fermo** vuol dire che l'oggetto non risponde (ping, interfaccia o un problema di
 *   disponibilità aperto), non che ha un problema qualunque;
 * - il cliente vede i problemi da «Media» in su; «preso in carico» diventa «Domarc ci sta
 *   lavorando»;
 * - la famiglia prende lo stato peggiore fra i suoi oggetti;
 * - i nomi dei problemi arrivano da Zabbix in inglese: si traducono in frasi da cliente,
 *   e quello che non si riconosce resta com'è, senza inventare.
 *
 * Senza import lato server: la usano la scheda, la pagina e le prove.
 */
import type {
  MisuraDelCentro,
  OggettoDiFamiglia,
  ProblemaDelCentro,
  RispostaFamiglie,
  RispostaStorico,
} from "@/lib/zabbix-lettura/api";
import { IMPOSTAZIONI_VUOTE, type ImpostazioniMonitoring } from "./monitoring-impostazioni";

export type StatoOggetto = "funziona" | "attenzione" | "fermo" | "non_so";

export const ETICHETTA_STATO: Readonly<Record<StatoOggetto, string>> = {
  funziona: "Funziona",
  attenzione: "Attenzione",
  fermo: "Fermo",
  non_so: "Non so",
};

/** Dal peggiore al migliore: così si sceglie lo stato di una famiglia e si ordina un elenco. */
const PESO: Record<StatoOggetto, number> = { fermo: 0, attenzione: 1, non_so: 2, funziona: 3 };

/** «Media» di Zabbix: sotto, il cliente non vede. */
export const SOGLIA_CLIENTE = 3;
/** Da «Alta» in su il problema si dice grave. */
export const SOGLIA_GRAVE = 4;

/** Le famiglie che la pagina mostra sempre in fondo, e solo se hanno oggetti. */
const IN_CODA = new Set(["altro"]);

export interface ProblemaMostrato {
  eventid: string;
  hostid: string;
  nomeOggetto: string;
  famiglia: string;
  grave: boolean;
  /** La frase per il cliente. */
  frase: string;
  dal: string | null;
  presoInCarico: boolean;
  /** Quante volte lo stesso problema è aperto su quell'oggetto (nodi o macchine diverse). */
  quante: number;
}

export interface OggettoMostrato {
  hostid: string;
  nome: string;
  stato: StatoOggetto;
  /** Perché è in quello stato, quando non è «funziona». */
  motivo: string | null;
  misure: MisuraDelCentro[];
  problemi: number;
}

export interface FamigliaMostrata {
  codice: string;
  etichetta: string;
  stato: StatoOggetto;
  oggetti: OggettoMostrato[];
  conta: Record<StatoOggetto, number>;
  /** Due o tre numeri della famiglia, per il riquadro. */
  sintesi: Array<{ etichetta: string; valore: string }>;
  /** 30 voci, dalla più vecchia a oggi: minuti di fermo del giorno; null senza storico. */
  fermoPerGiorno: number[] | null;
  /** Percentuale di tempo senza fermi nei 30 giorni; null senza storico. */
  disponibilita30: number | null;
}

/** Un numero del mese e lo stesso del mese prima; `precedente` null se il centro non ha 60 giorni. */
export interface Confronto {
  corrente: number;
  precedente: number | null;
}

export interface KpiMonitoring {
  /** Percentuale di tempo senza fermi, in media sugli apparati che il cliente vede. */
  disponibilita: Confronto | null;
  /** Problemi da «Media» in su aperti nei 30 giorni. */
  incidenti: Confronto | null;
  /**
   * Minuti entro cui si chiude metà dei problemi chiusi nei 30 giorni: la **mediana** (Riccardo, 13/11/2026).
   * La media la spostavano i pochi problemi lunghi (due NAS fermi da settimane). Su un centro che non dà le
   * chiusure una per una, la media.
   */
  soluzioneMin: Confronto | null;
  /** Il certificato che scade per primo fra quelli visibili. */
  scadenza: { giorni: number; oggetto: string } | null;
}

export interface SerieMonitoring {
  /** Le 30 date, dalla più vecchia a oggi. */
  giorni: string[];
  /** Disponibilità per giorno (0-100), sugli apparati visibili. */
  disponibilita: number[];
  /** Le ultime 4 settimane (28 giorni), la più vecchia prima. */
  settimane: Array<{ etichetta: string; gravi: number; medi: number }>;
}

/** Per il pannello di gestione: tutto, anche ciò che è nascosto, col nome di Zabbix e quello per il cliente. */
export interface FamigliaGestita {
  codice: string;
  etichetta: string;
  visibile: boolean;
  oggetti: Array<{ hostid: string; nomeZabbix: string; nomeCliente: string | null; visibile: boolean }>;
}

export interface Monitoring {
  kpi: KpiMonitoring;
  serie: SerieMonitoring | null;
  /** I dischi e i volumi più pieni fra gli apparati visibili, al più 5. */
  spazio: Array<{ nome: string; dettaglio: string; valore: number }>;
  gestione: FamigliaGestita[];
  /** La frase della fascia in alto. */
  frase: string;
  sottofrase: string | null;
  stato: StatoOggetto;
  lettoAlle: string | null;
  etaS: number;
  vecchio: boolean;
  famiglie: FamigliaMostrata[];
  problemi: ProblemaMostrato[];
  /** Problemi sotto la soglia o oltre il taglio del centro, non mostrati. */
  problemiNascosti: number;
  /** Righe tolte perché uguali a una già in elenco, sullo stesso oggetto. */
  problemiRaggruppati: number;
  giorni: string[];
  totali: Record<StatoOggetto, number>;
}

const FRASI: ReadonlyArray<[RegExp, string | ((m: RegExpMatchArray) => string)]> = [
  [/unavailable by icmp|icmp: unavailable|is unreachable/i, "non risponde"],
  [/agent is not available|active checks are not available|no data .* from agent/i, "l'agente di controllo non manda dati"],
  [/no snmp data collection|snmp .* not available/i, "non risponde alle letture SNMP"],
  [/icmp .*loss|packet loss/i, "la connessione perde pacchetti"],
  [/icmp .*response time|high ping/i, "risponde lentamente"],
  [/interface (.+?)(?:\(.*?\))?: link down/i, (m) => `una porta di rete è scollegata (${m[1]!.trim()})`],
  [/link down/i, "una porta di rete è scollegata"],
  [/interface (.+?)(?:\(.*?\))?: .*(?:lower speed|has changed to lower)/i, (m) => `una porta di rete va più lenta del solito (${m[1]!.trim()})`],
  [/lower speed|speed has changed/i, "una porta di rete va più lenta del solito"],
  [/interface .*(?:changed to|state)/i, "una porta di rete è cambiata di stato"],
  // «FS [User Disk(C:)]: Space is low»: il nome utile è la lettera fra parentesi, non l'etichetta.
  [/(?:fs|disk|volume|storage)\s*\[([^\]]+)\]:.*(?:space is (?:critically )?low|running out)/i, (m) => `spazio quasi finito su ${nomeDisco(m[1]!)}`],
  [/space is (?:critically )?low|running out of free|low free disk|free space/i, "spazio su disco quasi finito"],
  [/inodes/i, "il disco ha quasi finito i file che può contenere"],
  [/high cpu|cpu utilization|processor load|load average/i, "il processore è molto occupato"],
  [/high memory|lack of available memory|memory utilization|swap/i, "poca memoria libera"],
  [/has been restarted|uptime/i, "è stato riavviato"],
  [/service "?(.+?)"? .*(?:is not running|has been stopped|is down)/i, (m) => `il servizio «${m[1]!.trim()}» è fermo`],
  [/is not running|has been stopped|service is down/i, "un servizio è fermo"],
  [/temperature|temperatura/i, "temperatura alta"],
  [/fan /i, "una ventola non funziona bene"],
  [/certificate.*(?:expire|invalid)|cert/i, "certificato scaduto o in scadenza"],
  [/raid|smart|disk .*(?:fail|error|degraded)|bad sector/i, "problema su un disco"],
  [/vm .*(?:not running|stopped)/i, "una macchina virtuale è ferma"],
  [/node .*(?:offline|not online)|cluster/i, "un nodo non è in linea"],
  [/battery|on battery|ups/i, "problema di alimentazione"],
  [/time is out of sync|system time/i, "l'orologio non è allineato"],
];

/** «User Disk(C:)» → «C:», «(E:)» → «E:», «/volume1» resta com'è. */
function nomeDisco(grezzo: string): string {
  const t = grezzo.trim();
  const dentro = t.match(/\(([^)]+)\)/);
  return (dentro ? dentro[1]! : t).replace(/[:\\/]+$/, "").trim() || t;
}

/** La frase da cliente per il nome di un problema di Zabbix; se non si riconosce, il nome ripulito. */
export function fraseProblema(nome: string): string {
  const t = nome.replace(/\s+/g, " ").trim();
  for (const [rx, frase] of FRASI) {
    const m = t.match(rx);
    if (m) return typeof frase === "string" ? frase : frase(m);
  }
  return t.slice(0, 120) || "problema segnalato";
}

const DISPONIBILITA = /unavailable by icmp|icmp: unavailable|agent is not available|is unreachable/i;

/** Lo stato di un oggetto e il suo motivo. */
export function statoOggetto(
  o: OggettoDiFamiglia,
  problemi: readonly ProblemaDelCentro[],
  letturaVecchia: boolean,
): { stato: StatoOggetto; motivo: string | null } {
  if (letturaVecchia) return { stato: "non_so", motivo: "il centro non ha dati recenti" };
  if (!o.dati_affidabili) return { stato: "non_so", motivo: "il collegamento con la sede non risponde" };
  const visibili = problemi.filter((p) => p.gravita >= SOGLIA_CLIENTE);
  if (o.ping === "no" || o.disponibilita === "no" || problemi.some((p) => DISPONIBILITA.test(p.nome))) {
    return { stato: "fermo", motivo: "non risponde" };
  }
  if (visibili.length > 0) {
    const primo = [...visibili].sort((a, b) => b.gravita - a.gravita)[0]!;
    return { stato: "attenzione", motivo: fraseProblema(primo.nome) };
  }
  const vivo = o.ping === "si" || o.disponibilita === "si" || o.misure_vive > 0;
  if (!vivo) return { stato: "non_so", motivo: "nessun dato recente" };
  if (o.misure_configurate > 0 && o.misure_vive === 0) {
    return { stato: "attenzione", motivo: "risponde, ma non manda le sue misure" };
  }
  return { stato: "funziona", motivo: null };
}

function peggiore(stati: readonly StatoOggetto[]): StatoOggetto {
  return stati.reduce<StatoOggetto>((a, b) => (PESO[b] < PESO[a] ? b : a), "funziona");
}

function contaVuota(): Record<StatoOggetto, number> {
  return { funziona: 0, attenzione: 0, fermo: 0, non_so: 0 };
}

/** «93% (D:)», «3 di 4», «38 °C». */
export function testoMisura(m: MisuraDelCentro): string {
  if (m.valore === null) return "–";
  if (typeof m.valore === "string") return m.valore === "valid" ? "sì" : m.valore === "altro" ? "da verificare" : "no";
  const n = Number.isInteger(m.valore) ? String(m.valore) : m.valore.toFixed(1).replace(".", ",");
  if (m.totale !== undefined) return `${n} di ${m.totale}`;
  const unita = m.unita === "%" ? "%" : m.unita ? ` ${m.unita}` : "";
  return `${n}${unita}${m.dettaglio ? ` (${m.dettaglio})` : ""}`;
}

/** I numeri del riquadro di una famiglia: somme dove si contano cose, il peggiore dove è una percentuale. */
function sintesiFamiglia(oggetti: readonly OggettoDiFamiglia[]): Array<{ etichetta: string; valore: string }> {
  const per = new Map<string, MisuraDelCentro[]>();
  for (const o of oggetti) for (const m of o.misure) per.set(m.codice, [...(per.get(m.codice) ?? []), m]);
  const righe: Array<{ etichetta: string; valore: string }> = [];
  for (const [codice, lista] of per) {
    if (righe.length >= 3) break;
    if (codice === "cpu" || codice === "memoria" || codice === "validita") continue;
    const numeri = lista.filter((m) => typeof m.valore === "number") as Array<MisuraDelCentro & { valore: number }>;
    if (numeri.length === 0) continue;
    const primo = numeri[0]!;
    if (primo.totale !== undefined) {
      const su = numeri.reduce((s, m) => s + m.valore, 0);
      const totale = numeri.reduce((s, m) => s + (m.totale ?? 0), 0);
      righe.push({ etichetta: primo.etichetta, valore: `${su} di ${totale}` });
    } else if (codice === "scadenza") {
      const minimo = numeri.reduce((a, m) => (m.valore < a.valore ? m : a));
      righe.push({ etichetta: "Prima scadenza fra", valore: `${minimo.valore} giorni` });
    } else {
      const massimo = numeri.reduce((a, m) => (m.valore > a.valore ? m : a));
      righe.push({ etichetta: primo.etichetta, valore: testoMisura(massimo) });
    }
  }
  return righe;
}

const MINUTI_GIORNO = 1440;
const GIORNI = 30;
const GIORNI_LUNGHI = 60;
const ZERI: number[] = Array.from({ length: GIORNI_LUNGHI }, () => 0);
type ChiaveSerie = "fermo" | "minuti" | "aperti" | "gravi" | "chiusi" | "durata_chiusi";

/** Percentuale di tempo senza fermi fra i giorni `da` e `a` (esclusivo), in media sugli apparati; una cifra decimale. */
function disponibilitaDi(ids: readonly string[], serieDi: (h: string, k: ChiaveSerie) => number[], da: number, a: number): number {
  const totale = ids.length * (a - da) * MINUTI_GIORNO;
  if (totale <= 0) return 100;
  const fermi = ids.reduce((s, h) => s + serieDi(h, "fermo").slice(da, a).reduce((x, m) => x + Math.min(m, MINUTI_GIORNO), 0), 0);
  return Math.max(0, Math.round((1 - fermi / totale) * 1000) / 10);
}

/** La mediana, arrotondata al minuto; null senza valori. */
export function mediana(valori: readonly number[]): number | null {
  if (valori.length === 0) return null;
  const o = [...valori].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return Math.round(o.length % 2 ? o[m]! : (o[m - 1]! + o[m]!) / 2);
}

/** «2026-11-06» → «06/11». */
function etichettaGiorno(g: string): string {
  const [, m, d] = g.split("-");
  return d && m ? `${d}/${m}` : g;
}

export interface IngressoMonitoring {
  famiglie: RispostaFamiglie;
  /** Cosa l'amministratore ha nascosto o rinominato; assente = tutto visibile. */
  impostazioni?: ImpostazioniMonitoring;
  problemi: readonly ProblemaDelCentro[];
  problemiTroncati: number;
  storico: RispostaStorico | null;
  /** La lettura più vecchia fra quelle servite e se una era dalla cache del centro. */
  etaS: number;
  vecchio: boolean;
  lettoAlle: string | null;
}

/** Dalla lettura del centro alla pagina. */
export function componiMonitoring(i: IngressoMonitoring): Monitoring {
  const imp = i.impostazioni ?? IMPOSTAZIONI_VUOTE;
  const vecchio = i.vecchio || i.famiglie.vecchio;
  const etichetteTutte = new Map(i.famiglie.famiglie.map((f) => [f.codice, f.etichetta]));
  const famigliaVera = (o: OggettoDiFamiglia) => (etichetteTutte.has(o.famiglia) ? o.famiglia : "altro");
  // Il pannello di gestione vede tutto; il resto della pagina solo ciò che il cliente può vedere.
  const gestione: FamigliaGestita[] = i.famiglie.famiglie
    .map((f) => ({
      codice: f.codice,
      etichetta: f.etichetta,
      visibile: !imp.famiglieNascoste.has(f.codice),
      oggetti: i.famiglie.host
        .filter((o) => famigliaVera(o) === f.codice)
        .map((o) => ({ hostid: o.hostid, nomeZabbix: o.nome, nomeCliente: imp.nomi.get(o.hostid) ?? null, visibile: !imp.hostNascosti.has(o.hostid) }))
        .sort((a, b) => a.nomeZabbix.localeCompare(b.nomeZabbix, "it")),
    }))
    .filter((f) => f.oggetti.length > 0);
  const oggettiVisibili = i.famiglie.host
    .filter((o) => !imp.hostNascosti.has(o.hostid) && !imp.famiglieNascoste.has(famigliaVera(o)))
    .map((o) => ({ ...o, nome: imp.nomi.get(o.hostid) ?? o.nome }));
  const idVisibili = new Set(oggettiVisibili.map((o) => o.hostid));
  i = { ...i, famiglie: { ...i.famiglie, host: oggettiVisibili }, problemi: i.problemi.filter((p) => idVisibili.has(p.hostid)) };
  // I conti per apparato del centro (60 giorni): solo così si tolgono dai conti gli apparati nascosti.
  const perHost = i.storico && i.storico.giorni_lunghi.length === GIORNI_LUNGHI ? i.storico.per_host : null;
  const serieDi = (hid: string, k: ChiaveSerie): number[] => {
    const v = perHost?.[hid]?.[k];
    return v && v.length === GIORNI_LUNGHI ? v : ZERI;
  };
  const problemiDi = new Map<string, ProblemaDelCentro[]>();
  for (const p of i.problemi) problemiDi.set(p.hostid, [...(problemiDi.get(p.hostid) ?? []), p]);
  const etichette = new Map(i.famiglie.famiglie.map((f) => [f.codice, f.etichetta]));
  const ordine = i.famiglie.famiglie.map((f) => f.codice);
  const perFamiglia = new Map<string, OggettoDiFamiglia[]>();
  for (const o of i.famiglie.host) {
    const codice = etichette.has(o.famiglia) ? o.famiglia : "altro";
    perFamiglia.set(codice, [...(perFamiglia.get(codice) ?? []), o]);
  }
  const totali = contaVuota();
  const famiglie: FamigliaMostrata[] = [];
  for (const codice of [...ordine.filter((c) => !IN_CODA.has(c)), ...ordine.filter((c) => IN_CODA.has(c))]) {
    const lista = perFamiglia.get(codice);
    if (!lista?.length) continue;
    const conta = contaVuota();
    const oggetti: OggettoMostrato[] = lista.map((o) => {
      const suoi = problemiDi.get(o.hostid) ?? [];
      const { stato, motivo } = statoOggetto(o, suoi, vecchio);
      conta[stato] += 1;
      totali[stato] += 1;
      return {
        hostid: o.hostid,
        nome: o.nome,
        stato,
        motivo,
        misure: o.misure,
        problemi: suoi.filter((p) => p.gravita >= SOGLIA_CLIENTE).length,
      };
    });
    oggetti.sort((a, b) => PESO[a.stato] - PESO[b.stato] || a.nome.localeCompare(b.nome, "it"));
    // Con i conti per apparato: il giorno è «fermo» se almeno un apparato visibile della famiglia lo era,
    // e la disponibilità è la media sugli apparati. Senza (centro vecchio): il conto per famiglia di prima.
    const fermo = perHost
      ? Array.from({ length: GIORNI }, (_, d) => Math.max(0, ...lista.map((o) => serieDi(o.hostid, "fermo")[GIORNI + d] ?? 0)))
      : i.storico
        ? (i.storico.minuti_fermo[codice] ?? i.storico.giorni.map(() => 0))
        : null;
    const giorni = i.storico?.giorni.length ?? 0;
    const disponibilitaFamiglia = perHost && lista.length > 0 ? disponibilitaDi(lista.map((o) => o.hostid), serieDi, GIORNI, GIORNI_LUNGHI) : null;
    famiglie.push({
      codice,
      etichetta: etichette.get(codice) ?? codice,
      stato: peggiore(oggetti.map((o) => o.stato)),
      oggetti,
      conta,
      sintesi: sintesiFamiglia(lista),
      fermoPerGiorno: fermo,
      disponibilita30: disponibilitaFamiglia ?? (
        fermo && giorni > 0
          ? Math.max(0, Math.round((1 - fermo.reduce((s, m) => s + Math.min(m, MINUTI_GIORNO), 0) / (giorni * MINUTI_GIORNO)) * 1000) / 10)
          : null),
    });
  }
  const famigliaDi = new Map<string, string>();
  const nomeDi = new Map<string, string>();
  for (const f of famiglie) for (const o of f.oggetti) {
    famigliaDi.set(o.hostid, f.etichetta);
    nomeDi.set(o.hostid, o.nome);
  }
  const visibili = i.problemi.filter((p) => p.gravita >= SOGLIA_CLIENTE && nomeDi.has(p.hostid));
  // Lo stesso problema su più nodi o macchine di un host (su Proxmox «è stato riavviato»
  // esce quattro volte) si dice una volta sola, col conto: quattro righe uguali non
  // aiutano il cliente. Resta il più vecchio, e «in carico» solo se lo sono tutti.
  const problemi: ProblemaMostrato[] = [];
  const indice = new Map<string, number>();
  for (const p of visibili) {
    const frase = fraseProblema(p.nome);
    const chiave = `${p.hostid}|${frase}`;
    const gia = indice.get(chiave);
    if (gia !== undefined) {
      const r = problemi[gia]!;
      r.quante += 1;
      r.grave = r.grave || p.gravita >= SOGLIA_GRAVE;
      r.presoInCarico = r.presoInCarico && p.preso_in_carico;
      if (p.dal && (!r.dal || p.dal < r.dal)) r.dal = p.dal;
      continue;
    }
    indice.set(chiave, problemi.length);
    problemi.push({
      eventid: p.eventid,
      hostid: p.hostid,
      nomeOggetto: nomeDi.get(p.hostid)!,
      famiglia: famigliaDi.get(p.hostid)!,
      grave: p.gravita >= SOGLIA_GRAVE,
      frase,
      dal: p.dal ?? null,
      presoInCarico: p.preso_in_carico,
      quante: 1,
    });
  }

  const quanti = (n: number, uno: string, tanti: string) => `${n} ${n === 1 ? uno : tanti}`;
  let frase: string;
  let sottofrase: string | null = null;
  let stato: StatoOggetto;
  const tutti = i.famiglie.host.length;
  if (vecchio) {
    stato = "non_so";
    frase = "Non so: il centro non ha dati recenti";
    sottofrase = "Gli stati qui sotto non sono mostrati finché i dati non tornano freschi.";
  } else if (tutti === 0) {
    stato = "non_so";
    frase = "Nessun apparato sotto controllo";
  } else if (totali.fermo > 0 || totali.attenzione > 0) {
    stato = totali.fermo > 0 ? "fermo" : "attenzione";
    const pezzi: string[] = [];
    if (totali.fermo > 0) pezzi.push(quanti(totali.fermo, "apparato fermo", "apparati fermi"));
    if (totali.attenzione > 0) pezzi.push(`${totali.attenzione} da tenere d'occhio`);
    frase = pezzi.join(", ");
    const resto: string[] = [];
    if (totali.funziona > 0) resto.push(quanti(totali.funziona, "funziona", "funzionano"));
    if (totali.non_so > 0) resto.push(`di ${totali.non_so} non so`);
    sottofrase = resto.length ? `Gli altri: ${resto.join(", ")}` : null;
  } else if (totali.non_so > 0) {
    stato = "non_so";
    frase = `${quanti(totali.funziona, "apparato funziona", "apparati funzionano")}, di ${totali.non_so} non so`;
  } else {
    stato = "funziona";
    frase = tutti === 1 ? "Tutto funziona: 1 apparato sotto controllo" : `Tutto funziona: ${tutti} apparati sotto controllo`;
  }
  // ── KPI e serie, sugli apparati che il cliente vede ──
  const ids = [...idVisibili];
  const somma = (k: ChiaveSerie, da: number, a: number) => ids.reduce((s, h) => s + serieDi(h, k).slice(da, a).reduce((x, y) => x + y, 0), 0);
  const confronto = (corrente: number | null, precedente: number | null): Confronto | null =>
    corrente === null ? null : { corrente, precedente };
  const conChiusure = perHost !== null && ids.some((h) => (perHost[h]?.chiusure.length ?? 0) > 0);
  const media = (da: number, a: number): number | null => {
    if (conChiusure) {
      const durate = ids.flatMap((h) => (perHost?.[h]?.chiusure ?? []).filter(([g]) => g >= da && g < a).map(([, m]) => m));
      return mediana(durate);
    }
    const chiusi = somma("chiusi", da, a);
    return chiusi > 0 ? Math.round(somma("durata_chiusi", da, a) / chiusi) : null;
  };
  let scadenza: KpiMonitoring["scadenza"] = null;
  const spazio: Monitoring["spazio"] = [];
  for (const o of oggettiVisibili) {
    for (const m of o.misure) {
      if (typeof m.valore !== "number") continue;
      if (m.codice === "scadenza" && (!scadenza || m.valore < scadenza.giorni)) scadenza = { giorni: m.valore, oggetto: o.nome };
      if (m.codice === "disco" || m.codice === "volume" || m.codice === "spazio") spazio.push({ nome: o.nome, dettaglio: m.dettaglio ?? "", valore: m.valore });
    }
  }
  spazio.sort((a, b) => b.valore - a.valore);
  const kpi: KpiMonitoring = {
    disponibilita: perHost && ids.length
      ? confronto(disponibilitaDi(ids, serieDi, GIORNI, GIORNI_LUNGHI), disponibilitaDi(ids, serieDi, 0, GIORNI))
      : null,
    incidenti: perHost ? confronto(somma("aperti", GIORNI, GIORNI_LUNGHI), somma("aperti", 0, GIORNI)) : null,
    soluzioneMin: perHost ? confronto(media(GIORNI, GIORNI_LUNGHI), media(0, GIORNI)) : null,
    scadenza,
  };
  const serie: SerieMonitoring | null =
    perHost && i.storico && ids.length
      ? {
          giorni: i.storico.giorni_lunghi.slice(GIORNI),
          disponibilita: Array.from({ length: GIORNI }, (_, d) => disponibilitaDi(ids, serieDi, GIORNI + d, GIORNI + d + 1)),
          settimane: [0, 1, 2, 3].map((w) => {
            const da = GIORNI_LUNGHI - 28 + w * 7;
            const gravi = somma("gravi", da, da + 7);
            return { etichetta: etichettaGiorno(i.storico!.giorni_lunghi[da] ?? ""), gravi, medi: somma("aperti", da, da + 7) - gravi };
          }),
        }
      : null;

  return {
    kpi,
    serie,
    spazio: spazio.slice(0, 5),
    gestione,
    frase,
    sottofrase,
    stato,
    lettoAlle: i.lettoAlle,
    etaS: Math.max(i.etaS, i.famiglie.eta_s),
    vecchio,
    famiglie,
    problemi,
    problemiNascosti: i.problemi.length - visibili.length + i.problemiTroncati,
    problemiRaggruppati: visibili.length - problemi.length,
    giorni: i.storico?.giorni ?? [],
    totali,
  };
}
