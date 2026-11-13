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
];

const sta = (percorso: string, href: string): boolean => percorso === href || percorso.startsWith(`${href}/`);

/**
 * La sezione e la scheda di un indirizzo: vince l'indirizzo più lungo (`/arp-table/trunk` non è «Tabella ARP»). Fra le
 * schede della stessa pagina sceglie quella con l'àncora data; senza àncora, o con una sconosciuta, la prima.
 */
export function sezioneDelPercorso(percorso: string, ancora?: string | null): { sezione: Sezione; scheda: SchedaSezione } | null {
  let migliore: { sezione: Sezione; scheda: SchedaSezione } | null = null;
  for (const sezione of SEZIONI) {
    for (const scheda of sezione.schede) {
      if (sta(percorso, scheda.href) && (!migliore || scheda.href.length > migliore.scheda.href.length)) migliore = { sezione, scheda };
    }
  }
  if (!migliore) return null;
  const { sezione, scheda } = migliore;
  const stessaPagina = sezione.schede.filter((x) => x.href === scheda.href);
  return { sezione, scheda: stessaPagina.find((x) => x.ancora && x.ancora === ancora) ?? stessaPagina[0] };
}

/** Indirizzo completo di una scheda, àncora compresa. */
export function indirizzoScheda(s: SchedaSezione): string {
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
