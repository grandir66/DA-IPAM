/**
 * La pagina Opzioni (spec 2026-10-22-pagina-opzioni-design §3.1): ogni funzione che si accende o si spegne, dichiarata
 * una volta. Il catalogo (`catalogo.ts`) non riscrive la logica delle funzioni: chiama le letture e le scritture che
 * esistono già. Modulo senza dipendenze: lo importano anche i componenti client (solo i tipi).
 */

export type Gruppo = "letture" | "job" | "moduli" | "automatismi" | "parametri" | "notifiche_uscite" | "da_file";
/**
 * `levetta` sì/no · `modulo` installa/disinstalla · `scelta` un valore fra pochi · `file` si legge e basta.
 * I parametri (gruppo `parametri`, tavola oggetti 14-19): `numero` un numero con unità e limiti · `elenco` più valori
 * (con `scelte`: caselle; senza: uno per riga) · `testo` una riga · `fisso` un valore che da qui non si cambia (lucchetto).
 */
export type Forma = "levetta" | "modulo" | "scelta" | "file" | "numero" | "elenco" | "testo" | "fisso";

/** Le forme dei parametri: hanno un valore, non uno stato acceso/spento. */
export const FORME_PARAMETRO: ReadonlySet<Forma> = new Set<Forma>(["numero", "elenco", "testo", "fisso"]);

/** Un parametro: dove sta nella pagina e come si scrive il suo valore. */
export interface Parametro {
  /** Il sottotitolo nel gruppo («Scansione veloce delle reti»). */
  sezione: string;
  unita?: string;
  min?: number;
  max?: number;
}
export type TipoEsito = "ok" | "attenzione" | "errore" | "neutro";

export interface Scelta {
  valore: string;
  etichetta: string;
}

export interface StatoOpzione {
  /** null = da configurare (manca il dato che la fa funzionare). */
  acceso: boolean | null;
  /** Forma «scelta», e il ritmo dei job. */
  valore?: string;
  /** Chi l'ha cambiata e quando (UTC del DB); null = di serie. */
  da: string | null;
  il: string | null;
  /** Solo i parametri: il valore non è quello di serie (si offre «Torna a …»). */
  cambiato?: boolean;
  /** «letta alle 15:00 · 19 VLAN», «mai girata: nessun hypervisor con credenziale». */
  esito: { tipo: TipoEsito; testo: string };
}

export interface RichiestaCambio {
  acceso?: boolean;
  valore?: string;
  /** Un parametro torna al valore di serie. */
  diSerie?: true;
}

export interface Opzione {
  /** Stabile: è l'ancora della pagina (`/settings/opzioni#<id>`) e il bersaglio dei rimandi. */
  id: string;
  gruppo: Gruppo;
  nome: string;
  cosa: string;
  /** hub = vale per tutti i clienti dell'appliance. */
  valePer: "cliente" | "hub";
  forma: Forma;
  diSerie: string;
  /** Le scelte della forma «scelta», o il ritmo di un job. */
  scelte?: ReadonlyArray<Scelta>;
  /** Dove si inseriscono i dati («Configura ›», «Installa ›»): resta nella scheda della funzione. */
  configura?: { href: string; etichetta: string };
  /** Solo i parametri. */
  parametro?: Parametro;
  /** Il dialogo di spegnimento (oggetto 10 della tavola). */
  spegnendo?: { siFerma: string; resta: string };
  /** Se c'è, anche accendere chiede conferma con questo testo (la pulizia degli host cancella righe). */
  accendendo?: string;
  /** Le voci da file: dove si cambiano (oggetto 12). */
  dove?: string;
  /** Il cambio tocca i job: la rotta ricarica lo scheduler del cliente. */
  tocchiJob?: boolean;
  leggi(): StatoOpzione | Promise<StatoOpzione>;
  /** Assente per le voci che da qui non si cambiano (forma «file», moduli che si accendono solo configurandoli). */
  cambia?(richiesta: RichiestaCambio, chi: string): void | Promise<void>;
}

/** Un cambio rifiutato per un motivo da dire a chi l'ha chiesto (la rotta risponde con `status`). */
export class ErroreOpzione extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 = 409,
  ) {
    super(message);
    this.name = "ErroreOpzione";
  }
}

/** Una voce del censimento che NON sta nel catalogo, col perché (spec §3.6). */
export interface FuoriCatalogo {
  chiave: string;
  motivo: string;
}

/** La riga della pagina e della rotta GET: l'opzione senza le funzioni, più il suo stato. */
export interface VoceOpzione {
  id: string;
  gruppo: Gruppo;
  nome: string;
  cosa: string;
  valePer: "cliente" | "hub";
  forma: Forma;
  diSerie: string;
  scelte?: ReadonlyArray<Scelta>;
  configura?: { href: string; etichetta: string };
  parametro?: Parametro;
  spegnendo?: { siFerma: string; resta: string };
  accendendo?: string;
  dove?: string;
  /** Si cambia da Opzioni (c'è `cambia`). */
  cambiabile: boolean;
  stato: StatoOpzione;
}

export const TITOLI_GRUPPI: Record<Gruppo, { titolo: string; nota: string }> = {
  letture: { titolo: "Letture degli apparati", nota: "sola lettura, al più una volta l'ora per apparato" },
  job: { titolo: "Job pianificati", nota: "i quattro di serie nascono da soli; se un admin li spegne restano spenti" },
  moduli: { titolo: "Moduli", nota: "si installano qui; i dati da inserire restano nella loro scheda" },
  automatismi: { titolo: "Automatismi", nota: "" },
  parametri: { titolo: "Parametri e soglie", nota: "numeri e scelte che regolano le funzioni; dati, indirizzi e password restano nelle loro schede" },
  notifiche_uscite: { titolo: "Notifiche e uscite", nota: "" },
  da_file: { titolo: "Da file dell'appliance", nota: "si leggono qui, si cambiano solo sul server" },
};

export const ORDINE_GRUPPI: readonly Gruppo[] = ["letture", "job", "moduli", "automatismi", "parametri", "notifiche_uscite", "da_file"];
