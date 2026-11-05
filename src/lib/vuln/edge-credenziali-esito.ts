/**
 * Quando rimandare le credenziali a una sonda (05/11/2026, 72729).
 *
 * I giri pianificati partono dalla sonda e non passano da qui: un legame perso restava perso finché
 * qualcuno non lanciava una scansione dal pannello. Rimandarle però accende Greenbone, quindi il
 * freno è stretto: una sonda vecchia non dice l'esito (e cancellerebbe i legami: sta alla 0.8.249 in
 * poi), e un tentativo si rifà solo dopo un giorno.
 */
export interface EdgeCredenzialeFallita {
  slot: string;
  name: string;
  motivo: string;
}

export interface EdgeCredenzialiSonda {
  ssh: { id: string; name: string } | null;
  smb: { id: string; name: string } | null;
  snmp: { id: string; name: string } | null;
  /** Assenti sulle sonde più vecchie della 0.8.249. */
  esito_il?: string | null;
  falliti?: EdgeCredenzialeFallita[];
}

const UN_GIORNO_MS = 24 * 60 * 60_000;

export function serveRimandare(
  slotDaIpam: string[],
  sonda: EdgeCredenzialiSonda | undefined,
  adesso: number,
): boolean {
  if (!sonda || sonda.esito_il === undefined) return false;
  const manca = (["ssh", "smb", "snmp"] as const).some((s) => slotDaIpam.includes(s) && !sonda[s]);
  if (!manca) return false;
  if (sonda.esito_il === null) return true;
  const quando = Date.parse(`${sonda.esito_il.replace(" ", "T")}Z`);
  return Number.isFinite(quando) && adesso - quando >= UN_GIORNO_MS;
}
