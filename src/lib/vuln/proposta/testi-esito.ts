/**
 * Le parole dell'esito di un gruppo (tavola del Passo 5, oggetto 16). Funzione pura, senza database né
 * rete: la usa la pagina. Un esito nuovo di Edge qui non passa la compilazione: nessuno resta senza nome.
 */
import type { EsitoGruppoEdge } from "@/lib/vuln/gruppi-edge";

export type TonoStato = "ok" | "in_corso" | "avviso" | "spento" | "errore";

export interface ParolaEsito {
  parola: string;
  tono: TonoStato;
  testo: string;
  scan: number | null;
  /** `riprova`: si può rilanciare. `edge`: si guarda la sonda, rilanciare non aiuta. */
  azione: "riprova" | "edge" | null;
}

/** Il lancio ha uno stato in più di Edge: i gruppi che non si sono tentati. */
export type EsitoDaDire = EsitoGruppoEdge | { stato: "non_tentato"; messaggio: string };

export function parolaEsito(e: EsitoDaDire): ParolaEsito {
  switch (e.stato) {
    case "lanciato":
      return e.status === "pending"
        ? { parola: "● In coda", tono: "ok", testo: "Parte da solo quando finisce quello prima.", scan: e.scan_id, azione: null }
        : { parola: "▶ In corso", tono: "in_corso", testo: "Partito adesso.", scan: e.scan_id, azione: null };
    case "gia_in_corso":
      return { parola: "▲ Già in corso", tono: "avviso", testo: "Un gruppo con IP in comune è già partito: non si raddoppia.", scan: e.scan_id, azione: null };
    case "non_tentato":
      return { parola: "● Non tentato", tono: "spento", testo: "Fermato dal gruppo prima.", scan: null, azione: "riprova" };
    case "da_aggiornare":
      return { parola: "▲ Sonda da aggiornare", tono: "avviso", testo: "Questa sonda non sa ancora lanciare per gruppi. Nessuna scansione è partita sulla rete intera.", scan: null, azione: "edge" };
    case "rete_non_registrata":
      return { parola: "▲ Rete non registrata", tono: "avviso", testo: e.messaggio ?? "La rete non è ancora sulla sonda: si registra dal pannello VA Scan della rete.", scan: null, azione: "edge" };
    case "allineamento_fallito":
      return { parola: "✕ Allineamento fallito", tono: "errore", testo: e.messaggio, scan: null, azione: "riprova" };
    case "sonda_assente":
      return { parola: "✕ Nessuna sonda", tono: "errore", testo: e.messaggio, scan: null, azione: "edge" };
    case "rifiutato":
      return { parola: "✕ Rifiutato", tono: "errore", testo: e.messaggio, scan: null, azione: null };
    case "motore_non_disponibile":
      return { parola: "✕ Motore non disponibile", tono: "errore", testo: e.messaggio, scan: null, azione: "riprova" };
    case "non_partito":
      return { parola: "✕ Non partito", tono: "errore", testo: e.messaggio, scan: e.scan_id, azione: "riprova" };
    case "non_so":
      return { parola: "✕ Non so se è partito", tono: "errore", testo: `${e.messaggio} Da qui il lancio si è fermato.`, scan: null, azione: "edge" };
  }
}
