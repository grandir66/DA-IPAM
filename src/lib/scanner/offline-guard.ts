/**
 * Soglia di sicurezza sul passaggio a offline di fine giro (T3-21, INV-2).
 *
 * PERCHE' ESISTE: un giro che non vede nessuno (ping che non esce, un apparato
 * in mezzo che filtra, un esecutore remoto che risponde male) mandava offline in
 * un colpo tutti gli host della rete, e la rete risultava spenta finché un giro
 * buono non la rivedeva. Un calo così grande è più spesso un guasto della
 * scansione che della rete.
 *
 * REGOLA: se un giro spegnerebbe più di `pct`% degli host attivi fra gli IP
 * scansionati, e almeno `min` host, in modo `applica` non scrive e lascia i
 * candidati «in sospeso»; il giro dopo manda offline solo i candidati che lo
 * erano anche nel giro prima (intersezione). Gli altri restano in sospeso per il
 * giro successivo. Un calo vero arriva così con un giro di ritardo; la guardia
 * non resta bloccata per sempre, perché ogni host fermo davvero è candidato in
 * due giri di fila. Un calo sotto soglia si applica subito.
 *
 * In modo `registra` (predefinito) si applica come prima e si scrive «qui avrei
 * bloccato X»: il freno si toglie contando quelle righe, non a sensazione.
 *
 * I candidati in sospeso stanno in `tenant_settings`, una chiave per rete: un
 * riavvio per aggiornamento non azzera la conferma. Un giro decide solo dentro
 * il suo perimetro, cioè gli host di cui ha scansionato l'IP: i sospesi fuori
 * restano come sono. Senza questo un giro mirato (host selezionati, oppure IP
 * esclusi perché il ping non ha potuto girare) cancellava la conferma di tutta
 * la rete, e con un giro mirato fra due giri completi la guardia non
 * confermava mai niente (revisione 3b).
 *
 * La decisione (`decidiPassaggioOffline`) è pura; `passaggioOfflineConSoglia`
 * legge impostazioni e candidati dal DB del tenant corrente e scrive.
 */
import {
  contaHostAttiviScansionati,
  getCurrentTenantCode,
  idHostScansionati,
  getTenantSetting,
  markHostsOffline,
  selectOfflineCandidates,
  setTenantSetting,
} from "@/lib/db-tenant";

export type ModoSogliaOffline = "registra" | "applica";

export interface ImpostazioniSogliaOffline {
  modo: ModoSogliaOffline;
  /** Percentuale degli host attivi oltre la quale il giro non scrive (strettamente maggiore). */
  pct: number;
  /** Numero minimo di candidati perché la soglia scatti. */
  min: number;
}

export const CHIAVE_MODO = "offline_guard_mode";
export const CHIAVE_PCT = "offline_guard_pct";
export const CHIAVE_MIN = "offline_guard_min";
const PREFISSO_IN_SOSPESO = "offline_guard_pending:";

export const IMPOSTAZIONI_PREDEFINITE: ImpostazioniSogliaOffline = { modo: "registra", pct: 50, min: 5 };

export function chiaveInSospeso(networkId: number): string {
  return `${PREFISSO_IN_SOSPESO}${networkId}`;
}

function intero(valore: string | null | undefined, minimo: number, massimo: number): number | null {
  if (valore == null || !/^\s*\d+\s*$/.test(valore)) return null;
  const n = Number.parseInt(valore, 10);
  return n >= minimo && n <= massimo ? n : null;
}

/**
 * Impostazioni del tenant. Un valore assente o fuori forma vale il predefinito
 * (il predefinito del modo è `registra`, cioè il comportamento di prima).
 */
export function impostazioniDa(leggi: (chiave: string) => string | null): ImpostazioniSogliaOffline {
  const modo = leggi(CHIAVE_MODO)?.trim();
  return {
    modo: modo === "applica" ? "applica" : "registra",
    pct: intero(leggi(CHIAVE_PCT), 1, 100) ?? IMPOSTAZIONI_PREDEFINITE.pct,
    min: intero(leggi(CHIAVE_MIN), 1, 100_000) ?? IMPOSTAZIONI_PREDEFINITE.min,
  };
}

export interface IngressoDecisione {
  /** Id degli host che il giro manderebbe offline (da `selectOfflineCandidates`). */
  candidati: readonly number[];
  /** Host non offline fra gli IP scansionati: il denominatore. */
  attivi: number;
  /** Id in sospeso dal giro prima (vuoto se nessuno). */
  inSospeso: readonly number[];
  /**
   * Id degli host di cui il giro ha scansionato l'IP. I sospesi fuori da qui
   * non li decide questo giro: restano in sospeso e non contano come conferme.
   * Assente: tutti i sospesi stanno nel perimetro.
   */
  perimetro?: readonly number[];
  impostazioni: ImpostazioniSogliaOffline;
}

export interface DecisioneOffline {
  /** Id da mandare offline in questo giro. */
  daApplicare: number[];
  /** Candidati non marcati in questo giro (solo in `applica`). */
  bloccati: number;
  /** Fra quelli da applicare, quanti erano in sospeso dal giro prima. */
  confermati: number;
  /** Nuovo insieme in sospeso da conservare, compresi i sospesi fuori dal perimetro (vuoto = niente in sospeso). */
  nuovoInSospeso: number[];
  /** Il giro supera la soglia. */
  sogliaSuperata: boolean;
  /** Solo in `registra`: quanti candidati il modo `applica` avrebbe trattenuto. */
  avreiBloccato: number;
}

/** Decisione pura: nessuna lettura, nessuna scrittura. */
export function decidiPassaggioOffline(ingresso: IngressoDecisione): DecisioneOffline {
  const { impostazioni: imp } = ingresso;
  const candidati = [...new Set(ingresso.candidati)];
  const sogliaSuperata =
    candidati.length >= imp.min && candidati.length * 100 > imp.pct * ingresso.attivi;

  // Sospesi che questo giro non ha guardato: li decide un giro che li scansiona.
  const nelPerimetro = ingresso.perimetro ? new Set(ingresso.perimetro) : null;
  const fuori = nelPerimetro ? [...new Set(ingresso.inSospeso)].filter((id) => !nelPerimetro.has(id)) : [];
  const prima = new Set(nelPerimetro ? ingresso.inSospeso.filter((id) => nelPerimetro.has(id)) : ingresso.inSospeso);

  if (imp.modo === "registra") {
    return {
      daApplicare: candidati,
      bloccati: 0,
      confermati: 0,
      nuovoInSospeso: fuori,
      sogliaSuperata,
      avreiBloccato: sogliaSuperata ? candidati.length : 0,
    };
  }

  if (!sogliaSuperata) {
    return {
      daApplicare: candidati,
      bloccati: 0,
      confermati: candidati.filter((id) => prima.has(id)).length,
      nuovoInSospeso: fuori,
      sogliaSuperata,
      avreiBloccato: 0,
    };
  }

  const confermati = candidati.filter((id) => prima.has(id));
  const trattenuti = candidati.filter((id) => !prima.has(id));
  return {
    daApplicare: confermati,
    bloccati: trattenuti.length,
    confermati: confermati.length,
    nuovoInSospeso: [...fuori, ...trattenuti],
    sogliaSuperata,
    avreiBloccato: 0,
  };
}

/**
 * Legge gli id in sospeso di una rete. Un valore illeggibile vale «nessuno in
 * sospeso»: in `applica` il giro allora trattiene di più, non di meno.
 */
export function leggiInSospeso(valore: string | null): { ids: number[]; illeggibile: boolean } {
  if (valore == null || valore === "") return { ids: [], illeggibile: false };
  try {
    const dato: unknown = JSON.parse(valore);
    const ids = (dato as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(ids) || !ids.every((x) => Number.isInteger(x))) return { ids: [], illeggibile: true };
    return { ids: ids as number[], illeggibile: false };
  } catch {
    return { ids: [], illeggibile: true };
  }
}

export interface EsitoSogliaOffline {
  modo: ModoSogliaOffline;
  candidati: number;
  attivi: number;
  /** Host passati davvero offline. */
  passati: number;
  bloccati: number;
  confermati: number;
  avreiBloccato: number;
  /** Riga per il log del giro; null se non c'è niente da dire sulla soglia. */
  riga: string | null;
  /** Coda per lo stato di `scan_history`; vuota se non c'è niente da dire. */
  codaStoria: string;
}

/**
 * Passaggio a offline di fine giro con la soglia, sul tenant corrente. Stesso
 * contratto di `markHostsOffline` (filtro di T3-20), più la decisione della
 * soglia e la conservazione dei candidati in sospeso.
 * @param startedAt inizio del giro, da `oraDelDatabase()`
 */
export function passaggioOfflineConSoglia(
  networkId: number,
  onlineIps: readonly string[],
  scannedIps: readonly string[],
  startedAt: string,
): EsitoSogliaOffline {
  const imp = impostazioniDa(getTenantSetting);
  const candidati = selectOfflineCandidates(networkId, onlineIps, scannedIps, startedAt);
  const attivi = contaHostAttiviScansionati(networkId, scannedIps);
  const chiave = chiaveInSospeso(networkId);
  const grezzo = getTenantSetting(chiave);
  const sospeso = leggiInSospeso(grezzo);
  if (sospeso.illeggibile) {
    console.warn(`[SogliaOffline] rete=${networkId}: candidati in sospeso illeggibili, si riparte da zero`);
  }

  // Sospesi di host che non esistono più nella rete: si lasciano cadere.
  const perimetro = idHostScansionati(networkId, scannedIps);
  const esistenti = new Set([...perimetro.dentro, ...perimetro.fuori]);
  const dec = decidiPassaggioOffline({
    candidati: candidati.map((c) => c.id),
    attivi,
    inSospeso: sospeso.ids.filter((id) => esistenti.has(id)),
    perimetro: perimetro.dentro,
    impostazioni: imp,
  });

  const daApplicare = new Set(dec.daApplicare);
  const ipsDaApplicare = candidati.filter((c) => daApplicare.has(c.id)).map((c) => c.ip);
  // Stesso filtro di T3-20, ristretto agli IP decisi: un host visto vivo nel
  // frattempo resta fuori anche qui.
  const passati = ipsDaApplicare.length > 0 ? markHostsOffline(networkId, onlineIps, ipsDaApplicare, startedAt) : 0;

  // Si scrive solo quando c'è qualcosa da conservare o da togliere.
  if (dec.nuovoInSospeso.length > 0) {
    setTenantSetting(chiave, JSON.stringify({ ids: dec.nuovoInSospeso, inizio_giro: startedAt }));
  } else if (grezzo != null && grezzo !== "") {
    setTenantSetting(chiave, "");
  }

  const tenant = getCurrentTenantCode() ?? "?";
  let riga: string | null = null;
  let codaStoria = "";
  if (imp.modo === "applica" && dec.sogliaSuperata) {
    riga =
      `Passaggio a offline: soglia superata, ${dec.bloccati} non marcati su ${candidati.length} candidati ` +
      `(${attivi} attivi, soglia ${imp.pct}% e almeno ${imp.min}), in attesa di conferma al prossimo giro` +
      (dec.confermati > 0 ? `; ${dec.confermati} confermati dal giro prima e marcati offline` : "");
    codaStoria = `, soglia offline: ${dec.bloccati} non marcati` + (dec.confermati > 0 ? `, ${dec.confermati} confermati` : "");
    console.warn(
      `[SogliaOffline] tenant=${tenant} rete=${networkId} modo=applica candidati=${candidati.length} attivi=${attivi} bloccati=${dec.bloccati} confermati=${dec.confermati}`,
    );
  } else if (imp.modo === "registra" && dec.sogliaSuperata) {
    riga =
      `Soglia offline (modo registra): qui avrei bloccato ${dec.avreiBloccato} su ${attivi} attivi ` +
      `(soglia ${imp.pct}% e almeno ${imp.min}); marcati offline come prima`;
    codaStoria = `, soglia offline (registra): avrei bloccato ${dec.avreiBloccato}`;
    console.warn(
      `[SogliaOffline] tenant=${tenant} rete=${networkId} modo=registra candidati=${candidati.length} attivi=${attivi} avrei_bloccato=${dec.avreiBloccato}`,
    );
  } else if (dec.confermati > 0 && imp.modo === "applica") {
    riga = `Soglia offline: ${dec.confermati} host in sospeso dal giro prima confermati e marcati offline`;
  }

  return {
    modo: imp.modo,
    candidati: candidati.length,
    attivi,
    passati,
    bloccati: dec.bloccati,
    confermati: dec.confermati,
    avreiBloccato: dec.avreiBloccato,
    riga,
    codaStoria,
  };
}
