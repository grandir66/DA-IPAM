---
percorso: /cliente/log-sicurezza
titolo: Log di sicurezza — vista cliente
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Riassume gli **avvisi di sicurezza** arrivati dai computer del cliente negli ultimi 7 giorni: quanti per giorno, di che
tipo e su quanti computer. Dice anche quanti computer sono sotto controllo e quanti no. È una pagina della
[vista cliente](pagine/cliente.md), in sola lettura; la vedono gli utenti con il ruolo Cliente e gli amministratori. Si
apre dal riquadro **Log di sicurezza** della pagina iniziale. C'è solo se per il cliente è attivo un modulo di raccolta
dei log di sicurezza.

In cima, **← La tua rete** torna alla [pagina iniziale](pagine/cliente.md); accanto al titolo, la fonte dei dati e quanti
computer sono sotto controllo su quanti.

Nessuna schermata: la pagina elenca avvisi di sicurezza recenti, che non si pubblicano nel manuale.

## Le voci della pagina

- **Avvisi negli ultimi 7 giorni**: una barra per giorno con il numero sopra; la barra del giorno peggiore è più scura.
  Sotto, la riga riassuntiva: quanti avvisi in 7 giorni, quanti computer sotto controllo e quanti **senza controllo**
  (computer senza l'agente che manda i log).
- **Cosa è successo negli ultimi 7 giorni**, con il numero di tipi: ogni riga è un tipo di avviso, con quanti avvisi e su
  quanti computer, e a destra quando è arrivato l'ultimo.

## Come si usa

1. Guarda le barre: un giorno molto più alto degli altri merita una domanda.
2. Leggi i tipi di avviso dal più grave.
3. Se ci sono computer **senza controllo**, chiedi a Domarc di installare l'agente.

## Cosa vogliono dire i segni

- Triangolo **rosso**: grave. Cerchio **giallo**: da guardare. Cerchio con la «i» **grigio**: informativo.

## Da dove arrivano i dati

Dal sistema che raccoglie i log di sicurezza dei computer del cliente (il nome è indicato come «fonte» in cima alla
pagina).

## Se la pagina è vuota

«Nessun avviso negli ultimi 7 giorni» è la buona notizia. «Dato non disponibile» vuol dire che il dato non si è potuto
leggere: riprova più tardi.
