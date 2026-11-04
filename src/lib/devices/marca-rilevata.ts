/**
 * La marca di un apparato sotto la piattaforma «Altro» (Riccardo, 04/11/2026: il GS1900 è uno Zyxel). La piattaforma dice
 * come si legge un apparato, non chi lo produce, e l'elenco è chiuso dal CHECK di `network_devices.vendor`: la marca si
 * ricava da ciò che la scansione sa già, senza scrivere niente. Puro: lo usano anche i componenti client.
 *
 * Prima `inferred_vendor`, che viene da SNMP e MAC ed è già un nome breve; poi il produttore rilevato, ripulito della
 * ragione sociale («Zyxel Communications Corporation» → «Zyxel»). Nessuna fonte = null: mai una marca indovinata.
 */

/** Slug di `inferred_vendor` che non si scrivono con la sola iniziale maiuscola. */
const NOMI_MARCA: Record<string, string> = {
  apc: "APC",
  asus: "ASUS",
  draytek: "DrayTek",
  hp: "HP",
  "hp-printer": "HP",
  sonicwall: "SonicWall",
};

/** In coda al nome di un produttore: forma societaria o parola di settore, non la marca. */
const CODA_RAGIONE_SOCIALE =
  /(?:[\s,]+)(?:inc\.?|incorporated|corp\.?|corporation|co\.?,?\s*ltd\.?|ltd\.?|limited|llc|gmbh(?:\s*&\s*co\.?\s*kg)?|s\.?p\.?a\.?|s\.?r\.?l\.?|plc|ag|kg|b\.?v\.?|communications|systems|technolog(?:y|ies)|labs?\.?|foundation|international|holdings|display)\s*$/i;

/** Il nome del produttore senza la ragione sociale. Non lo svuota mai: la coda si toglie solo se davanti resta qualcosa. */
export function nomeMarca(produttore: string): string {
  let nome = produttore.trim();
  for (let tolta = nome.replace(CODA_RAGIONE_SOCIALE, ""); tolta !== nome && tolta !== ""; tolta = nome.replace(CODA_RAGIONE_SOCIALE, "")) {
    nome = tolta;
  }
  return nome;
}

export function marcaRilevata(host: {
  inferred_vendor?: string | null;
  device_manufacturer?: string | null;
  vendor?: string | null;
}): string | null {
  const slug = host.inferred_vendor?.trim().toLowerCase();
  if (slug) return NOMI_MARCA[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
  const produttore = host.device_manufacturer?.trim() || host.vendor?.trim();
  return produttore ? nomeMarca(produttore) : null;
}
