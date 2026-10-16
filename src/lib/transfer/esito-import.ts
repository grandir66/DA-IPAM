/**
 * Esito delle conversioni dell'import come righe per la pagina di
 * trasferimento (revisione della 2c, 16/10).
 *
 * Dalla 2c l'import rilancia le conversioni (per ora la normalizzazione dei
 * tipi delle credenziali) e ne mette l'esito in `ImportResult.conversioni`,
 * col segno scritto in `tenant_settings`. Prima la pagina mostrava solo i
 * conteggi delle righe: un `parziale:` o una voce divisa dopo un'unione non li
 * vedeva nessuno.
 *
 * Modulo puro: lo usa la pagina (client).
 */

export interface RigaConversione {
  testo: string;
  /** Parziale, errore o esito sconosciuto: la pagina lo evidenzia. */
  daControllare: boolean;
}

const NOMI: Readonly<Record<string, string>> = {
  credenziali_t2_tipi: "Tipi delle credenziali",
};

/** Tutti i conteggi del segno (`chiave=numero`) a zero: niente è cambiato. */
function tuttoAZero(segno: string): boolean {
  const conteggi = [...segno.matchAll(/=(\d+)/g)].map((m) => Number(m[1]));
  return conteggi.length > 0 && conteggi.every((n) => n === 0);
}

export function righeConversioni(conversioni: Readonly<Record<string, { segno: string; dettaglio: string }>> | null | undefined): RigaConversione[] {
  if (!conversioni) return [];
  return Object.entries(conversioni).map(([chiave, { segno, dettaglio }]) => {
    const nome = NOMI[chiave] ?? chiave;
    if (segno.startsWith("done:")) {
      return tuttoAZero(segno)
        ? { testo: `${nome}: niente da convertire`, daControllare: false }
        : { testo: `${nome} convertiti: ${dettaglio}`, daControllare: false };
    }
    if (segno.startsWith("parziale:")) return { testo: `${nome}, conversione parziale: ${dettaglio}`, daControllare: true };
    if (segno.startsWith("errore:")) {
      return {
        testo: `${nome}: ${dettaglio} (${segno.slice("errore:".length)}). Si riprova alla prossima apertura del tenant.`,
        daControllare: true,
      };
    }
    return { testo: `${nome}: esito non riconosciuto («${segno}»): ${dettaglio}`, daControllare: true };
  });
}
