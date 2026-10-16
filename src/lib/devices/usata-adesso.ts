/**
 * «Usata adesso»: la credenziale che l'acquisizione di un apparato sceglie,
 * per il protocollo principale e per SNMP (tappa 2e credenziali, T20,
 * interfaccia punto 5). La calcola il server col motore
 * (`credentials/apparato-archivio.ts`, `usataAdessoDb`) e la manda con
 * GET /api/devices/[id]. Modulo puro, senza DB: lo importano le pagine.
 *
 * Prima il riquadro della scheda leggeva le colonne `credential_id` e
 * `snmp_credential_id`, mentre la tabella sotto mostrava i binding: due
 * risposte diverse sulla stessa pagina. Dopo la 2e le colonne sono vuote.
 */
import type { CredProtocol } from "@/lib/credentials/porte";

/** Fonte della scelta, coi nomi del motore (`ResolvedCredentialSource`) che l'acquisizione usa. */
export type FonteUsata = "device_binding" | "device_inline" | "device_column" | "device_column_inline" | "snmp_ripiego";

export interface UsataAdesso {
  /** «principale» = il protocollo dell'apparato (per un apparato SNMP, SNMP); «snmp» = SNMP in più. */
  ruolo: "principale" | "snmp";
  protocollo: CredProtocol;
  /** La voce d'archivio scelta; null per binding inline, colonne col segreto, «public» o nessuna. */
  credential_id: number | null;
  /** Nome della voce, o com'è fatta la scelta senza voce; null = nessuna. */
  nome: string | null;
  fonte: FonteUsata | null;
  porta: number | null;
  /** Perché non c'è nessuna credenziale (dal motore). */
  motivo: string | null;
}

const NOME_FONTE: Record<FonteUsata, string> = {
  device_binding: "binding dell'apparato",
  device_inline: "binding inline (vecchio)",
  device_column: "colonna dell'apparato (vecchia)",
  device_column_inline: "colonne dell'apparato (vecchie)",
  snmp_ripiego: "ripiego dichiarato",
};

export function nomeFonteUsata(f: FonteUsata): string {
  return NOME_FONTE[f];
}

/**
 * Le due tendine delle credenziali di una finestra di modifica, dalla scelta
 * del motore: la voce d'archivio usata adesso per il protocollo principale e
 * per SNMP, altrimenti vuote. Senza `usata_adesso` (una riga della lista degli
 * apparati) sono vuote: le colonne vecchie non contano più.
 */
export function vociUsateAdesso(usate: readonly Pick<UsataAdesso, "ruolo" | "credential_id">[] | null | undefined): {
  principale: number | null;
  snmp: number | null;
} {
  const di = (ruolo: UsataAdesso["ruolo"]) => usate?.find((u) => u.ruolo === ruolo)?.credential_id ?? null;
  return { principale: di("principale"), snmp: di("snmp") };
}
