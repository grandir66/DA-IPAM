---
percorso: /protezione/porte
titolo: Porte presentate — cosa risponde sulla macchina e a chi
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Elenca **ogni porta su cui la macchina di DA-IPAM risponde**, chi la tiene (DA-IPAM, un modulo, un container, un
servizio di sistema) e chi oggi la può raggiungere. Serve a scoprire porte aperte più del necessario o servizi che
nessuno riconosce. Per ora la pagina si guarda soltanto: chi può raggiungere cosa si decide in
[Chi può collegarsi](pagine/protezione-accessi.md).

Si arriva dalla scheda **Porte presentate** di **Sicurezza › Protezione**. Solo amministratori. Nessuna schermata nel
manuale.

## Le voci della pagina

In cima quattro numeri: **Porte presentate**, **Aperte a tutti**, **Anche in IPv6**, **Non attribuite** (porte in
ascolto che DA-IPAM non sa di chi sono).

Due riquadri di contesto:

- **Schede di rete**: gli indirizzi con cui la macchina si presenta.
- **NetBird · regole di DA-Link**: come arriva il collegamento di gestione attraverso NetBird.

Il pannello **Porte presentate** (cosa risponde su questa macchina e a chi) ha le colonne:

- **Porta**: numero e protocollo.
- **Gruppo**: il gruppo di porte a cui appartiene (lo stesso usato dal filtro degli accessi), oppure **Non
  attribuita**.
- **Chi la tiene**: il programma che ascolta; «(container)» se è pubblicata da un container.
- **Modulo**: il modulo di DA-IPAM a cui appartiene, se c'è.
- **Ascolta su**: su quali indirizzi della macchina.
- **Oggi la raggiunge**: **Tutti**, **Solo NetBird** o **Solo la macchina**.

## Come si usa

1. Guarda prima le righe **Tutti**: sono le porte aperte a chiunque arrivi alla macchina.
2. Una porta che serve solo dentro la macchina ma risulta aperta a tutti è da chiudere.
3. Una porta **Non attribuita** è un servizio che DA-IPAM non conosce: va capito di chi è.
4. Per decidere chi può arrivare a un gruppo di porte, vai in [Chi può collegarsi](pagine/protezione-accessi.md).

## Cosa vogliono dire i segni

- ● aperta a tutti.
- ◐ solo NetBird.
- ○ solo la macchina.
- ▲ da guardare.

## Da dove arrivano i dati

Le porte in ascolto della macchina e quelle pubblicate dai container, lette quando si apre la pagina.

## Se la pagina è vuota

Senza l'elenco delle porte la pagina dice «non letto»: succede solo quando DA-IPAM non gira su un'appliance.
