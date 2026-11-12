/**
 * Le sezioni del menu (Riccardo, 12/11/2026: «il menù mi sembra troppo ricco di opzioni… alcune sono davvero
 * accessorie… e alcune dovrebbero stare dentro altre opzioni»). Nel menu resta la prima pagina di ogni sezione; le
 * altre sono schede in cima alla pagina (`schede-sezione.tsx`). Gli indirizzi non cambiano: nessun collegamento si
 * rompe. Modulo puro.
 */
export interface SchedaSezione { href: string; etichetta: string }
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
    { href: "/arp-table/trunk", etichetta: "Reti dal trunk" },
  ] },
];

const sta = (percorso: string, href: string): boolean => percorso === href || percorso.startsWith(`${href}/`);

/** La sezione e la scheda di un indirizzo: vince l'indirizzo più lungo (`/arp-table/trunk` non è «Tabella ARP»). */
export function sezioneDelPercorso(percorso: string): { sezione: Sezione; scheda: SchedaSezione } | null {
  let migliore: { sezione: Sezione; scheda: SchedaSezione } | null = null;
  for (const sezione of SEZIONI) {
    for (const scheda of sezione.schede) {
      if (sta(percorso, scheda.href) && (!migliore || scheda.href.length > migliore.scheda.href.length)) migliore = { sezione, scheda };
    }
  }
  return migliore;
}

/**
 * La voce di menu `href` è accesa su questo indirizzo? Dentro una sezione si accende solo la sua prima pagina (su
 * «Tabella ARP» si accende «Topologia»); `null` = l'indirizzo non è in una sezione, decide chi chiama.
 */
export function voceAccesaDallaSezione(percorso: string, href: string): boolean | null {
  const s = sezioneDelPercorso(percorso);
  return s ? s.sezione.schede[0].href === href : null;
}
