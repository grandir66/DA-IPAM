/**
 * Le sezioni del menu (Riccardo, 12/11/2026: «il menù mi sembra troppo ricco di opzioni… alcune sono davvero
 * accessorie… e alcune dovrebbero stare dentro altre opzioni»). Nel menu resta la prima pagina di ogni sezione; le
 * altre sono schede in cima alla pagina (`schede-sezione.tsx`). Gli indirizzi non cambiano: nessun collegamento si
 * rompe. Modulo puro.
 */
export interface SchedaSezione {
  href: string;
  etichetta: string;
  /** Parte della pagina (l'àncora dopo `#`): più schede possono aprire la stessa pagina su parti diverse. */
  ancora?: string;
  /** Parte della pagina scelta col parametro `?tab=` (Impostazioni): come l'àncora, ma l'àncora lì serve già ad altro. */
  tab?: string;
  /** Una riga verticale prima di questa scheda: comincia un gruppo. */
  stacco?: boolean;
  /** Nome del gruppo che comincia con questa scheda, scritto prima di lei. */
  gruppo?: string;
  /** Chi la vede: solo gli amministratori, o solo chi ha più di un'istanza. Senza, tutti. */
  per?: "admin" | "piu-istanze";
  /** Altri indirizzi che stanno sotto questa scheda senza averne una loro (es. `/settings/mdm` sotto «Moduli»). */
  anche?: readonly string[];
}
export interface Sezione { nome: string; schede: readonly SchedaSezione[] }

export const SEZIONI: readonly Sezione[] = [
  { nome: "Apparati", schede: [
    { href: "/discovery", etichetta: "Elenco" },
    { href: "/controllo-classificazione", etichetta: "Attribuzione" },
    // Dal 14/11/2026 (Riccardo) qui sta tutto ciò che cambia nel tempo; «Anomalie» ci è confluita e la sua pagina
    // (disponibilità e latenza) resta raggiungibile da qui.
    { href: "/network-changes", etichetta: "Cambiamenti", anche: ["/analytics"] },
    { href: "/excluded-ips", etichetta: "IP esclusi" },
  ] },
  { nome: "Topologia", schede: [
    { href: "/topology", etichetta: "Mappa" },
    // Prima erano due collegamenti accanto al titolo della Mappa (Riccardo, 24/11/2026: i tab stanno tutti in alto, «non
    // distribuirle su diversi livelli»).
    { href: "/topology/tavola", etichetta: "Tavola di cablaggio" },
    { href: "/port-map", etichetta: "Porte" },
    { href: "/arp-table", etichetta: "Tabella ARP" },
    { href: "/topology/dati", etichetta: "Dati della mappa" },
  ] },
  // DatIA Mon (Riccardo, 26/11/2026: «il punto di ingresso della gestione della integrazione»): le pagine di Zabbix in
  // una fila sola, le sei approvate da lui sulla tavola. «Aggiungi» è confluita in Apparati (filtro «Da aggiungere»).
  // «Per il cliente» esce da questa fila: la pagina del cliente ha il suo guscio, senza menu.
  { nome: "DatIA Mon", schede: [
    { href: "/zabbix/apparati", etichetta: "Apparati", per: "admin", anche: ["/zabbix/aggiungi"] },
    { href: "/zabbix/modelli", etichetta: "Modelli", per: "admin" },
    { href: "/zabbix/agenti", etichetta: "Agenti", per: "admin" },
    { href: "/zabbix", etichetta: "Abbinamenti" },
    { href: "/cliente/monitoring", etichetta: "Per il cliente" },
    { href: "/zabbix/centro", etichetta: "Centro e proxy", per: "admin" },
  ] },
  { nome: "Credenziali", schede: [
    { href: "/credentials", etichetta: "Credenziali" },
    { href: "/controllers", etichetta: "Controller di rete" },
  ] },
  { nome: "DHCP", schede: [
    { href: "/dhcp", etichetta: "DHCP" },
    { href: "/dhcp/sources", etichetta: "Sorgenti" },
  ] },
  { nome: "Patch Management", schede: [
    { href: "/patch-management", etichetta: "Panoramica" },
    { href: "/patch-management/cve", etichetta: "CVE" },
    { href: "/patch-management/history", etichetta: "Storico" },
  ] },
  { nome: "Scansioni", schede: [
    { href: "/scans", etichetta: "Interne" },
    { href: "/vulnerabilities/scansioni", etichetta: "VA dall'Edge" },
  ] },
  { nome: "Rete", schede: [
    // Nomi e gruppi di Riccardo, 24/11/2026 («renderle più parlanti»): le prime mandano prove sulla rete, le altre
    // ascoltano soltanto. Le tre parti della sonda trunk stanno qui e non in una seconda fila (13/11/2026); la prima è
    // quella che si apre senza àncora.
    { href: "/servizi-rete", etichetta: "Porte e servizi", gruppo: "Provate dalla sonda" },
    { href: "/segmentazione", etichetta: "Chi raggiunge cosa" },
    { href: "/traffico", etichetta: "Traffico", gruppo: "Viste in ascolto", stacco: true },
    { href: "/arp-table/trunk", etichetta: "Allarmi di rete", ancora: "sicurezza" },
    { href: "/arp-table/trunk", etichetta: "VLAN e indirizzi", ancora: "reti" },
    { href: "/arp-table/trunk", etichetta: "Apparati annunciati", ancora: "annunci" },
  ] },
  // Protezione dell'installazione (Riccardo, 25/11/2026; ADR 0041): cosa è chiuso, cosa resta debole. Solo admin.
  // Le schede che si leggono soltanto più «Chi può collegarsi» (tappa 2); Esche, Tentativi e Registro arrivano dopo.
  { nome: "Protezione", schede: [
    { href: "/protezione", etichetta: "Stato della protezione", per: "admin" },
    { href: "/protezione/porte", etichetta: "Porte presentate", per: "admin" },
    { href: "/protezione/accessi", etichetta: "Chi può collegarsi", per: "admin" },
    { href: "/protezione/utenti", etichetta: "Utenti", per: "admin" },
    { href: "/protezione/sistemi", etichetta: "Sistemi remoti", per: "admin" },
    { href: "/protezione/moduli", etichetta: "Moduli e container", per: "admin" },
    { href: "/protezione/esche", etichetta: "Esche", per: "admin", stacco: true },
    { href: "/protezione/tentativi", etichetta: "Tentativi e blocchi", per: "admin" },
    // L'archivio degli utenti (ADR 0043) lo vede chiunque sia collegato: chi può aprirlo lo decide la sua serratura.
    { href: "/archivio", etichetta: "Archivio", stacco: true },
  ] },
  // Impostazioni e Config (Riccardo, 14/11/2026). Prima: «uniformare i tab… utenti, aggiornamenti, moduli, istanza sono
  // fondamentali», «inserendo dentro impostazioni anche le voci di menù opzioni e schedulazioni». Poi: «avere un menù
  // impostazioni per le voci ad uso anche clienti o più generali, e un config dove ci sono davvero le cose che solo un
  // admin può conoscere, come porte, config particolari» → «Due voci» (ADR 0038). Le schede di `/settings` si scelgono
  // con `?tab=`; la prima di Impostazioni è quella che si apre senza parametro.
  { nome: "Impostazioni", schede: [
    { href: "/settings", etichetta: "Utenti", tab: "utenti", per: "admin" },
    { href: "/settings", etichetta: "Aggiornamenti", tab: "aggiornamenti" },
    { href: "/settings", etichetta: "Moduli", tab: "moduli", anche: ["/settings/moduli", "/settings/mdm"] },
    { href: "/settings", etichetta: "Istanza", tab: "istanza", per: "piu-istanze" },
    { href: "/settings/opzioni", etichetta: "Opzioni", stacco: true },
    { href: "/settings/schedulazioni", etichetta: "Schedulazioni" },
    { href: "/settings", etichetta: "Notifiche", tab: "notifiche", stacco: true },
  ] },
  { nome: "Config", schede: [
    { href: "/settings", etichetta: "Scansione", tab: "scansione", per: "admin" },
    { href: "/settings", etichetta: "Identificazione", tab: "identificazione", per: "admin", anche: ["/settings/snmp-profiles", "/settings/classifications"] },
    { href: "/settings", etichetta: "Alert sicurezza", tab: "alert-sicurezza", per: "admin" },
    { href: "/settings", etichetta: "HTTPS", tab: "https", per: "admin", stacco: true },
    { href: "/settings", etichetta: "Sistema", tab: "sistema", per: "admin", anche: ["/settings/transfer", "/settings/vault"] },
    { href: "/settings/cosa-esce", etichetta: "Cosa esce", per: "admin" },
  ] },
];

const sta = (percorso: string, href: string): boolean => percorso === href || percorso.startsWith(`${href}/`);

/**
 * La sezione e la scheda di un indirizzo: vince l'indirizzo più lungo (`/arp-table/trunk` non è «Tabella ARP»). Fra le
 * schede della stessa pagina sceglie quella con l'àncora data; senza àncora, o con una sconosciuta, la prima.
 */
export function sezioneDelPercorso(percorso: string, ancora?: string | null, tab?: string | null): { sezione: Sezione; scheda: SchedaSezione } | null {
  const tutte = SEZIONI.flatMap((sezione) => sezione.schede.map((scheda) => ({ sezione, scheda })));
  // Quanto è lungo l'indirizzo della scheda che contiene questo percorso (0 = non lo contiene): il suo o uno di `anche`.
  const lungo = (x: SchedaSezione): number => Math.max(0, ...[x.href, ...(x.anche ?? [])].filter((h) => sta(percorso, h)).map((h) => h.length));
  let migliore: { sezione: Sezione; scheda: SchedaSezione } | null = null;
  let record = 0;
  for (const c of tutte) {
    const n = lungo(c.scheda);
    if (n > record) { migliore = c; record = n; }
  }
  if (!migliore) return null;
  // Più schede sulla stessa pagina, anche di sezioni diverse (Impostazioni e Config stanno tutte e due su `/settings`):
  // sceglie l'àncora o il `tab`. Vale solo se il percorso è proprio quella pagina, non un indirizzo di `anche`.
  if (record !== migliore.scheda.href.length) return migliore;
  const stessaPagina = tutte.filter((c) => c.scheda.href === migliore.scheda.href);
  return stessaPagina.find((c) => (c.scheda.ancora && c.scheda.ancora === ancora) || (c.scheda.tab && c.scheda.tab === tab)) ?? stessaPagina[0];
}

/** Indirizzo completo di una scheda, àncora compresa. */
export function indirizzoScheda(s: SchedaSezione): string {
  if (s.tab) return `${s.href}?tab=${s.tab}`;
  return s.ancora ? `${s.href}#${s.ancora}` : s.href;
}

/**
 * La voce di menu `href` è accesa su questo indirizzo? Dentro una sezione si accende solo la sua prima pagina (su
 * «Tabella ARP» si accende «Topologia»); `null` = l'indirizzo non è in una sezione, decide chi chiama.
 */
export function voceAccesaDallaSezione(percorso: string, href: string): boolean | null {
  const s = sezioneDelPercorso(percorso);
  return s ? s.sezione.schede[0].href === href : null;
}

/** Il nome della sezione di un indirizzo, col `tab`: al menu serve per accendere «Impostazioni» o «Config», che stanno sulla stessa pagina. */
export function nomeSezione(percorso: string, tab?: string | null): string | null {
  return sezioneDelPercorso(percorso, null, tab)?.sezione.nome ?? null;
}
