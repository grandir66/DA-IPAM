---
percorso: /protezione/esche
titolo: Esche — finti servizi per scoprire chi esplora la rete
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Accende sulla macchina dei **finti servizi** che non servono a nessuno. Nessuno ha un motivo buono per collegarsi a
quelle porte: chi lo fa sta cercando qualcosa che non dovrebbe, e compare in
[Tentativi e blocchi](pagine/protezione-tentativi.md).

Si arriva dalla scheda **Esche** di **Sicurezza › Protezione** (le schede sono descritte in
[Stato della protezione](pagine/protezione.md)). Solo amministratori. Nessuna schermata nel manuale.

Le scelte si fanno qui e si applicano con un pulsante solo: finché non si preme **Applica** niente cambia.

## La riga delle esche

**Esche** dice se sono spente, accese (e quante) o accese con il servizio fermo, e come sono fatte: un servizio a
parte, senza privilegi, e le password provate non si conservano mai. A destra:

- **Risposte lente: sì / no**: sceglie se far aspettare chi scansiona; un clic cambia la scelta;
- **Applica**: rende vere le scelte. È spento finché non c'è niente da applicare.

## Il pannello «Finti servizi presentati alla rete»

| Colonna | Che cosa dice |
|---|---|
| **Esca** | Quale servizio finge di essere. |
| **Porta** | Dove risponde. |
| **Cosa fa** | Cosa risponde a chi si collega. |
| **Adesso** | ● **accesa**, ○ **spenta**, oppure ▲ **da accendere** / **da spegnere** se la scelta non è ancora applicata. |
| **Contatti (24 ore)** | Quante volte qualcuno l'ha toccata. |
| (pulsante) | **Accendi** o **Spegni**: cambia la scelta, che vale dopo **Applica**. |

In fondo, quando le scelte sono cambiate, compare «▲ Le scelte sono cambiate: premi «Applica» per renderle vere».

## Come si fa

- **Accendere le esche**: **Accendi** sulle esche che vuoi, poi **Applica**.
- **Vedere chi le ha toccate**: guarda **Contatti (24 ore)**, poi [Tentativi e blocchi](pagine/protezione-tentativi.md)
  per l'indirizzo e il nome provato.
- **Rallentare chi scansiona**: **Risposte lente: no** diventa **sì** con un clic, poi **Applica**.
- **Spegnere un'esca**: **Spegni** sulla sua riga e **Applica**.

## Cosa vogliono dire i segni

- ● accesa.
- ○ spenta.
- ▲ scelta non ancora applicata.

## Da dove arrivano i dati

Un servizio a parte, senza privilegi, che non legge i dati di DA-IPAM. Delle password provate non resta niente.

## Se la pagina è vuota

Se **Applica** si rifiuta, la porta di quell'esca è già usata da un servizio vero su questa macchina: un'esca non
prende mai il posto di un servizio vero, e il messaggio dice quale. Se la pagina dice **Le esche non si possono
accendere da questa macchina**, DA-IPAM non gira su un'appliance che lo permette.
