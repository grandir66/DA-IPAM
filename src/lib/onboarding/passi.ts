/**
 * I passi del wizard di prima configurazione, nell'ordine della tappa 4
 * credenziali (15/10): prima l'archivio delle credenziali, poi chi le usa
 * (router, Active Directory, prima subnet). Prima le credenziali stavano al
 * terzo passo e il router chiedeva le sue in linea, fuori archivio.
 *
 * Modulo puro: lo leggono il wizard e la validazione del punto raggiunto.
 */
export interface PassoWizard {
  titolo: string;
  descrizione: string;
}

export const PASSI_WIZARD: readonly PassoWizard[] = [
  { titolo: "Credenziali (archivio)", descrizione: "Le voci che useranno router, Active Directory e subnet" },
  { titolo: "Router / gateway", descrizione: "ARP e, se supportato, DHCP" },
  { titolo: "DNS", descrizione: "Risoluzione nomi per le subnet" },
  { titolo: "Active Directory", descrizione: "Dominio e sincronizzazione (opz.)" },
  { titolo: "Prima subnet", descrizione: "Rete da analizzare" },
];

/** Indici dei passi, per non scrivere numeri nudi nel wizard. */
export const PASSO = {
  credenziali: 0,
  router: 1,
  dns: 2,
  ad: 3,
  subnet: 4,
} as const;
