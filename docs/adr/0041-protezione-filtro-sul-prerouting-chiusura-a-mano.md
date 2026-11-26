# ADR 0041 — Protezione dell'installazione: filtro sul prerouting, esecutore chiuso, chiusura a mano

- Stato: accettato (Riccardo, 25/11/2026, risposte alle nove domande del piano)
- Piano: [`docs/superpowers/plans/2026-11-25-sicurezza-accessi-honeypot.md`](../superpowers/plans/2026-11-25-sicurezza-accessi-honeypot.md)

## Contesto

Riccardo, 25/11: «vorrei garantire che gli ipam installati non siano facilmente vulnerabili chiudendo ogni
strada di accesso a chi non è autorizzato e fornendo anche sistemi di alert delle tentate violazioni»; «deve
essere un sistema estremamente protetto, contiene troppe informazioni critiche». Oggi il solo filtro per
indirizzo è quello di NetBird (`inet dalink`). Le porte dei moduli sono pubblicate da Docker con un DNAT nel
prerouting e non passano dalla catena INPUT; l'applicazione gira come root.

## Decisione

1. **Dove si filtra**: una tabella nftables propria, `inet daipam_accessi`, con la catena sul prerouting prima
   del DNAT di Docker. Restringe soltanto; non tocca `DOCKER-USER`, iptables, UFW, NetBird. Le uscite non si filtrano.
2. **Chi applica**: un esecutore (`da-ipam-accessi`) con un elenco chiuso di comandi, che rivalida ogni valore
   della politica scritta dall'applicazione. Le porte dei gruppi stanno nel codice. L'applicazione non chiama `nft`.
3. **Chiuso di serie come criterio, chiusura a mano come gesto**: ogni installazione, nuova o esistente,
   riceve il filtro in **osserva** e dichiara «NON protetta» finché una persona non lo accende. Nessuna
   chiusura automatica.
4. **Non chiudersi fuori**: anteprima, prova a tempo con ritorno automatico senza conferma, NetBird/DA-Link
   sempre ammessi nel codice, `spegni` dalla console.
5. **Guasto del filtro**: politica minima nel codice (NetBird/DA-Link e ultimi «sempre ammessi»), con avviso.
   Né aperto a tutti né chiuso del tutto.
6. **Contrasto**: solo difesa sul nostro lato (rifiuto, rallentamento, limite, isolamento della porta con la
   conferma di una persona, avviso). Mai traffico verso la sorgente.
7. **Esche**: servizio separato senza privilegi, poca interazione, mai la password provata; su un indirizzo
   separato abilitabile oppure su quello di IPAM. Blocco di un indirizzo: a mano, salvo decisione diversa.
8. **Seconda verifica**: resta facoltativa; la sua assenza si mostra come debolezza.
9. **Avvisi** da tutte le strade d'ingresso in un solo raccoglitore; registro in sola aggiunta.

## Conseguenze

- Un'installazione resta aperta finché nessuno la chiude: lo dice la pagina, e lo dirà il segnale a DA-Link.
- Cosa diventa difficile: ogni porta nuova di un modulo va aggiunta ai gruppi nel codice, altrimenti a filtro
  acceso non risponde; chi installa un modulo a mano fuori dal registro se lo trova chiuso.
- Un secondo filtro accanto a `inet dalink`: due tabelle da leggere insieme quando «non si arriva».
- Il servizio non root e il volume cifrato restano nel piano del 14/11: finché l'applicazione è root,
  l'esecutore separa i compiti ma non è un confine di sicurezza.
- Da provare prima di scrivere il filtro: che la catena veda la porta vera delle porte pubblicate da Docker.
