/**
 * La forma unica delle schede (Riccardo, 13/11/2026: «i tab per selezionare le schede di diverse parti di software
 * dovrebbero essere organizzati in modo coerente»; otto esempi, da Active Directory a Sicurezza del dominio). Prima
 * c'erano le pillole piccole di `ui/tabs`, i riquadri grandi di `SchedePagina` e la sottolineatura di
 * `SchedeSezione`: ora i tre componenti leggono queste classi, quindi sono uguali per costruzione.
 * Fila con la riga sotto; scheda con barra spessa quando è scelta; testo a 14 px.
 */
export const FILA_SCHEDE = "flex items-end gap-1 overflow-x-auto border-b";
export const SCHEDA_BASE = "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-[3px] px-3 py-1.5 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50";
export const SCHEDA_ACCESA = "border-primary font-semibold text-foreground";
export const SCHEDA_SPENTA = "border-transparent text-muted-foreground hover:text-foreground";
