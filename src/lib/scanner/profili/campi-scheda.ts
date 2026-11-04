/**
 * Dai rilievi salvati (`host_profilo_rilievi`) alla tabella della scheda.
 *
 * Riccardo, 04/11/2026: «devono essere riportati in tabella i rilievi — i campi
 * significativi». Quindi **non** il dump di `elems_json`: si riusa
 * `fattiDaScript`, la stessa lettura che riempie le colonne dell'host, e si
 * mostra una riga per campo. Cosi' la tabella e la scrittura non possono
 * divergere: se un giorno uno script legge un campo in piu', compare in
 * entrambe.
 *
 * Modulo **puro**: nessun database, nessuna rete. Si prova con righe finte.
 */
import { fattiDaScript, pesoScript } from "./lettura";
import type { FattiProfilo, ProfiloScansione } from "./tipi";

/** Una riga di `host_profilo_rilievi` come la legge la rotta. */
export interface RigaRilievo {
  profilo: ProfiloScansione["id"] | string;
  porta: number | null;
  protocollo: "tcp" | "udp" | null;
  script: string;
  elems: Record<string, string>;
  output: string | null;
  at: string;
}

/** Chi ha detto quel valore: uno script, su una porta, in un dato giro. */
export interface FonteCampo {
  script: string;
  porta: number | null;
  protocollo: "tcp" | "udp" | null;
  profilo: string;
  at: string;
}

export interface VoceCampo {
  campo: keyof FattiProfilo;
  etichetta: string;
  valore: string;
  /** Ordinate per affidabilita' dello script: la prima e' quella che ha vinto nella scrittura. */
  fonti: FonteCampo[];
}

export interface TabellaRilievi {
  campi: VoceCampo[];
  /** Script che hanno risposto senza dare nessun campo significativo: si dicono, non si nascondono. */
  senzaCampi: FonteCampo[];
  /** Quante righe di rilievo ci sono in tutto, e quando e' stata raccolta l'ultima. */
  totale: number;
  ultimoAt: string | null;
}

/** La risposta di GET /api/hosts/[id]/profilo-rilievi: la tabella piu' i profili che l'hanno prodotta. */
export interface RispostaRilieviProfilo extends TabellaRilievi {
  profili: string[];
}

/**
 * Etichette e ordine delle righe: prima l'identita' dell'apparato (seriale,
 * modello, firmware), poi chi e' e che sistema ha, poi il resto. L'ordine delle
 * chiavi di questo oggetto E' l'ordine della tabella.
 */
const ETICHETTE: Record<keyof FattiProfilo, string> = {
  seriale: "Seriale",
  modello: "Modello",
  firmware: "Firmware",
  produttore: "Produttore",
  osInfo: "Sistema operativo",
  protocolloOt: "Protocollo OT",
  hostname: "Nome host",
  dominio: "Dominio",
  netbios: "Nome NetBIOS",
  titoloWeb: "Titolo pagina web",
  chiaviSsh: "Impronta chiave SSH",
};

const ORDINE = Object.keys(ETICHETTE) as Array<keyof FattiProfilo>;

/** Un valore vale come lo stesso valore a meno di spazi e maiuscole. */
const chiaveValore = (v: string): string => v.trim().toLowerCase().replace(/\s+/g, " ");

export function campiDaRilievi(righe: readonly RigaRilievo[]): TabellaRilievi {
  /* campo -> valore normalizzato -> voce. Due mappe annidate invece di una
   * chiave composta: il valore puo' contenere qualunque carattere. */
  const per = new Map<keyof FattiProfilo, Map<string, VoceCampo>>();
  const senzaCampi: FonteCampo[] = [];
  let ultimoAt: string | null = null;

  for (const r of righe) {
    if (!ultimoAt || r.at > ultimoAt) ultimoAt = r.at;
    const fonte: FonteCampo = { script: r.script, porta: r.porta, protocollo: r.protocollo, profilo: r.profilo, at: r.at };
    const fatti = fattiDaScript({ id: r.script, output: r.output, elems: r.elems ?? {} });
    let trovato = false;
    for (const campo of ORDINE) {
      const v = fatti[campo];
      if (v === undefined) continue;
      /* `chiaviSsh` e' una lista: una riga per impronta. */
      const valori = Array.isArray(v) ? v : [v];
      for (const valore of valori) {
        const pulito = String(valore).trim();
        if (!pulito) continue;
        trovato = true;
        const perCampo = per.get(campo) ?? new Map<string, VoceCampo>();
        per.set(campo, perCampo);
        const k = chiaveValore(pulito);
        const esistente = perCampo.get(k);
        if (esistente) esistente.fonti.push(fonte);
        else perCampo.set(k, { campo, etichetta: ETICHETTE[campo], valore: pulito, fonti: [fonte] });
      }
    }
    if (!trovato) senzaCampi.push(fonte);
  }

  const campi: VoceCampo[] = [];
  for (const campo of ORDINE) {
    const perCampo = per.get(campo);
    if (!perCampo) continue;
    const voci = [...perCampo.values()];
    for (const v of voci) v.fonti.sort((a, b) => pesoScript(a.script) - pesoScript(b.script) || a.script.localeCompare(b.script));
    /* Piu' valori per lo stesso campo (due certificati con CN diversi): prima
     * quello dello script piu' affidabile, cioe' quello che ha vinto. */
    voci.sort((a, b) => pesoScript(a.fonti[0].script) - pesoScript(b.fonti[0].script) || a.valore.localeCompare(b.valore));
    campi.push(...voci);
  }

  senzaCampi.sort((a, b) => a.script.localeCompare(b.script) || (a.porta ?? 0) - (b.porta ?? 0));
  return { campi, senzaCampi, totale: righe.length, ultimoAt };
}
