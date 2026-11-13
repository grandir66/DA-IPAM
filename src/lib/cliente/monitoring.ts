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

export interface Monitoring {
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
  [/(?:fs|disk|volume|storage) \[?\(?([^\]:)]+)\)?\]?:.*(?:space is (?:critically )?low|running out)/i, (m) => `spazio quasi finito su ${m[1]!.trim()}`],
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

export interface IngressoMonitoring {
  famiglie: RispostaFamiglie;
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
  const vecchio = i.vecchio || i.famiglie.vecchio;
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
    const fermo = i.storico ? (i.storico.minuti_fermo[codice] ?? i.storico.giorni.map(() => 0)) : null;
    const giorni = i.storico?.giorni.length ?? 0;
    famiglie.push({
      codice,
      etichetta: etichette.get(codice) ?? codice,
      stato: peggiore(oggetti.map((o) => o.stato)),
      oggetti,
      conta,
      sintesi: sintesiFamiglia(lista),
      fermoPerGiorno: fermo,
      disponibilita30:
        fermo && giorni > 0
          ? Math.max(0, Math.round((1 - fermo.reduce((s, m) => s + Math.min(m, MINUTI_GIORNO), 0) / (giorni * MINUTI_GIORNO)) * 1000) / 10)
          : null,
    });
  }
  const famigliaDi = new Map<string, string>();
  const nomeDi = new Map<string, string>();
  for (const f of famiglie) for (const o of f.oggetti) {
    famigliaDi.set(o.hostid, f.etichetta);
    nomeDi.set(o.hostid, o.nome);
  }
  const visibili = i.problemi.filter((p) => p.gravita >= SOGLIA_CLIENTE && nomeDi.has(p.hostid));
  const problemi: ProblemaMostrato[] = visibili.map((p) => ({
    eventid: p.eventid,
    hostid: p.hostid,
    nomeOggetto: nomeDi.get(p.hostid)!,
    famiglia: famigliaDi.get(p.hostid)!,
    grave: p.gravita >= SOGLIA_GRAVE,
    frase: fraseProblema(p.nome),
    dal: p.dal ?? null,
    presoInCarico: p.preso_in_carico,
  }));

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
  return {
    frase,
    sottofrase,
    stato,
    lettoAlle: i.lettoAlle,
    etaS: Math.max(i.etaS, i.famiglie.eta_s),
    vecchio,
    famiglie,
    problemi,
    problemiNascosti: i.problemi.length - visibili.length + i.problemiTroncati,
    giorni: i.storico?.giorni ?? [],
    totali,
  };
}
