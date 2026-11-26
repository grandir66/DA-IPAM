---
percorso: /settings/classifications
titolo: Classificazioni del cliente — sotto-categorie personalizzate
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Le **classificazioni** dicono che tipo di apparato è un host: PC, switch, stampante, telecamera. DA-IPAM ne ha
un catalogo di serie, che non si cambia. Qui si aggiungono **sotto-categorie proprie** di una classificazione di
serie, per distinguere apparati che per il cliente sono diversi: per esempio «Server PostgreSQL» sotto «Server».
Una sotto-categoria prende icona e gruppo (la macro-categoria usata nei filtri e nei grafici) dalla classificazione
di serie da cui deriva.

Si arriva da **Config › Identificazione › Classificazioni del cliente ›** (la pagina sta sotto la scheda
Identificazione di [Impostazioni](pagine/settings.md#identificazione)). In alto a sinistra `tasto:chevron-left`
**Discovery** torna all'elenco degli [apparati](pagine/discovery.md). Le parti comuni (menu, schede, tabelle) sono
nelle [parti comuni dell'interfaccia](../INTERFACCIA.md).

## Le sotto-categorie del cliente

![Le sotto-categorie del cliente](/manuale/settings-classifications/pagina.png)

Il riquadro **Classification custom** elenca le sotto-categorie create per questo cliente. Senza nessuna si legge
«Nessuna classification custom».

1. `tasto:plus` **Aggiungi**: apre la finestra della nuova sotto-categoria (sotto).

Quando ci sono sotto-categorie, al posto della scritta compare la tabella:

| Colonna | Che cosa dice |
|---|---|
| **Label** | Il nome che si vede negli elenchi. |
| **Slug** | Il nome tecnico, salvato sugli host. |
| **Parent** | La classificazione di serie da cui deriva. |
| **Macro-categoria** | Il gruppo ereditato (Rete, Server, Postazioni…). |
| **Azioni** | `icona:pencil` **Modifica** label e classificazione di partenza; `icona:trash` **Elimina**, dopo una conferma. |

### La finestra della nuova sotto-categoria

![La finestra Nuova classification custom](/manuale/settings-classifications/nuova.png)

- **Label visibile**: il nome che si vedrà negli elenchi (per esempio «Server PostgreSQL»). Obbligatorio.
- **Slug**: il nome tecnico, in minuscolo con lettere, numeri e trattino basso, che comincia con una lettera. Si
  compila da solo dalla label. **Dopo la creazione non si cambia più** (nella modifica è segnato «non modificabile»),
  perché gli host lo usano.
- **Categoria parent (built-in)**: la classificazione di serie da cui eredita icona e macro-categoria.

**Crea** registra (in modifica il pulsante è **Salva**), **Annulla** chiude senza salvare. Se lo slug non va bene
compare l'avviso «Slug non valido».

Crea, Salva ed Elimina li esegue solo un amministratore: chi è in sola lettura vede i pulsanti, ma il programma
rifiuta la modifica.

## Il catalogo di serie

![Il catalogo delle classificazioni di serie](/manuale/settings-classifications/catalogo.png)

**Classification built-in (read-only)**: tutte le classificazioni che il programma conosce. Ogni riquadro ha il nome,
sotto il nome tecnico e a destra la macro-categoria (Rete, Server, Postazioni, Telefonia, Stampa, Videosorveglianza,
OT, IoT, Alimentazione, Multimedia, Archiviazione). Non si modifica: lo usano il riconoscimento automatico e le regole
di identificazione. **Non classificato** (`unknown`) è quella degli apparati ancora da decidere.

## Come si fa

- **Distinguere i server di database dagli altri server**: `tasto:plus` **Aggiungi**, Label «Server database»,
  Categoria parent **Server (Server)**, **Crea**. Poi in [Attribuzione](pagine/controllo-classificazione.md) assegna
  la nuova voce ai server giusti.
- **Correggere il nome di una sotto-categoria**: `icona:pencil` sulla sua riga, cambia la Label, **Salva**. Gli host
  che la usano mostrano subito il nome nuovo, perché lo slug non cambia.
- **Spostarla sotto un'altra classificazione di serie**: `icona:pencil`, cambia **Categoria parent**, **Salva**:
  cambiano icona e macro-categoria nei filtri.
- **Capire a che gruppo appartiene una classificazione di serie**: cercala nel catalogo e leggi l'etichetta a destra.

## Da dove arrivano i dati

Le sotto-categorie stanno nel database dell'istanza, una lista per cliente. Il catalogo di serie viene con il
programma.

## Se la pagina è vuota

«Nessuna classification custom» è normale: il catalogo di serie basta quasi sempre. Il riquadro delle
classificazioni di serie c'è sempre.
