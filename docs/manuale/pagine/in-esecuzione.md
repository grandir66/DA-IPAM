---
percorso: /in-esecuzione
titolo: In esecuzione — scansioni e job che stanno girando
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Mostra le **scansioni e i job che stanno girando adesso**, quelli appena finiti e quelli falliti. Una scansione
continua anche se cambi pagina: da qui la ritrovi, la segui e, se serve, la fermi. Si arriva da **In esecuzione**
nella parte **Sistema** del menu; il numero rosso accanto alla voce dice quante attività sono in corso.

![La pagina In esecuzione](/manuale/in-esecuzione/pagina.png)

## Le voci della pagina

In cima tre riquadri: **In corso** (quante attività girano adesso), **Completate** e **Fallite** (negli ultimi 5
minuti).

Sotto, l'elenco **Attività**:

- **Attività**: che cosa sta girando (una scansione, un job programmato come «ARP Poll»).
- **Dove**: la rete o gli apparati su cui lavora; «—» se non riguarda una rete.
- **Fase**: a che punto è, o l'errore se è fallita. «Job programmato» per i lavori partiti dalle schedulazioni.
- **Avanzamento**: quanto manca, quando si sa.
- **Stato**: **▲ In corso**, **✓ Completata**, **✕ Fallita**, **Fermata**.
- **Partita**: quando è cominciata.
- **Azioni**: **Apri** riporta alla pagina della scansione con il suo avanzamento; **Ferma** la interrompe (mentre
  si ferma si legge «Arresto…»).

## Come si usa

1. Hai avviato una scansione e hai cambiato pagina: torna qui e premi **Apri** per rivederla.
2. Una scansione sta durando troppo o è partita sulla rete sbagliata: **Ferma**.
3. Un'attività è fallita: leggi la colonna **Fase**, che riporta l'errore.

## Cosa vogliono dire i segni

- **▲ In corso** (giallo), **✓ Completata** (verde), **✕ Fallita** (rosso), **Fermata** (grigio).

## Da dove arrivano i dati

Dall'elenco delle attività tenuto in memoria dal servizio: un riavvio lo azzera. Gli orari dei lavori programmati
stanno in [Schedulazioni](pagine/settings-schedulazioni.md); lo storico delle scansioni in [Scansioni](pagine/scans.md).

## Se la pagina è vuota

«Nessuna attività in esecuzione» vuol dire che in questo momento non gira niente: le scansioni avviate da
qualunque pagina, e quelle programmate, compaiono qui appena partono.
