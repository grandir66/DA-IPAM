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
}

export interface OpzioniScrittura {
  /** Non scrive niente: dice solo cosa farebbe. */
  prova?: boolean;
  /** Entra anche se il centro lo direbbe fuori perimetro. */
  forza?: boolean;
  /** Dove l'agente manda i dati; senza, lo ricava il centro. */
  serverActive?: string | null;
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
  if (op.prova) corpo.prova = true;
  if (op.forza) corpo.forza = true;
  if (op.serverActive && op.serverActive.trim()) corpo.server_active = op.serverActive.trim();
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
  const radice = l.base.pathname.replace(/\/+$/, "");
  const r = await l.trasportoPost(`${radice}${PERCORSO_SCRITTURA}`, corpoScrittura(o, op));
  let corpo: unknown = null;
  try {
    corpo = r.body ? JSON.parse(r.body) : null;
  } catch {
    corpo = null;
  }
  if (r.status !== 200) {
    const e = ErroreApi.safeParse(corpo);
    const codice = e.success ? e.data.codice : undefined;
    const testo =
      (codice && TESTO_SCRITTURA[codice]) ??
      (codice && TESTO_CODICE_ERRORE[codice]) ??
      `il centro ha rifiutato l'inserimento (HTTP ${r.status})`;
    throw new ErroreLettura("http", testo, { status: r.status, codice });
  }
  const p = EsitoScrittura.safeParse(corpo);
  if (!p.success) throw new ErroreLettura("risposta", "risposta del centro di forma inattesa (scrittura)");
  return p.data;
}

/** I testi nostri per i codici che solo la scrittura può dare. */
export const TESTO_SCRITTURA: Readonly<Record<string, string>> = {
  api_spenta: "sul centro l'inserimento degli oggetti è spento",
  chiave_non_valida: "chiave di scrittura non valida o revocata",
  tetto_giornaliero: "il centro ha già accettato il massimo di oggetti per oggi: riprova domani",
  troppe_richieste: "troppe richieste al centro: aspetta qualche secondo",
  parametri: "il centro ha rifiutato i dati dell'oggetto",
};
