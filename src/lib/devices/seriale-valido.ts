/**
 * Valori che finiscono in un campo «seriale» senza esserlo (72729, 04/11/2026). Pesa più di un dato sbagliato: il seriale è la
 * chiave degli apparati fisici (`identity-resolver.ts`), due stampanti uguali con lo stesso valore finto diventerebbero una, e
 * un finto non vuoto blocca ogni lettura che lo correggerebbe. Puro.
 */

/** Stringa d'identità IEEE 1284 di una stampante: «MFG:HP;MDL:…;CMD:…;». */
export function eStringaIeee1284(valore: string | null | undefined): boolean {
  return /(?:^|;)\s*(?:MFG|MANUFACTURER|MDL|MODEL|CMD|COMMAND SET|CLS|CID|ID)\s*:[^;]*;/i.test(valore ?? "");
}

/** Non un seriale: la stringa 1284, una porta USB, o il nome di una serie di prodotti («ET-5805 Series», `prtGeneralPrinterName`). */
export function eSerialeFinto(valore: string | null | undefined): boolean {
  // Segnaposto dei BIOS (DTS, 12/11/2026: nove PC diversi uniti da «Default string»).
  if (/^(default string|to be filled by o\.?e\.?m\.?|system serial number|not specified|not applicable|none|n\/?a|unknown|(bss-)?0?123456789|0+|x+)$/i.test((valore ?? "").trim())) return true;
  // «F2510000.USB3» (DTS, 12/11/2026): l'identificativo della porta USB dei MikroTik, uguale su ogni router.
  return eStringaIeee1284(valore) || /\bseries\s*$/i.test(valore ?? "") || /\.usb\d*\s*$/i.test(valore ?? "");
}
