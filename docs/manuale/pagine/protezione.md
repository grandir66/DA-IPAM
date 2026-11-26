---
percorso: /protezione
titolo: Stato della protezione — cosa protegge questa installazione
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Dice in una pagina sola **come è difesa questa installazione di DA-IPAM**: una riga per strato (rete, accessi,
utenti, servizi, chiavi), con lo stato, cosa vuol dire, la gravità e il rimedio. Serve a vedere a colpo d'occhio cosa
è a posto e cosa resta da sistemare, e ad andare dritti alla pagina dove si rimedia.

Si arriva da **Sicurezza › Protezione**. La pagina e tutte le sue schede le vede **solo un amministratore**: chi è in
sola lettura trova la scritta «Pagina riservata agli amministratori di questa istanza». Tabelle e schede funzionano
come altrove: vedi le [parti comuni dell'interfaccia](../INTERFACCIA.md).

Il manuale non mostra schermate di queste pagine e non descrive come è difesa una installazione vera: spiega soltanto
che cosa fa ogni voce.

## Le schede di Protezione

| Scheda | A cosa serve |
|---|---|
| **Stato della protezione** | Questa pagina: il riepilogo di tutti gli strati. |
| [Porte presentate](pagine/protezione-porte.md) | Ogni porta su cui la macchina risponde, chi la tiene e chi la raggiunge. |
| [Chi può collegarsi](pagine/protezione-accessi.md) | Il filtro degli accessi: da quali indirizzi si arriva a quali porte. |
| [Utenti](pagine/protezione-utenti.md) | Chi può entrare in DA-IPAM, con quale ruolo e da dove. |
| [Sistemi remoti](pagine/protezione-sistemi.md) | Le connessioni aperte adesso, in entrata e in uscita. |
| [Moduli e container](pagine/protezione-moduli.md) | I container dei moduli, con immagini, porte e permessi. |
| [Esche](pagine/protezione-esche.md) | Finti servizi per scoprire chi esplora la rete. |
| [Tentativi e blocchi](pagine/protezione-tentativi.md) | Chi ha provato a entrare senza riuscirci, e i blocchi. |

Le prime sei si leggono e servono a capire; le ultime due, dopo la riga verticale, agiscono.

## La riga del filtro degli accessi

In cima a questa pagina e a quasi tutte le schede c'è la riga **Filtro degli accessi**: lo stato del filtro («acceso»,
«osserva», «non c'è ancora» o «non letto»), se l'installazione è protetta, quante porte rispondono a tutti e a che ora
sono stati letti i dati. Il filtro si governa in [Chi può collegarsi](pagine/protezione-accessi.md).

## I numeri

- **Da sistemare**: quante righe chiedono un intervento, e quante sono gravi.
- **A posto**: quante righe vanno bene.
- **Non letti**: i controlli che su questa macchina non si sono potuti fare (passa il mouse per la spiegazione).
- **Porte aperte a tutti**: quante porte rispondono a chiunque arrivi alla macchina.

## Il pannello «Cosa è chiuso e cosa resta debole»

Ogni riga è calcolata su questa macchina nel momento in cui si apre la pagina, e non mostra mai un valore segreto.

| Colonna | Che cosa dice |
|---|---|
| **Strato** | La parte della difesa (per esempio le porte, il filtro degli accessi, gli utenti, la chiave di cifratura). |
| **Stato** | Com'è adesso, col suo segno (vedi sotto). |
| **Cosa vuol dire** | La spiegazione in parole semplici. |
| **Gravità** | Quanto conta, con le tacche. |
| **Rimedio** | Cosa fare. Dove c'è un pulsante riquadrato, porta alla scheda o all'impostazione in cui si rimedia. |

In fondo al pannello una riga dice cosa la pagina **non controlla ancora**.

## Come si fa

- **Fare il punto della protezione**: leggi la riga del filtro, poi **Da sistemare**: le righe con ■ sono le prime da
  guardare.
- **Sistemare una riga**: premi il pulsante nella colonna **Rimedio**: porta alla scheda giusta. Poi torna qui e
  ricarica la pagina per rifare i controlli.
- **Capire un «non letto»**: il controllo non si è potuto fare su questa macchina. Su un'appliance completa i controlli
  si fanno tutti; su un computer di sviluppo molti restano «non letto».
- **Controllare chi entra**: scheda [Utenti](pagine/protezione-utenti.md), poi
  [Tentativi e blocchi](pagine/protezione-tentativi.md) per chi ci ha provato.

## Cosa vogliono dire i segni

- ■ grave.
- ▲ da sistemare.
- ○ a posto.
- ? non letto su questa macchina: il controllo non si è potuto fare. Non vuol dire che va bene.

## Da dove arrivano i dati

Controlli fatti in quel momento sulla macchina che ospita DA-IPAM. Nessun valore segreto viene letto a schermo.

## Se la pagina è vuota

La pagina non è mai vuota. Molte righe «non letto» di solito vogliono dire che DA-IPAM non gira su un'appliance
completa, dove quei controlli si possono fare.
