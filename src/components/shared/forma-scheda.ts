/**
 * La forma unica delle schede (Riccardo, 13/11/2026: «i tab per selezionare le schede di diverse parti di software
 * dovrebbero essere organizzati in modo coerente»; otto esempi, da Active Directory a Sicurezza del dominio). Prima
 * c'erano le pillole piccole di `ui/tabs`, i riquadri grandi di `SchedePagina` e la sottolineatura di
 * `SchedeSezione`: ora i tre componenti leggono queste classi, quindi sono uguali per costruzione.
 *
 * Seconda passata, stesso giorno: «vorrei i tab più evidenti perché deve essere chiaro che ci sono opzioni dentro uno
 * stesso menù». La sola sottolineatura si perdeva: ora ogni scheda è una linguetta col suo bordo e il suo fondo,
 * appoggiata a una riga spessa; quella scelta è piena (fondo del colore primario, testo scuro, grassetto), le altre
 * hanno fondo tenue e bordo. Si distinguono per riempimento e peso, non per tinta (Riccardo è daltonico).
 * E ancora: «quasi dei pulsanti da selezionare in alto»: quindi pulsanti veri, arrotondati su tutti i lati, in fila
 * sopra una riga che li separa dal contenuto.
 */
export const FILA_SCHEDE = "flex items-center gap-2 overflow-x-auto border-b border-border pb-2";
export const SCHEDA_BASE = "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border-2 px-4 text-[15px] whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50";
export const SCHEDA_ACCESA = "border-primary bg-primary font-semibold text-primary-foreground";
export const SCHEDA_SPENTA = "border-border bg-muted/50 font-medium text-foreground/80 hover:border-foreground/40 hover:bg-muted hover:text-foreground";
