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
  /** Etichetta della scheda in testa al wizard (24/10): corta, ci stanno tutte a 390 px scorrendo. */
  breve: string;
  descrizione: string;
}

export const PASSI_WIZARD: readonly PassoWizard[] = [
  { titolo: "Credenziali (archivio)", breve: "Credenziali", descrizione: "Le voci che useranno router, Active Directory e subnet" },
  { titolo: "Router / gateway", breve: "Router", descrizione: "ARP e, se supportato, DHCP" },
  { titolo: "DNS", breve: "DNS", descrizione: "Risoluzione nomi per le subnet" },
  { titolo: "Active Directory", breve: "Active Directory", descrizione: "Dominio e sincronizzazione (opz.)" },
  { titolo: "Prima subnet", breve: "Subnet", descrizione: "Rete da analizzare e reti viste sul trunk" },
];

/** Indici dei passi, per non scrivere numeri nudi nel wizard. */
export const PASSO = {
  credenziali: 0,
  router: 1,
  dns: 2,
  ad: 3,
  subnet: 4,
} as const;
