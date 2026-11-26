/**
 * «Metti in monitoraggio»: DA-IPAM manda un oggetto al centro, che lo crea in Zabbix
 * (13/11/2026, tappa C del piano DATIA MONITORING).
 *
 * Il centro decide tutto — template, perimetro, nome tecnico — perché la regola di scelta
 * vive là ed è una sola (`zbximport/mapping.py`). Qui si manda quello che DA-IPAM sa
 * dell'oggetto e si legge l'esito. Per Windows e Linux torna lo script dell'agente, che
 * **una persona lancia a mano** sulla macchina (Riccardo, 13/11): DA-IPAM non lo esegue.
 *
 * Senza import lato server: il trasporto si passa, come per la lettura.
 */
import { z } from "zod";
import { ErroreApi, TESTO_CODICE_ERRORE } from "./api";
import { ErroreLettura, type TrasportoPost } from "./trasporto";

/** Il testo quando la rotta nuova non c'è sul centro (404): la pagina spegne i pulsanti nuovi e lo dice. */
export const TESTO_CENTRO_VECCHIO = "Il centro non è ancora aggiornato";
/** Codici che hanno un testo nostro anche per le rotte in cui il centro motiva da sé. */
const CODICI_DI_SISTEMA = new Set(["troppe_richieste", "chiave_non_valida", "api_spenta", "tetto_giornaliero", "apparato_sconosciuto"]);

export const PERCORSO_SCRITTURA = "/api/scrittura/v1/oggetto";

/** I campi che il centro accetta: gli stessi della riga `hosts` che la sua regola legge. */
export interface OggettoDaMettere {
  ip: string;
  mac?: string | null;
  hostname?: string | null;
  customName?: string | null;
  classification?: string | null;
  vendor?: string | null;
  osInfo?: string | null;
  model?: string | null;
  /** JSON, come lo tiene DA-IPAM. */
  openPorts?: string | null;
  snmpData?: string | null;
  /** Gli altri IP dello stesso apparato fisico: il centro li usa per non fare doppioni. */
  altriIp?: string[];
}

export interface OpzioniScrittura {
  /** Non scrive niente: dice solo cosa farebbe. */
  prova?: boolean;
  /** Entra anche se il centro lo direbbe fuori perimetro. */
  forza?: boolean;
  /** Dove l'agente manda i dati; senza, lo ricava il centro. */
  serverActive?: string | null;
  /** La famiglia da scrivere in Zabbix (tag `famiglia`, 13/11/2026); senza, la decide il centro. */
  famiglia?: string | null;
}

const Comune = {
  nome: z.string().catch(""),
  host: z.string().catch(""),
  ip: z.string().catch(""),
  template: z.array(z.string()).catch([]),
  motivo: z.string().catch(""),
  avvisi: z.array(z.string()).catch([]),
  da_rivedere: z.boolean().catch(false),
};

export const EsitoScrittura = z.discriminatedUnion("esito", [
  z.object({ esito: z.literal("inserito"), ...Comune }),
  z.object({ esito: z.literal("gia_presente"), ...Comune }),
  z.object({
    esito: z.literal("serve_agente"),
    sistema: z.enum(["windows", "linux"]),
    comando: z.string().nullable().catch(null),
    server_active: z.string().optional().catch(undefined),
    origine_server: z.string().optional().catch(undefined),
    perche_senza_comando: z.string().optional().catch(undefined),
    ...Comune,
  }),
  z.object({
    esito: z.literal("fuori_perimetro"),
    motivo: z.string().catch(""),
    nome: z.string().catch(""),
    ip: z.string().catch(""),
    si_puo_forzare: z.boolean().catch(true),
  }),
  z.object({ esito: z.literal("prova"), farebbe: z.string().catch(""), ...Comune }),
]);
export type EsitoScrittura = z.infer<typeof EsitoScrittura>;

/** Il corpo da mandare: i campi vuoti non si mandano affatto. */
export function corpoScrittura(o: OggettoDaMettere, op: OpzioniScrittura = {}): Record<string, unknown> {
  const campi: Array<[string, unknown]> = [
    ["ip", o.ip.trim()],
    ["mac", o.mac],
    ["hostname", o.hostname],
    ["custom_name", o.customName],
    ["classification", o.classification],
    ["vendor", o.vendor],
    ["os_info", o.osInfo],
    ["model", o.model],
    ["open_ports", o.openPorts],
    ["snmp_data", o.snmpData],
  ];
  const corpo: Record<string, unknown> = {};
  for (const [k, v] of campi) if (typeof v === "string" && v.trim() !== "") corpo[k] = v;
  const altri = (o.altriIp ?? []).filter((x) => x && x !== o.ip).slice(0, 16);
  if (altri.length) corpo.altri_ip = altri;
  if (op.prova) corpo.prova = true;
  if (op.forza) corpo.forza = true;
  if (op.serverActive && op.serverActive.trim()) corpo.server_active = op.serverActive.trim();
  if (op.famiglia && op.famiglia !== "altro") corpo.famiglia = op.famiglia;
  return corpo;
}

/**
 * Manda l'oggetto al centro. Lancia `ErroreLettura` per rete, certificato, tempo, HTTP
 * diverso da 200 o risposta di forma inattesa: chi chiama lo mostra, non lo nasconde.
 */
export async function mettiInMonitoraggio(
  l: { base: URL; trasportoPost: TrasportoPost },
  o: OggettoDaMettere,
  op: OpzioniScrittura = {},
): Promise<EsitoScrittura> {
  return posta(l, PERCORSO_SCRITTURA, corpoScrittura(o, op), EsitoScrittura);
}

/** Una POST al centro con la chiave di scrittura, letta col suo schema; errori col testo nostro. */
async function posta<S extends z.ZodType>(
  l: { base: URL; trasportoPost: TrasportoPost },
  percorso: string,
  corpoInviato: unknown,
  schema: S,
  /** Il centro motiva da sé i rifiuti di questa rotta (es. «c'è già un «X»»): si mostra il suo testo italiano. */
  usaTestoDelCentro = false,
): Promise<z.infer<S>> {
  const radice = l.base.pathname.replace(/\/+$/, "");
  const r = await l.trasportoPost(`${radice}${percorso}`, corpoInviato);
  let corpo: unknown = null;
  try {
    corpo = r.body ? JSON.parse(r.body) : null;
  } catch {
    corpo = null;
  }
  if (r.status !== 200) {
    const e = ErroreApi.safeParse(corpo);
    const codice = e.success ? e.data.codice : undefined;
    // 404 senza il corpo d'errore del centro = la rotta non esiste: centro non ancora aggiornato.
    // (Un 404 «apparato_sconosciuto» ha il suo codice e il suo testo.)
    if (r.status === 404 && !codice) throw new ErroreLettura("http", TESTO_CENTRO_VECCHIO, { status: 404, codice: "rotta_assente" });
    const delCentro = e.success && usaTestoDelCentro && !(codice && CODICI_DI_SISTEMA.has(codice)) ? e.data.errore?.trim().slice(0, 200) : undefined;
    const testo =
      delCentro ||
      (codice && TESTO_SCRITTURA[codice]) ||
      (codice && TESTO_CODICE_ERRORE[codice]) ||
      `il centro ha rifiutato l'inserimento (HTTP ${r.status})`;
    throw new ErroreLettura("http", testo, { status: r.status, codice });
  }
  const p = schema.safeParse(corpo);
  if (!p.success) throw new ErroreLettura("risposta", "risposta del centro di forma inattesa (scrittura)");
  return p.data;
}

// ── Modelli e agente (13/11/2026, Riccardo: «sì, solo modelli») ──

export const EsitoModelli = z.object({
  esito: z.enum(["prova", "cambiato", "invariato"]),
  hostid: z.string(),
  nome: z.string().catch(""),
  prima: z.array(z.string()).catch([]),
  dopo: z.array(z.string()).catch([]),
  aggiunti: z.array(z.string()).catch([]),
  tolti: z.array(z.string()).catch([]),
});
export type EsitoModelli = z.infer<typeof EsitoModelli>;

export interface CambioModelli {
  hostid: string;
  aggiungi?: string[];
  togli?: string[];
  prova?: boolean;
}

/** Aggiunge e toglie modelli a un apparato del cliente. Togliere cancella le misure di quel modello. */
export async function cambiaModelli(l: { base: URL; trasportoPost: TrasportoPost }, c: CambioModelli): Promise<EsitoModelli> {
  const corpo: Record<string, unknown> = { hostid: c.hostid };
  if (c.aggiungi?.length) corpo.aggiungi = c.aggiungi;
  if (c.togli?.length) corpo.togli = c.togli;
  if (c.prova) corpo.prova = true;
  return posta(l, "/api/scrittura/v1/modelli", corpo, EsitoModelli);
}

export const EsitoAgente = z.object({
  sistema: z.enum(["windows", "linux"]),
  hostname: z.string().catch(""),
  per_tutte: z.boolean().catch(false),
  server_active: z.string().catch(""),
  comando: z.string(),
});
export type EsitoAgente = z.infer<typeof EsitoAgente>;

/** Il comando dell'agente. Senza `hostname`: uno solo per tutte le macchine (usa il loro nome). */
export async function comandoAgente(
  l: { base: URL; trasportoPost: TrasportoPost },
  a: { sistema: "windows" | "linux"; hostname?: string | null; serverActive?: string | null },
): Promise<EsitoAgente> {
  const corpo: Record<string, unknown> = { sistema: a.sistema };
  if (a.hostname && a.hostname.trim()) corpo.hostname = a.hostname.trim();
  if (a.serverActive && a.serverActive.trim()) corpo.server_active = a.serverActive.trim();
  return posta(l, "/api/scrittura/v1/agente", corpo, EsitoAgente);
}

// ── Famiglia (13/11/2026): il tag `famiglia` sull'host decide dove compare nella pagina del cliente ──

export const EsitoFamiglia = z.object({
  esito: z.enum(["prova", "cambiato", "invariato"]),
  hostid: z.string(),
  nome: z.string().catch(""),
  prima: z.string().catch(""),
  dopo: z.string().catch(""),
  /** La famiglia che risulta dopo il cambio (26/11/2026: con `null` è quella decisa dal centro). Assente su un centro vecchio. */
  famiglia: z.string().nullable().optional().catch(undefined),
});
export type EsitoFamiglia = z.infer<typeof EsitoFamiglia>;

/** Cambia la famiglia di un apparato; `""` o `null` la riportano a quella decisa dal centro (`null` è la forma del 26/11). */
export async function cambiaFamiglia(
  l: { base: URL; trasportoPost: TrasportoPost },
  c: { hostid: string; famiglia: string | null; prova?: boolean },
): Promise<EsitoFamiglia> {
  const corpo: Record<string, unknown> = { hostid: c.hostid, famiglia: c.famiglia };
  if (c.prova) corpo.prova = true;
  return posta(l, "/api/scrittura/v1/famiglia", corpo, EsitoFamiglia);
}

// ── Sospendere, riattivare e togliere (26/11/2026, Riccardo: «manca un comando per rimuovere un oggetto da zabbix…
//    almeno dovremo pensare di metterlo in offline pausa o eliminarlo») ──

export const EsitoStato = z.object({
  esito: z.enum(["prova", "cambiato", "gia_cosi"]),
  hostid: z.string(),
  nome: z.string().catch(""),
  host: z.string().catch(""),
  attivo: z.boolean(),
  prima: z.boolean().catch(true),
});
export type EsitoStato = z.infer<typeof EsitoStato>;

/** Sospende (`attivo: false`) o riattiva un apparato: resta in Zabbix con configurazione e storico. */
export async function cambiaStato(
  l: { base: URL; trasportoPost: TrasportoPost },
  c: { hostid: string; attivo: boolean; prova?: boolean },
): Promise<EsitoStato> {
  const corpo: Record<string, unknown> = { hostid: c.hostid, attivo: c.attivo };
  if (c.prova) corpo.prova = true;
  return posta(l, "/api/scrittura/v1/stato", corpo, EsitoStato);
}

export const EsitoTogli = z.object({
  esito: z.enum(["prova", "tolto"]),
  hostid: z.string(),
  nome: z.string().catch(""),
  host: z.string().catch(""),
});
export type EsitoTogli = z.infer<typeof EsitoTogli>;

/** Toglie un apparato da Zabbix: l'host e il suo storico si cancellano, non si torna indietro. */
export async function togliDaZabbix(
  l: { base: URL; trasportoPost: TrasportoPost },
  c: { hostid: string; prova?: boolean },
): Promise<EsitoTogli> {
  const corpo: Record<string, unknown> = { hostid: c.hostid };
  if (c.prova) corpo.prova = true;
  return posta(l, "/api/scrittura/v1/togli", corpo, EsitoTogli);
}

// ── Rinomina e proposta dei modelli (26/11/2026) ──

export const EsitoRinomina = z.object({
  esito: z.enum(["prova", "fatto", "uguale"]),
  hostid: z.string(),
  nome_prima: z.string().catch(""),
  nome: z.string().catch(""),
});
export type EsitoRinomina = z.infer<typeof EsitoRinomina>;

/** Cambia solo il nome mostrato in Zabbix: il nome che l'agente dichiara non si tocca. Il corpo porta sempre `prova`. */
export async function rinomina(
  l: { base: URL; trasportoPost: TrasportoPost },
  c: { hostid: string; nome: string; prova: boolean },
): Promise<EsitoRinomina> {
  return posta(l, "/api/scrittura/v1/rinomina", { hostid: c.hostid, nome: c.nome.trim(), prova: c.prova }, EsitoRinomina, true);
}

/** Un modello proposto dal centro: `pronto: false` si vede, col perché, ma non si può applicare. */
export const ModelloProposto = z.object({
  modello: z.string(),
  consigliato: z.boolean().catch(false),
  /** Mancando, vale «non pronto»: in dubbio non si applica. */
  pronto: z.boolean().catch(false),
  perche: z.string().catch(""),
});
export type ModelloProposto = z.infer<typeof ModelloProposto>;

export const EsitoProponi = z.object({
  hostid: z.string(),
  ora: z.array(z.string()).catch([]),
  proposti: z.array(ModelloProposto).catch([]),
  cambia: z.boolean().catch(false),
});
export type EsitoProponi = z.infer<typeof EsitoProponi>;

/** I modelli che il centro proporrebbe oggi per un apparato già in Zabbix. Non scrive niente. */
export async function proponiModelli(
  l: { base: URL; trasportoPost: TrasportoPost },
  o: OggettoDaMettere,
  hostid: string,
): Promise<EsitoProponi> {
  return posta(l, "/api/scrittura/v1/proponi", { ...corpoScrittura(o), hostid }, EsitoProponi, true);
}

/** I testi nostri per i codici che solo la scrittura può dare. */
export const TESTO_SCRITTURA: Readonly<Record<string, string>> = {
  api_spenta: "sul centro l'inserimento degli oggetti è spento",
  chiave_non_valida: "chiave di scrittura non valida o revocata",
  tetto_giornaliero: "il centro ha già accettato il massimo di oggetti per oggi: riprova domani",
  troppe_richieste: "troppe richieste al centro: aspetta qualche secondo",
  parametri: "il centro ha rifiutato i dati dell'oggetto",
  apparato_sconosciuto: "il centro non trova questo apparato fra quelli del cliente",
  senza_modelli: "un apparato deve restare con almeno un modello",
  modello_assente: "in Zabbix non c'è questo modello",
  zabbix_rifiuta: "Zabbix ha rifiutato il cambio",
  proxy_sconosciuto: "il centro non sa a quale indirizzo l'agente deve mandare i dati",
};
