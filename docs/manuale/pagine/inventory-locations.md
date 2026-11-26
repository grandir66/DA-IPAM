---
percorso: /inventory/locations
titolo: Ubicazioni — sedi, edifici, rack
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Elenca i **luoghi fisici** dove stanno gli asset: sedi, edifici, piani, sale server, rack. Un'ubicazione può stare
dentro un'altra (il rack dentro la sala, la sala dentro la sede), così si costruisce un albero. Le ubicazioni si
scelgono poi nella [scheda dell'asset](pagine/inventory-id.md), campo **Ubicazione**. Per le sedi si dice anche quale
apparato fa da testa e quali reti ne fanno parte. Si arriva da **Inventario › Ubicazioni** nel menu. La pagina non ha
schede in cima, filtri né ricerca.

Le parti che si ripetono in tutte le pagine sono nelle [parti comuni dell'interfaccia](../INTERFACCIA.md).

## La testata e l'elenco

![La testata e l'elenco delle ubicazioni](/manuale/inventory-locations/elenco.png)

1. `icona:arrow-left` torna ad [Asset](pagine/inventory.md).
2. `tasto:plus` **Nuova ubicazione**: apre la finestra per crearne una (sotto).

Il titolo dell'elenco dice quante sono («4 ubicazioni»). Le colonne:

| Colonna | Che cosa dice |
|---|---|
| **Nome** | Il nome dell'ubicazione. |
| **Indirizzo** | L'indirizzo, se scritto. |
| **Parent** | L'ubicazione che la contiene, o il trattino se è di primo livello (una sede). |

In fondo alla riga:

- **Mappa**, solo per le ubicazioni di primo livello: apre la finestra della sede (sotto);
- `icona:pencil` apre la stessa finestra di creazione come **Modifica ubicazione**;
- `icona:trash` elimina l'ubicazione, dopo una conferma.

## La finestra Nuova ubicazione

![La finestra Nuova ubicazione](/manuale/inventory-locations/nuova.png)

- **Nome** (obbligatorio).
- **Indirizzo**: per esempio «Via X, Città».
- **Parent (opzionale)**: l'ubicazione che la contiene; **— Nessuno** per una sede.

**Crea** salva (in modifica: **Salva**), **Annulla** chiude senza salvare.

## La finestra Mappa della sede

Si apre con **Mappa** su una sede e si intitola «Mappa — nome della sede».

- **Apparato di testa**: l'apparato da cui parte la rete della sede (di solito il router o il firewall), scelto fra i
  dispositivi gestiti. Se nessuno l'ha ancora scelto, sotto c'è la **Proposta del sistema**: il gateway di una o più
  reti della sede. Se l'ha scelto una persona, c'è chi e quando.
- **Subnet della sede**: le reti, con una casella per ciascuna; si spuntano quelle che stanno in questa sede. Una rete
  già assegnata a un'altra sede lo dice («— ora in …»).

**Salva** registra la scelta, **Chiudi** esce senza cambiare. Queste scelte servono alla [mappa](pagine/topology.md) per
disegnare le sedi.

Creare, modificare, eliminare e salvare la mappa cambia i dati: riesce solo a un amministratore.

## Come si fa

- **Costruire l'albero dei luoghi**: prima le sedi (Parent **— Nessuno**), poi le sale o i rack con la sede come Parent.
- **Mettere un server nel suo rack**: [scheda dell'asset](pagine/inventory-id.md), campo **Ubicazione**. Dalla Scheda
  NIS2 `tasto:plus` accanto al campo crea un'ubicazione senza venire qui.
- **Dire quali reti sono della filiale**: **Mappa** sulla riga della filiale, spunta le subnet, **Salva**.
- **Correggere l'apparato di testa proposto**: **Mappa**, tendina **Apparato di testa**, **Salva**.
- **Spostare una sala sotto un'altra sede**: `icona:pencil`, cambia **Parent**, **Salva**.

## Da dove arrivano i dati

Le ubicazioni le inserisce una persona. La proposta dell'apparato di testa viene dai gateway delle reti della sede.

## Se la pagina è vuota

«Nessuna ubicazione» vuol dire che non ne è stata inserita nessuna: premi `tasto:plus` **Nuova ubicazione**.
