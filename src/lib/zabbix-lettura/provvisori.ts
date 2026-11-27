/**
 * Gli apparati appena scritti in Zabbix che la lettura del centro non mostra ancora (26/11/2026).
 *
 * Dopo un'aggiunta le righe uscivano da «Da aggiungere» e non comparivano «In monitoraggio» finché non
 * scadevano le memorie delle letture (circa due minuti): per un po' l'apparato spariva. Qui chi li ha scritti
 * li tiene com'erano, con uno stato provvisorio DICHIARATO, fino alla prima lettura che li contiene.
 * Niente dati inventati: la riga è quella che l'utente aveva davanti, col solo stato cambiato e un testo.
 */
import type { ApparatoElenco } from "./apparati";

export const TESTO_PROVVISORIO = "aggiunto ora: il centro lo mostra tra poco";

/** Chi è stato scritto: la riga com'era prima della scrittura. */
export type Provvisori = ReadonlyMap<string, ApparatoElenco>;

/** La lettura contiene l'apparato quando c'è una riga già in Zabbix con lo stesso IP o lo stesso nome. */
function contenuto(p: ApparatoElenco, letti: readonly ApparatoElenco[]): boolean {
  const nome = p.nome.toLowerCase();
  return letti.some((a) => a.hostid !== null && ((p.ip !== null && a.ip === p.ip) || a.nome.toLowerCase() === nome || (a.hostTecnico ?? "").toLowerCase() === nome));
}

/**
 * L'elenco da mostrare e le chiavi dei provvisori ormai superati (da togliere dalla memoria della pagina).
 * - la riga è ancora «da aggiungere»: resta lì, col segno provvisorio, e non si può aggiungere due volte;
 * - la riga non c'è più ma la lettura non ha ancora il suo apparato: si rimette com'era, col segno;
 * - la lettura ha l'apparato in Zabbix: il provvisorio ha finito.
 */
export function conProvvisori(letti: readonly ApparatoElenco[], provvisori: Provvisori): { elenco: ApparatoElenco[]; superati: string[] } {
  const superati: string[] = [];
  const elenco = [...letti];
  for (const [chiave, p] of provvisori) {
    if (contenuto(p, letti)) {
      superati.push(chiave);
      continue;
    }
    const i = elenco.findIndex((a) => a.chiave === chiave);
    const riga: ApparatoElenco = { ...(i >= 0 ? elenco[i]! : p), provvisorio: TESTO_PROVVISORIO };
    if (i >= 0) elenco[i] = riga;
    else elenco.push(riga);
  }
  return { elenco, superati };
}

/** Il testo con cui la scrittura dice «rotta assente sul centro»: qui perché lo legge anche la pagina. */
export const TESTO_CENTRO_VECCHIO = "Il centro non è ancora aggiornato";
