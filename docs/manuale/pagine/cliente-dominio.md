---
percorso: /cliente/dominio
titolo: Dominio e accessi — vista cliente
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Ti dice **quanto è a rischio il tuo dominio** (Active Directory, il sistema che gestisce utenti, password e computer
dell'azienda) e quali problemi di accesso ci sono stati nelle ultime 24 ore. Il punteggio va da 0 a 100: più è alto,
peggio è. È una pagina della [vista cliente](pagine/cliente.md), in sola lettura. Si apre dal riquadro **Dominio e
accessi** della pagina iniziale o dai collegamenti **Dominio e accessi →** dei grafici; c'è solo se è attivo il
controllo del dominio.

In cima, **← La tua rete** torna alla [pagina iniziale](pagine/cliente.md); accanto al titolo, la data del controllo
(«controllo del …»).

Nessuna schermata: la pagina elenca debolezze del dominio ancora aperte, che non si pubblicano nel manuale.

## Stato del dominio

«Più alto è peggio». Il numero grande è il **Rischio del dominio** su 100, con il valore di un mese fa per confronto.
Sotto, una barra per ogni area controllata (per esempio account con privilegi, password, configurazione): più è lunga,
più quell'area pesa sul rischio.

## Cosa abbassa il punteggio

I rilievi del controllo, dal più grave, ognuno con il suo segno e con quanti account o computer riguarda. **vedi i
nomi** apre sotto l'elenco degli account o dei computer coinvolti; un altro clic lo chiude.

## Problemi di accesso · ultime 24 ore

Gli utenti con accessi falliti o bloccati nelle ultime 24 ore: chi, il tipo di problema, da quale computer e l'ora
dell'ultimo tentativo. Sotto, il motivo quando è noto (per esempio password sbagliata o account bloccato).

## Come si fa

- **Capire se la situazione migliora**: confronta il **Rischio del dominio** con quello di un mese fa: deve scendere.
- **Sapere quali account sistemare**: **vedi i nomi** sui rilievi con `icona:triangle-alert` rosso.
- **Un utente compare spesso fra i problemi di accesso**: parlane con lui: può essere una password vecchia salvata su un
  telefono, oppure un tentativo di attacco. Se non lo sa spiegare, avvisa il tuo referente tecnico.
- **Preparare una riunione sulla sicurezza**: stampa la pagina dalla [pagina iniziale](pagine/cliente.md) o con la
  stampa del browser.

## Cosa vogliono dire i segni

Accanto a ogni rilievo il segno della gravità:

- `icona:triangle-alert` rosso: grave;
- `icona:circle-alert` giallo: da guardare;
- `icona:info` grigio: da sapere, non urgente.

## Da dove arrivano i dati

Dal controllo periodico del dominio Active Directory fatto da DA-IPAM e dai registri di accesso dei server di dominio.

## Se la pagina è vuota

«Il controllo del dominio non è ancora stato eseguito»: il primo controllo non è ancora partito. «Nessun rilievo in
questo controllo» e «Nessun problema di accesso nelle ultime 24 ore» sono buone notizie. «Dato non disponibile» vuol
dire che quella parte non si è potuta leggere.
