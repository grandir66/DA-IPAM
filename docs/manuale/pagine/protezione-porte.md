---
percorso: /protezione/porte
titolo: Porte presentate — cosa risponde sulla macchina e a chi
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Elenca **ogni porta su cui la macchina di DA-IPAM risponde**, chi la tiene (DA-IPAM, un modulo, un container, un
servizio di sistema) e chi oggi la può raggiungere. Serve a scoprire porte aperte più del necessario o servizi che
nessuno riconosce. La pagina si guarda soltanto: chi può raggiungere cosa si decide in
[Chi può collegarsi](pagine/protezione-accessi.md).

Si arriva dalla scheda **Porte presentate** di **Sicurezza › Protezione** (le schede sono descritte in
[Stato della protezione](pagine/protezione.md)). Solo amministratori. Nessuna schermata nel manuale.

## Le voci della pagina

In cima la riga **Filtro degli accessi** (vedi [Stato della protezione](pagine/protezione.md)) e quattro numeri:
**Porte presentate**, **Aperte a tutti**, **Anche in IPv6** (aperte a tutti anche sugli indirizzi IPv6), **Non
attribuite** (porte in ascolto che DA-IPAM non sa di chi sono; passa il mouse per la spiegazione).

**1. Schede di rete**: gli indirizzi con cui la macchina si presenta, una riga per scheda. Quella del collegamento di
gestione porta l'etichetta **NetBird · regole di DA-Link**.

**2. Porte presentate**: cosa risponde su questa macchina e a chi.

| Colonna | Che cosa dice |
|---|---|
| **Porta** | Numero e protocollo. |
| **Gruppo** | Il gruppo di porte a cui appartiene (lo stesso usato dal filtro degli accessi), oppure **Non attribuita**. |
| **Chi la tiene** | Il programma che ascolta; «(container)» se è pubblicata da un container. |
| **Modulo** | Il modulo di DA-IPAM a cui appartiene, se c'è. |
| **Ascolta su** | Su quali indirizzi della macchina. |
| **Oggi la raggiunge** | ● **Tutti**, ◐ **Solo NetBird** o ○ **Solo la macchina**; ▲ **Tutti** se la porta dovrebbe restare interna o non è attribuita. |

In fondo al pannello la legenda dei segni.

## Come si fa

- **Trovare le porte aperte a chiunque**: guarda le righe con **Tutti** nella colonna **Oggi la raggiunge**.
- **Scoprire un servizio sconosciuto**: le righe **Non attribuita** sono porte che DA-IPAM non sa di chi sono: **Chi la
  tiene** dice quale programma ascolta.
- **Chiudere una porta che serve solo dentro la macchina**: annota il suo **Gruppo** e vai in
  [Chi può collegarsi](pagine/protezione-accessi.md) a togliere gli indirizzi da quel gruppo.
- **Sapere a quale modulo appartiene una porta**: colonna **Modulo**; i container si vedono anche in
  [Moduli e container](pagine/protezione-moduli.md).

## Cosa vogliono dire i segni

- ● aperta a tutti.
- ◐ solo NetBird.
- ○ solo la macchina, a posto.
- ▲ da guardare.

## Da dove arrivano i dati

Le porte in ascolto della macchina e quelle pubblicate dai container, lette quando si apre la pagina.

## Se la pagina è vuota

Senza l'elenco delle porte la pagina dice «Porte in ascolto: non letto»: succede quando DA-IPAM non gira su
un'appliance.
