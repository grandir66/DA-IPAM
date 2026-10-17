/**
 * Il pannello Zabbix come lo vede la pagina (passo 7.4): stati, forma della risposta
 * di `GET /api/zabbix/pannello`, e le regole di presentazione dei dati vecchi.
 *
 * Regole (§6 e §7 del design dell'API):
 * - dati vecchi (lettura servita dalla cache del centro) o host con
 *   `dati_affidabili: false` (proxy fermo) → disponibilità «non so», con accanto
 *   l'ultimo valore noto; mai un «sì» spacciato per adesso;
 * - «tutto ok» solo con dati freschi, proxy in linea, ogni host affidabile e
 *   disponibile, nessun problema aperto. Altrimenti si dice perché no;
 * - un valore vecchio si mostra come vecchio.
 *
 * Pura e senza import lato server: la usano la rotta, la pagina e le prove.
 */
import type { HostDelCentro, ProblemaDelCentro, ValoreDisponibilita } from "./api";
import type { AbbinamentoSalvato, EsitoAbbinamento } from "./abbinamento";

/** Stato del pannello, nell'ordine in cui si decide. */
export type StatoPannello = "non_acquistato" | "da_configurare" | "spento" | "guasto" | "ok";

export const ETICHETTA_STATO_PANNELLO: Readonly<Record<StatoPannello, string>> = {
  non_acquistato: "Non acquistato",
  da_configurare: "Da configurare",
  spento: "Spento",
  guasto: "Guasto",
  ok: "Attivo",
};

export const ETICHETTA_DISPONIBILITA: Readonly<Record<ValoreDisponibilita, string>> = {
  si: "Disponibile",
  no: "Non disponibile",
  non_so: "Non so",
};

export const ETICHETTA_GRAVITA: readonly string[] = [
  "Non classificato",
  "Informazione",
  "Avviso",
  "Media",
  "Alta",
  "Disastro",
];

/** Il proxy Zabbix di QUESTA macchina, visto dalla macchina (non dal centro). */
export interface ProxyLocale {
  /** `gira` = processo vivo; `fermo` = installato e fermo; `assente` = non installato. */
  stato: "gira" | "fermo" | "assente" | "non_so";
  /** Nome del proxy (`Hostname=` del file, o quello scritto in configurazione), se noto. */
  nome: string | null;
}

export interface ValoreMostrato {
  chiave: string;
  valore: number | string | null;
  unita: string;
  clock: string | null;
  vecchio: boolean;
}

export interface HostMostrato {
  hostid: string;
  nome: string;
  host: string;
  ip: string[];
  proxy: string | null;
  /** Il proxy è quello di questa macchina. */
  diQuestaMacchina: boolean;
  tipologia: string | null;
  /** Quella da mostrare: «non so» se i dati non sono affidabili o sono vecchi. */
  disponibilita: ValoreDisponibilita;
  /** Quella detta dal centro, mostrata come «ultimo noto» quando diversa. */
  disponibilitaUltimaNota: ValoreDisponibilita;
  datiAffidabili: boolean;
  problemiAperti: number;
  abbinamento: EsitoAbbinamento;
  valori: ValoreMostrato[];
}

export interface Riepilogo {
  tuttoOk: boolean;
  /** Perché non è «tutto ok», in italiano. Vuoto solo se tuttoOk. */
  motivi: string[];
  host: number;
  disponibili: number;
  nonDisponibili: number;
  nonSo: number;
  problemi: number;
}

export interface ProxyMostrato {
  nome: string;
  inLinea: boolean;
  ultimoContatto: string | null;
  diQuestaMacchina: boolean;
}

interface PannelloBase {
  proxyLocale: ProxyLocale;
}

export type PannelloZabbix =
  | (PannelloBase & { stato: "non_acquistato" | "da_configurare" | "spento"; messaggio: string })
  | (PannelloBase & {
      stato: "guasto";
      messaggio: string;
      clienteErrato: boolean;
      ultimaLetturaOk: string | null;
      prossimoTentativo: string | null;
      fallimenti: number;
    })
  | (PannelloBase & {
      stato: "ok";
      cliente: string;
      codcli: string;
      lettoAlle: string | null;
      etaS: number;
      vecchio: boolean;
      proxyCentro: ProxyMostrato[];
      riepilogo: Riepilogo;
      problemi: Array<ProblemaDelCentro & { nomeHost: string }>;
      problemiTroncati: number;
      host: HostMostrato[];
      pagina: number;
      per: number;
      totale: number;
      persi: AbbinamentoSalvato[];
      /** I valori della pagina non si sono letti (il resto sì). */
      erroreValori: string | null;
    });

/** La disponibilità da mostrare per un host. */
export function disponibilitaDaMostrare(h: HostDelCentro, letturaVecchia: boolean): ValoreDisponibilita {
  if (letturaVecchia || !h.dati_affidabili) return "non_so";
  return h.disponibilita.complessiva;
}

function minuti(s: number): string {
  const m = Math.round(s / 60);
  return m <= 1 ? "circa un minuto" : `${m} minuti`;
}

/** Il riepilogo di tutti gli host del cliente. «Tutto ok» solo se ogni condizione regge. */
export function riepiloga(
  host: readonly HostDelCentro[],
  proxy: readonly ProxyMostrato[],
  problemi: number,
  lettura: { vecchio: boolean; etaS: number },
): Riepilogo {
  let disponibili = 0;
  let nonDisponibili = 0;
  let nonSo = 0;
  for (const h of host) {
    const d = disponibilitaDaMostrare(h, lettura.vecchio);
    if (d === "si") disponibili++;
    else if (d === "no") nonDisponibili++;
    else nonSo++;
  }
  const motivi: string[] = [];
  if (lettura.vecchio) {
    motivi.push(`dati vecchi di ${minuti(lettura.etaS)}: il centro non riesce a leggere Zabbix`);
  }
  const fermi = proxy.filter((p) => !p.inLinea);
  if (fermi.length) motivi.push(`proxy fuori linea per il centro: ${fermi.map((p) => p.nome).join(", ")}`);
  if (host.length === 0) motivi.push("nessun host del cliente sul centro");
  if (nonDisponibili) motivi.push(`${nonDisponibili} host non disponibili`);
  if (nonSo && !lettura.vecchio) motivi.push(`${nonSo} host con disponibilità non nota`);
  if (problemi) motivi.push(`${problemi} problemi aperti`);
  return {
    tuttoOk: motivi.length === 0,
    motivi,
    host: host.length,
    disponibili,
    nonDisponibili,
    nonSo,
    problemi,
  };
}

/** Attesa prima del prossimo tentativo dopo `fallimenti` consecutivi: 15 s, 30 s, … fino a 5 minuti. */
export const ATTESA_MINIMA_S = 15;
export const ATTESA_MASSIMA_S = 300;

export function attesaDopoFallimenti(fallimenti: number, riprovaTraS?: number): number {
  const n = Math.max(1, fallimenti);
  const crescente = Math.min(ATTESA_MASSIMA_S, ATTESA_MINIMA_S * 2 ** Math.min(n - 1, 10));
  return Math.min(ATTESA_MASSIMA_S, Math.max(crescente, riprovaTraS ?? 0));
}

/** Nome breve di una misura, per la pagina. */
export const ETICHETTA_MISURA: Readonly<Record<string, string>> = {
  icmpping: "Ping",
  icmppingloss: "Perdita",
  icmppingsec: "Latenza",
  "agent.ping": "Agente",
  "system.uptime": "Acceso da",
  "system.cpu.util": "CPU",
  "vm.memory.utilization": "Memoria",
};

/** Un valore delle sette misure, leggibile. Un valore mancante è «—», mai uno zero. */
export function formattaMisura(chiave: string, valore: number | string | null): string {
  if (valore === null || valore === "") return "—";
  const n = typeof valore === "number" ? valore : Number(valore);
  if (!Number.isFinite(n)) return String(valore);
  switch (chiave) {
    case "icmpping":
    case "agent.ping":
      return n >= 1 ? "risponde" : "non risponde";
    case "icmppingsec":
      return `${(n * 1000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} ms`;
    case "icmppingloss":
    case "system.cpu.util":
    case "vm.memory.utilization":
      return `${n.toLocaleString("it-IT", { maximumFractionDigits: 1 })} %`;
    case "system.uptime": {
      const giorni = Math.floor(n / 86_400);
      const ore = Math.floor((n % 86_400) / 3_600);
      return giorni > 0 ? `${giorni} g ${ore} h` : `${ore} h ${Math.floor((n % 3_600) / 60)} min`;
    }
    default:
      return String(valore);
  }
}
