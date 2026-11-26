---
percorso: /protezione/esche
titolo: Esche — finti servizi per scoprire chi esplora la rete
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Accende sulla macchina dei **finti servizi** che non servono a nessuno. Nessuno ha un motivo buono per collegarsi a
quelle porte: chi lo fa sta cercando qualcosa che non dovrebbe, e compare in
[Tentativi e blocchi](pagine/protezione-tentativi.md).

Si arriva dalla scheda **Esche** di **Sicurezza › Protezione**. Solo amministratori. Nessuna schermata nel manuale.

## Le voci della pagina

In cima una riga dice se le esche sono attive e come sono fatte: un servizio a parte, senza privilegi, e le password
provate non si conservano mai. **Risposte lente: sì / no** sceglie se far aspettare chi scansiona. **Applica** rende
vere le scelte: fino ad **Applica** niente cambia.

Il pannello **Finti servizi presentati alla rete** ha una riga per esca:

- **Esca** e **Porta**: quale servizio finge di essere e dove.
- **Cosa fa**: cosa risponde a chi si collega.
- **Adesso**: **accesa** o **spenta**.
- **Contatti (24 ore)**: quante volte qualcuno l'ha toccata.
- Il pulsante per accenderla o spegnerla.

Quando le scelte sono cambiate e non ancora applicate, in fondo compare «▲ Le scelte sono cambiate: premi «Applica»
per renderle vere».

## Come si usa

1. Premi **Accendi** sulle esche che vuoi, poi **Applica**.
2. Chi tocca un'esca compare in [Tentativi e blocchi](pagine/protezione-tentativi.md), con l'indirizzo e il nome
   provato.
3. Per spegnerle: **Spegni** su ognuna e **Applica**.

## Cosa vogliono dire i segni

- ● accesa.
- ○ spenta.
- ▲ scelta non ancora applicata.

## Da dove arrivano i dati

Un servizio a parte, senza privilegi, che non legge i dati di DA-IPAM. Delle password provate non resta niente.

## Se la pagina è vuota

Se **Applica** si rifiuta, la porta di quell'esca è già usata da un servizio vero su questa macchina: un'esca non
prende mai il posto di un servizio vero, e lì non si usa. Se la pagina dice che le esche non si possono accendere da
questa macchina, DA-IPAM non gira su un'appliance che lo permette.
