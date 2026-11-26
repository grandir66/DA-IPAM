---
percorso: /in-esecuzione
titolo: In esecuzione — scansioni e job che stanno girando
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Mostra le **scansioni e i job che stanno girando adesso**, quelli appena finiti e quelli falliti. Una scansione
continua anche se cambi pagina: da qui la ritrovi, la segui e, se serve, la fermi. Si arriva da **In esecuzione**
nella parte **Sistema** del menu; il numero rosso accanto alla voce dice quante attività sono in corso. Tabelle e
segni funzionano come nelle [parti comuni dell'interfaccia](../INTERFACCIA.md).

![La pagina In esecuzione](/manuale/in-esecuzione/pagina.png)

## Le voci della pagina

1. In cima tre riquadri: **In corso** (quante attività girano adesso), **Completate** e **Fallite** (negli ultimi 5
   minuti).
2. Sotto, il pannello **Attività** col numero delle righe. Senza niente in corso si legge «Nessuna attività in
   esecuzione». In fondo, la nota ricorda che l'elenco sta in memoria e un riavvio del servizio lo azzera.

Le colonne dell'elenco:

| Colonna | Che cosa dice |
|---|---|
| **Attività** | Che cosa sta girando (una scansione, un job programmato come «ARP Poll»). |
| **Dove** | La rete o gli apparati su cui lavora, con un collegamento alla loro pagina; «—» se non riguarda una rete. |
| **Fase** | A che punto è, o l'errore se è fallita (passa il mouse per leggerlo intero). «Job programmato» per i lavori partiti dalle schedulazioni. |
| **Avanzamento** | Quanto manca, quando si sa. |
| **Stato** | **▲ In corso**, **✓ Completata**, **✕ Fallita**, **Fermata**. |
| **Partita** | Quando è cominciata. |
| **Azioni** | **Apri** riporta alla pagina della scansione con il suo avanzamento. **Ferma** la interrompe (mentre si ferma si legge «Arresto…»): compare solo sulle attività che si possono fermare e solo a chi può farlo; chi è in sola lettura vede soltanto **Apri**. |

## Come si fa

- **Ritrovare una scansione dopo aver cambiato pagina**: apri **In esecuzione** dal menu e premi **Apri** sulla sua
  riga.
- **Fermare una scansione partita sulla rete sbagliata**: **Ferma** sulla sua riga; lo stato diventa **Fermata**.
- **Capire perché un'attività è fallita**: leggi la colonna **Fase**, che riporta l'errore; passa il mouse se è
  tagliato.
- **Sapere se il server sta lavorando prima di un riavvio**: guarda il riquadro **In corso**: a 0 non gira niente.
- **Vedere quando ripartirà un job**: gli orari stanno in [Schedulazioni](pagine/settings-schedulazioni.md).

## Cosa vogliono dire i segni

- **▲ In corso** (giallo), **✓ Completata** (verde), **✕ Fallita** (rosso), **Fermata** (grigio).

## Da dove arrivano i dati

Dall'elenco delle attività tenuto in memoria dal servizio: un riavvio lo azzera. Gli orari dei lavori programmati
stanno in [Schedulazioni](pagine/settings-schedulazioni.md); lo storico delle scansioni in [Scansioni](pagine/scans.md).

## Se la pagina è vuota

«Nessuna attività in esecuzione» vuol dire che in questo momento non gira niente: le scansioni avviate da
qualunque pagina, e quelle programmate, compaiono qui appena partono.
