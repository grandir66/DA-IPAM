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
  /** Chi la vede: solo gli amministratori, o solo chi ha più di un'istanza. Senza, tutti. */
  per?: "admin" | "piu-istanze";
}
export interface Sezione { nome: string; schede: readonly SchedaSezione[] }

export const SEZIONI: readonly Sezione[] = [
  { nome: "Apparati", schede: [
    { href: "/discovery", etichetta: "Elenco" },
    { href: "/controllo-classificazione", etichetta: "Attribuzione" },
    { href: "/network-changes", etichetta: "Cambiamenti" },
    { href: "/excluded-ips", etichetta: "IP esclusi" },
  ] },
  { nome: "Topologia", schede: [
    { href: "/topology", etichetta: "Mappa" },
    { href: "/port-map", etichetta: "Porte" },
    { href: "/arp-table", etichetta: "Tabella ARP" },
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
    { href: "/servizi-rete", etichetta: "Servizi di rete" },
    { href: "/segmentazione", etichetta: "Segmentazione" },
    // Le tre parti di «Reti dal trunk» stanno qui, non in una seconda fila dentro la pagina (Riccardo, 13/11/2026:
    // «le metterei direttamente nel tab superiore indicando Passive Net Security, Passive Vlan and Devices, Passive
    // Announce, messo in italiano e più contratto»). La prima è quella che si apre senza àncora.
    { href: "/arp-table/trunk", etichetta: "Passiva · Sicurezza", ancora: "sicurezza" },
    { href: "/arp-table/trunk", etichetta: "Passiva · VLAN e apparati", ancora: "reti" },
    { href: "/arp-table/trunk", etichetta: "Passiva · Annunci", ancora: "annunci" },
  ] },
  // Impostazioni (Riccardo, 14/11/2026: «uniformare i tab… utenti, aggiornamenti, moduli, istanza sono fondamentali»,
  // «inserendo in modo chiaro dentro impostazioni anche le voci di menù opzioni e schedulazioni»). Una fila sola: in
  // testa le quattro fondamentali, poi Opzioni e Schedulazioni (prima voci di menu, ADR 0038), poi rete, avvisi,
  // appliance. Le schede di `/settings` si scelgono con `?tab=`; la prima è quella che si apre senza parametro.
  { nome: "Impostazioni", schede: [
    { href: "/settings", etichetta: "Utenti", tab: "utenti", per: "admin" },
    { href: "/settings", etichetta: "Aggiornamenti", tab: "aggiornamenti" },
    { href: "/settings", etichetta: "Moduli", tab: "moduli" },
    { href: "/settings", etichetta: "Istanza", tab: "istanza", per: "piu-istanze" },
    { href: "/settings/opzioni", etichetta: "Opzioni", stacco: true },
    { href: "/settings/schedulazioni", etichetta: "Schedulazioni" },
    { href: "/settings", etichetta: "Scansione", tab: "scansione", stacco: true },
    { href: "/settings", etichetta: "Identificazione", tab: "identificazione" },
    { href: "/settings", etichetta: "Alert sicurezza", tab: "alert-sicurezza", stacco: true },
    { href: "/settings", etichetta: "Notifiche", tab: "notifiche" },
    { href: "/settings", etichetta: "HTTPS", tab: "https", stacco: true },
    { href: "/settings", etichetta: "Sistema", tab: "sistema" },
    { href: "/settings/cosa-esce", etichetta: "Cosa esce", per: "admin" },
  ] },
];

const sta = (percorso: string, href: string): boolean => percorso === href || percorso.startsWith(`${href}/`);

/**
 * La sezione e la scheda di un indirizzo: vince l'indirizzo più lungo (`/arp-table/trunk` non è «Tabella ARP»). Fra le
 * schede della stessa pagina sceglie quella con l'àncora data; senza àncora, o con una sconosciuta, la prima.
 */
export function sezioneDelPercorso(percorso: string, ancora?: string | null, tab?: string | null): { sezione: Sezione; scheda: SchedaSezione } | null {
  let migliore: { sezione: Sezione; scheda: SchedaSezione } | null = null;
  for (const sezione of SEZIONI) {
    for (const scheda of sezione.schede) {
      if (sta(percorso, scheda.href) && (!migliore || scheda.href.length > migliore.scheda.href.length)) migliore = { sezione, scheda };
    }
  }
  if (!migliore) return null;
  const { sezione, scheda } = migliore;
  const stessaPagina = sezione.schede.filter((x) => x.href === scheda.href);
  const scelta = stessaPagina.find((x) => (x.ancora && x.ancora === ancora) || (x.tab && x.tab === tab));
  return { sezione, scheda: scelta ?? stessaPagina[0] };
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
