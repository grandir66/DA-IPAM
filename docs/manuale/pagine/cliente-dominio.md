---
percorso: /cliente/dominio
titolo: Dominio e accessi — vista cliente
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Dice al cliente **quanto è a rischio il suo dominio Active Directory** e quali problemi di accesso ci sono stati nelle
ultime 24 ore. Il punteggio va da 0 a 100: più è alto, peggio è. È una pagina della [vista cliente](pagine/cliente.md),
in sola lettura; la vedono gli utenti con il ruolo Cliente e gli amministratori. Si apre dal riquadro **Dominio e
accessi** della pagina iniziale o dai collegamenti **Dominio e accessi →** dei grafici. C'è solo se per il cliente è
configurato il controllo del dominio.

In cima, **← La tua rete** torna alla [pagina iniziale](pagine/cliente.md); accanto al titolo, la data del controllo.

Nessuna schermata: la pagina elenca debolezze del dominio ancora aperte, che non si pubblicano nel manuale.

## Le voci della pagina

- **Stato del dominio** («più alto è peggio»): il **Rischio del dominio** su 100, con il valore di un mese fa per
  confronto, e sotto una barra per ogni area controllata (per esempio account con privilegi, password, configurazione).
- **Cosa abbassa il punteggio**: i rilievi del controllo, dal più grave, ognuno con quanti oggetti riguarda. **vedi i
  nomi** apre sotto l'elenco degli account o dei computer coinvolti.
- **Problemi di accesso · ultime 24 ore**: gli utenti con accessi falliti o bloccati, con il tipo di problema, da quale
  computer e l'ora dell'ultimo tentativo; sotto, il motivo quando è noto (per esempio password sbagliata).

## Come si usa

1. Guarda il numero del rischio e confrontalo con quello di un mese fa: deve scendere.
2. Apri **vedi i nomi** sui rilievi più gravi per sapere quali account sistemare.
3. Se un utente compare spesso nei **Problemi di accesso**, verifica con lui: può essere una password vecchia salvata su
   un telefono, oppure un tentativo di attacco.

## Cosa vogliono dire i segni

Accanto a ogni rilievo il segno della gravità: rosso grave, giallo da guardare.

## Da dove arrivano i dati

Dal controllo periodico del dominio Active Directory fatto da DA-IPAM e dai registri di accesso dei server di dominio.

## Se la pagina è vuota

«Il controllo del dominio non è ancora stato eseguito»: il primo controllo non è ancora partito. «Nessun problema di
accesso nelle ultime 24 ore» è la buona notizia. «Dato non disponibile» vuol dire che quella parte non si è potuta
leggere.
