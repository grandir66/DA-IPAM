/**
 * Come si presentano le nostre prove agli altri sistemi (Riccardo, 13/11/2026: «questo testo con il nome da-ipam
 * dobbiamo disabilitarlo ovunque; va testato un utente neutro che non sia legato al programma»). Su DTS il registro
 * del server Wazuh aveva 7.720 righe «utente inesistente da-ipam»: il nome del prodotto finiva nei registri e negli
 * allarmi del cliente a ogni giro. Qui stanno i nomi neutri, in un posto solo: nessuna prova scrive più il nome del
 * programma in un nome utente, in un User-Agent, in un saluto SMTP, in un cookie RDP o in un comando di prova.
 * Le nostre prove si riconoscono dall'indirizzo di provenienza (`integrations/self-identity.ts`), non dal nome.
 */
/** Utente delle prove senza credenziali (SSH «none», cookie RDP): non esiste da nessuna parte e non dice chi siamo. */
export const UTENTE_NEUTRO = "netcheck";
/** User-Agent delle prove HTTP. */
export const AGENTE_NEUTRO = "Mozilla/5.0 (compatible)";
/** Nome con cui ci si presenta in un saluto SMTP. */
export const NOME_HOST_NEUTRO = "client.local";
/** Parola che un comando di prova fa ripetere al sistema per sapere che la sessione funziona. */
export const SEGNO_PROVA = "probe-ok";
