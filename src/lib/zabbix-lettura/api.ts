/**
 * Le risposte dell'API di lettura per cliente di DA-Zabbix (§3 del design in
 * DA-Zabbix, `docs/2026-10-16-api-lettura-per-cliente-design.md`), validate con Zod.
 *
 * Lettura prudente: un campo che manca o ha un valore inatteso diventa la cosa
 * meno rassicurante («non so», «non affidabile», «vecchio»), mai un «sì». Il §3
 * non fissa la forma esatta della rotta `cliente` oltre ai nomi dei campi: il
 * proxy si accetta come oggetto o come elenco.
 *
 * Pura e senza import lato server: la usano il client, il servizio e le prove.
 */
import { z } from "zod";

/**
 * Le rotte della v1, una per una: nessun prefisso libero. `famiglie` e `storico` sono
 * del 13/11/2026, per la pagina DATIA MONITORING della vista cliente.
 */
export const ROTTE_LETTURA = ["cliente", "host", "problemi", "valori", "famiglie", "storico"] as const;
export type RottaLettura = (typeof ROTTE_LETTURA)[number];

/** Le sette chiavi ammesse dall'API (`CHIAVI_LETTURA` lato DA-Zabbix): niente altro in v1. */
export const CHIAVI_MISURE = [
  "icmpping",
  "icmppingloss",
  "icmppingsec",
  "agent.ping",
  "system.uptime",
  "system.cpu.util",
  "vm.memory.utilization",
] as const;
export type ChiaveMisura = (typeof CHIAVI_MISURE)[number];

/** Massimi dell'API (§3): host per pagina e hostid per richiesta di valori. */
export const LIMITE_HOST_PAGINA = 500;
export const MAX_HOSTID_VALORI = 50;

const Disponibilita = z.enum(["si", "no", "non_so"]).catch("non_so");
export type ValoreDisponibilita = z.infer<typeof Disponibilita>;

/** Testa comune a ogni risposta 200 (§3). `codcli` obbligatorio: è il controllo «cliente errato». */
const Testa = z.object({
  codcli: z.string(),
  cliente: z.string().catch(""),
  letto_alle: z.string().nullable().optional().catch(null),
  eta_s: z.number().nonnegative().catch(0),
  /** Assente o strano = vecchio: mai dati freschi per default. */
  vecchio: z.boolean().catch(true),
});

const ProxyCentro = z.object({
  nome: z.string(),
  in_linea: z.boolean().catch(false),
  ultimo_contatto: z.string().nullable().optional().catch(null),
});
export type ProxyDelCentro = z.infer<typeof ProxyCentro>;

export const RispostaCliente = Testa.extend({
  proxy: z
    .union([ProxyCentro, z.array(ProxyCentro)])
    .nullable()
    .optional()
    .transform((p) => (p == null ? [] : Array.isArray(p) ? p : [p])),
}).passthrough();
export type RispostaCliente = z.infer<typeof RispostaCliente>;

export const HostDelCentro = z.object({
  hostid: z.string().regex(/^\d{1,20}$/),
  nome: z.string().catch(""),
  host: z.string().catch(""),
  ip: z.array(z.string()).catch([]),
  ip_condiviso: z.boolean().catch(false),
  proxy: z.string().nullable().optional().catch(null),
  tipologia: z.string().nullable().optional().catch(null),
  importanza: z.string().nullable().optional().catch(null),
  disponibilita: z
    .object({
      complessiva: Disponibilita,
      interfacce: z.array(z.object({ tipo: z.string().catch("?"), stato: Disponibilita })).catch([]),
    })
    .catch({ complessiva: "non_so", interfacce: [] }),
  /** Assente = non affidabile: un «sì» del proxy fermo è la fotografia di prima (§6). */
  dati_affidabili: z.boolean().catch(false),
});
export type HostDelCentro = z.infer<typeof HostDelCentro>;

export const RispostaHost = Testa.extend({
  host: z.array(HostDelCentro),
  successivo: z.string().nullable().catch(null),
});
export type RispostaHost = z.infer<typeof RispostaHost>;

export const ProblemaDelCentro = z.object({
  eventid: z.string(),
  hostid: z.string(),
  nome: z.string().catch(""),
  gravita: z.number().int().min(0).max(5).catch(0),
  dal: z.string().nullable().optional().catch(null),
  preso_in_carico: z.boolean().catch(false),
});
export type ProblemaDelCentro = z.infer<typeof ProblemaDelCentro>;

export const RispostaProblemi = Testa.extend({
  problemi: z.array(ProblemaDelCentro),
  troncati: z.number().int().nonnegative().catch(0),
});
export type RispostaProblemi = z.infer<typeof RispostaProblemi>;

export const ValoreDelCentro = z.object({
  hostid: z.string(),
  chiave: z.string(),
  valore: z.union([z.number(), z.string()]).nullable().catch(null),
  unita: z.string().catch(""),
  clock: z.string().nullable().optional().catch(null),
  /** Assente = vecchio. */
  vecchio: z.boolean().catch(true),
});
export type ValoreDelCentro = z.infer<typeof ValoreDelCentro>;

export const RispostaValori = Testa.extend({
  valori: z.array(ValoreDelCentro),
  sconosciuti: z.array(z.string()).catch([]),
});
export type RispostaValori = z.infer<typeof RispostaValori>;

/**
 * Una misura di un oggetto, già riassunta dal centro per la sua famiglia: «3 porte su 4»,
 * «disco più pieno 93% (D:)». `valore` è un numero o uno stato di un elenco chiuso.
 */
export const MisuraDelCentro = z.object({
  codice: z.string(),
  etichetta: z.string().catch(""),
  valore: z.union([z.number(), z.string()]).nullable().catch(null),
  unita: z.string().catch(""),
  totale: z.number().optional().catch(undefined),
  dettaglio: z.string().optional().catch(undefined),
  quanti: z.number().optional().catch(undefined),
  /** Assente = vecchio. */
  vecchio: z.boolean().catch(true),
});
export type MisuraDelCentro = z.infer<typeof MisuraDelCentro>;

export const OggettoDiFamiglia = z.object({
  hostid: z.string().regex(/^\d{1,20}$/),
  nome: z.string().catch(""),
  famiglia: z.string().catch("altro"),
  disponibilita: Disponibilita,
  /** Assente = non affidabile, come per gli host. */
  dati_affidabili: z.boolean().catch(false),
  ping: Disponibilita,
  misure_configurate: z.number().int().nonnegative().catch(0),
  misure_vive: z.number().int().nonnegative().catch(0),
  misure: z.array(MisuraDelCentro).catch([]),
});
export type OggettoDiFamiglia = z.infer<typeof OggettoDiFamiglia>;

export const RispostaFamiglie = Testa.extend({
  famiglie: z.array(z.object({ codice: z.string(), etichetta: z.string() })),
  host: z.array(OggettoDiFamiglia),
  tronca: z.boolean().catch(false),
});
export type RispostaFamiglie = z.infer<typeof RispostaFamiglie>;

const GiorniDiMinuti = z.record(z.string(), z.array(z.number().nonnegative()));

export const RispostaStorico = Testa.extend({
  /** 30 date UTC (YYYY-MM-DD), dalla più vecchia a oggi. */
  giorni: z.array(z.string()),
  famiglie: z.record(z.string(), z.array(z.number().nullable())),
  minuti: GiorniDiMinuti,
  /** Minuti con un problema di disponibilità: la barra «era fermo». */
  minuti_fermo: GiorniDiMinuti,
  /** 60 date UTC (13/11/2026): i conti per apparato coprono anche il mese prima. Assente su un centro vecchio. */
  giorni_lunghi: z.array(z.string()).catch([]),
  /** Per apparato, 60 voci per serie. Un apparato senza eventi non c'è: vale zero. */
  per_host: z
    .record(
      z.string(),
      z.object({
        fermo: z.array(z.number().nonnegative()).catch([]),
        minuti: z.array(z.number().nonnegative()).catch([]),
        aperti: z.array(z.number().nonnegative()).catch([]),
        gravi: z.array(z.number().nonnegative()).catch([]),
        chiusi: z.array(z.number().nonnegative()).catch([]),
        durata_chiusi: z.array(z.number().nonnegative()).catch([]),
      }),
    )
    .catch({}),
  tronca: z.boolean().catch(false),
});
export type RispostaStorico = z.infer<typeof RispostaStorico>;

/** Corpo d'errore dell'API (§3): `{"errore": "...", "codice": "..."}`. */
export const ErroreApi = z.object({
  errore: z.string().optional(),
  codice: z.string().optional(),
});

/**
 * Il testo che mostriamo per ogni codice d'errore dell'API. Nostro, non quello
 * del server: il testo del centro non finisce a schermo così com'è.
 */
export const TESTO_CODICE_ERRORE: Readonly<Record<string, string>> = {
  parametri: "richiesta rifiutata dal centro (parametri)",
  chiave_non_valida: "chiave di lettura non valida o revocata",
  cliente_diverso: "il centro rifiuta il codice cliente della richiesta",
  cliente_sconosciuto: "il centro non trova più il cliente di questa chiave",
  cliente_ambiguo: "più clienti col codice di questa chiave nella procedura del centro",
  troppe_richieste: "troppe richieste al centro: attesa prima del prossimo tentativo",
  zabbix_non_risponde: "Zabbix del centro non risponde e non ci sono letture recenti",
  api_spenta: "l'API di lettura è spenta sul centro",
};
