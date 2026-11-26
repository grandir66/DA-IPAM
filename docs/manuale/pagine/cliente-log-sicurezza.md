---
percorso: /cliente/log-sicurezza
titolo: Log di sicurezza — vista cliente
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Riassume gli **avvisi di sicurezza** arrivati dai tuoi computer negli ultimi 7 giorni: quanti per giorno, di che tipo e
su quanti computer. Dice anche quanti computer sono sotto controllo e quanti no. È una pagina della
[vista cliente](pagine/cliente.md), in sola lettura. Si apre dal riquadro **Log di sicurezza** della pagina iniziale;
c'è solo se hai attivo un servizio di raccolta dei log di sicurezza.

In cima, **← La tua rete** torna alla [pagina iniziale](pagine/cliente.md); accanto al titolo, la fonte dei dati e quanti
computer sono sotto controllo su quanti.

Nessuna schermata: la pagina elenca avvisi di sicurezza recenti, che non si pubblicano nel manuale.

## Avvisi negli ultimi 7 giorni

Una barra per giorno con il numero sopra; la barra del giorno peggiore è più scura. Sotto, la riga riassuntiva: quanti
avvisi in 7 giorni, quanti computer sotto controllo e quanti **senza controllo** (computer senza l'agente che manda i
log).

## Cosa è successo negli ultimi 7 giorni

Il titolo dice quanti tipi di avviso ci sono. Ogni riga è un tipo di avviso, con il suo segno di gravità, quanti avvisi e
su quanti computer, e a destra quando è arrivato l'ultimo («2 ore fa»).

## Come si fa

- **Capire se è stata una settimana tranquilla**: guarda le barre: un giorno molto più alto degli altri merita una
  domanda al tuo referente tecnico.
- **Sapere cosa è successo di grave**: leggi i tipi di avviso con `icona:triangle-alert` rosso.
- **Controllare che tutti i computer siano protetti**: guarda quanti sono **senza controllo**; se non sono zero, chiedi
  di installare l'agente.
- **Verificare se un problema è ancora in corso**: guarda quando è arrivato l'ultimo avviso di quel tipo.

## Cosa vogliono dire i segni

- `icona:triangle-alert` **rosso**: grave.
- `icona:circle-alert` **giallo**: da guardare.
- `icona:info` **grigio**: informativo.

## Da dove arrivano i dati

Dal sistema che raccoglie i log di sicurezza dei tuoi computer (il nome è indicato come «fonte» in cima alla pagina).

## Se la pagina è vuota

«Nessun avviso negli ultimi 7 giorni» è la buona notizia. «Dato non disponibile» vuol dire che il dato non si è potuto
leggere: riprova più tardi.
