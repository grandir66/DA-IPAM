/**
 * Un giro d'invio del segnale di vita verso DA-Link (tappa C1, spec §5.2, §5.3, §7.2).
 *
 * 1. Configurazione: assente → non parte niente e non si scrive niente (freno). Non
 *    valida → non parte niente, l'esito si salva perché la pagina lo mostri.
 * 2. Livello dall'hub; i numeri dell'inventario si leggono solo a «stato + inventario»
 *    e solo se il cliente esiste in questa istanza.
 * 3. POST con l'impronta verificata prima di inviare il token.
 * 4. Dalla risposta si tengono SOLO due date, per mostrarle: nessuna risposta di
 *    DA-Link cambia il livello o la configurazione (spec §5.3, §9.5, decisione 22).
 *
 * Gli esiti si dicono con parole nostre: mai token, indirizzi o testo di DA-Link.
 * Il registro di diagnostica scrive una riga solo quando l'esito cambia.
 */
import { leggiConfigDalink, type ConfigDalink } from "./config";
import { fattiIstanza, inventarioCliente } from "./fatti";
import { costruisciSegnale, type FattiIstanza, type Inventario } from "./segnale";
import { livelloAttuale, salvaEsitoSegnale, statoSegnale, type EsitoSegnale, type Livello, type StatoSegnale } from "./stato";
import { ErroreDalink, postSegnale, type RispostaDalink } from "./trasporto";

export interface EsitoGiro {
  esito: EsitoSegnale | "non_configurato";
  dettaglio: string;
}

export interface DipendenzeGiro {
  config: () => ConfigDalink;
  livello: () => Livello | null;
  statoPrecedente: () => StatoSegnale | null;
  fatti: (codcli: string, ultimoErrore: string | null) => Promise<{ fatti: FattiIstanza; clienteTrovato: boolean }>;
  inventario: (codcli: string) => Inventario | null;
  trasporto: (url: URL, impronta: string, token: string, corpo: string) => Promise<RispostaDalink>;
  ora: () => Date;
}

const dipendenzeReali: DipendenzeGiro = {
  config: () => leggiConfigDalink(),
  livello: () => livelloAttuale()?.livello ?? null,
  statoPrecedente: () => statoSegnale(),
  fatti: (codcli, ultimoErrore) => fattiIstanza(codcli, ultimoErrore),
  inventario: (codcli) => inventarioCliente(codcli),
  trasporto: (url, impronta, token, corpo) => postSegnale(url, impronta, token, corpo),
  ora: () => new Date(),
};

const DATA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** Le due date della risposta di DA-Link, se nella forma attesa. Tutto il resto si ignora. */
export function leggiRisposta(body: string): { ricevuto_il: string | null; inventario_cancellato_il: string | null } {
  let dati: unknown;
  try {
    dati = JSON.parse(body);
  } catch {
    dati = null;
  }
  const o = dati && typeof dati === "object" && !Array.isArray(dati) ? (dati as Record<string, unknown>) : {};
  const data = (v: unknown): string | null => (typeof v === "string" && DATA.test(v) ? v : null);
  return { ricevuto_il: data(o.ricevuto_il), inventario_cancellato_il: data(o.inventario_cancellato_il) };
}

function esitoHttp(status: number): EsitoGiro {
  if (status === 401) return { esito: "rifiutato", dettaglio: "DA-Link ha rifiutato il token (401): serve un token nuovo emesso da DA-Link" };
  if (status === 403) {
    return { esito: "rifiutato", dettaglio: "DA-Link dice che codice cliente o nodo non corrispondono al token (403)" };
  }
  if (status === 422) return { esito: "rifiutato", dettaglio: "DA-Link ha rifiutato il segnale come malformato (422)" };
  if (status >= 400 && status < 500) return { esito: "rifiutato", dettaglio: `DA-Link ha rifiutato il segnale (${status})` };
  return { esito: "errore", dettaglio: `DA-Link ha risposto con un errore (${status})` };
}

function registraSeCambia(prima: StatoSegnale | null, ora: EsitoGiro): void {
  if (prima?.esito === ora.esito && prima?.dettaglio === ora.dettaglio) return;
  const riga = `[dalink] segnale di vita: ${ora.esito} — ${ora.dettaglio}`;
  if (ora.esito === "ok") console.warn(riga);
  else console.error(riga);
}

export async function giroSegnale(dip: Partial<DipendenzeGiro> = {}): Promise<EsitoGiro> {
  const d: DipendenzeGiro = { ...dipendenzeReali, ...dip };
  const cfg = d.config();
  if (cfg.stato === "assente") return { esito: "non_configurato", dettaglio: "nessuna configurazione DA-Link su questa istanza" };

  const prima = d.statoPrecedente();
  const tentato = d.ora();
  const livello = d.livello();
  const chiudi = (e: EsitoGiro, risposta?: { ricevuto_il: string | null; inventario_cancellato_il: string | null }) => {
    salvaEsitoSegnale({
      tentato_il: tentato,
      esito: e.esito as EsitoSegnale,
      dettaglio: e.dettaglio,
      livello,
      risposta,
    });
    registraSeCambia(prima, e);
    return e;
  };

  if (cfg.stato === "non_valida") return chiudi({ esito: "configurazione_non_valida", dettaglio: cfg.motivo });

  const ultimoErrore = prima?.esito && prima.esito !== "ok" && prima.dettaglio ? `segnale precedente: ${prima.dettaglio}` : null;

  let corpo: string;
  try {
    const { fatti, clienteTrovato } = await d.fatti(cfg.codcli, ultimoErrore);
    const segnale = costruisciSegnale(cfg, livello, fatti, () => (clienteTrovato ? d.inventario(cfg.codcli) : null));
    corpo = JSON.stringify(segnale);
  } catch {
    return chiudi({ esito: "errore", dettaglio: "errore nella raccolta dei dati dell'istanza: segnale non inviato" });
  }

  let r: RispostaDalink;
  try {
    r = await d.trasporto(cfg.url, cfg.impronta, cfg.token, corpo);
  } catch (e) {
    const dettaglio = e instanceof ErroreDalink ? e.message : "errore imprevisto nell'invio a DA-Link";
    return chiudi({ esito: "errore", dettaglio });
  }

  if (r.status !== 200) return chiudi(esitoHttp(r.status));
  const risposta = leggiRisposta(r.body);
  return chiudi({ esito: "ok", dettaglio: "segnale ricevuto da DA-Link" }, risposta);
}
