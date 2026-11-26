---
percorso: /settings/classifications
titolo: Classificazioni del cliente — sotto-categorie personalizzate
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Le **classificazioni** dicono che tipo di apparato è un host: PC, switch, stampante, telecamera. DA-IPAM ne ha
un catalogo di serie, che non si cambia. Qui si aggiungono **sotto-categorie proprie** di una classificazione di
serie, per distinguere apparati che per il cliente sono diversi: per esempio «Server PostgreSQL» sotto «Server».
Una sotto-categoria prende icona e gruppo (la macro-categoria usata nei filtri e nei grafici) dalla classificazione
di serie da cui deriva.

Si arriva da **Config › Identificazione › Classificazioni del cliente ›**. In alto a sinistra **Discovery** torna
all'elenco degli [apparati](pagine/discovery.md).

![La pagina Classificazioni](/manuale/settings-classifications/pagina.png)

## Le voci della pagina

1. **Aggiungi**: apre la finestra **Nuova classification custom**. Si scrivono:
   - **Label visibile**: il nome che si vedrà negli elenchi (per esempio «Server PostgreSQL»).
   - **Slug**: il nome tecnico, scritto in minuscolo con lettere, numeri e trattino basso, che comincia con una
     lettera. Si compila da solo dalla label. **Dopo la creazione non si cambia più**, perché gli host lo usano.
   - **Categoria parent (built-in)**: la classificazione di serie da cui eredita icona e macro-categoria.

   Poi **Salva**.
2. **Classification built-in (read-only)**: il catalogo di serie. Ogni riquadro ha il nome, il nome tecnico e, a
   destra, la macro-categoria (Rete, Server, Postazioni, Telefonia…). Non si modifica: lo usano il riconoscimento
   automatico e le regole di identificazione.

Quando ci sono sotto-categorie, sopra compare la loro tabella con **Label**, **Slug**, **Parent**, **Macro-categoria**
e **Azioni**: la matita modifica label e categoria di partenza, il cestino elimina.

## Come si usa

1. Premi **Aggiungi**, scrivi il nome, scegli la classificazione di serie di partenza, **Salva**.
2. La nuova classificazione compare fra quelle che si possono assegnare a un host, nella sua scheda o da
   [Attribuzione](pagine/controllo-classificazione.md).

## Da dove arrivano i dati

Le sotto-categorie stanno nel database dell'istanza, una lista per cliente. Il catalogo di serie viene con il
programma.

## Se la pagina è vuota

«Nessuna classification custom» è normale: il catalogo di serie basta quasi sempre. Il riquadro delle
classificazioni di serie c'è sempre.
