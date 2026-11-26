---
percorso: /inventory/locations
titolo: Ubicazioni — sedi, edifici, rack
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Elenca i **luoghi fisici** dove stanno gli asset: sedi, edifici, piani, sale server, rack. Un'ubicazione può stare
dentro un'altra (il rack dentro la sala, la sala dentro la sede), così si costruisce un albero. Le ubicazioni si
scelgono poi nella [scheda dell'asset](pagine/inventory-id.md), campo **Ubicazione**. Si arriva da **Inventario ›
Ubicazioni** nel menu; la freccia in alto a sinistra torna ad [Asset](pagine/inventory.md).

![La pagina Ubicazioni](/manuale/inventory-locations/pagina.png)

## Le voci della pagina

1. **Nuova ubicazione**: apre la finestra con **Nome** (obbligatorio), **Indirizzo** e **Parent (opzionale)**, cioè
   l'ubicazione che la contiene. **Annulla** chiude senza salvare.

Le colonne dell'elenco, quando ci sono ubicazioni:

- **Nome**, **Indirizzo**, **Parent** (l'ubicazione che la contiene, o il trattino se è di primo livello).
- In fondo alla riga:
  - **Mappa** (solo per le ubicazioni di primo livello, cioè le sedi): apre la mappa degli apparati di rete di quella
    sede, con i collegamenti fra loro.
  - La **matita** apre la modifica.
  - Il **cestino** elimina l'ubicazione, dopo una conferma.

## Come si usa

1. Crea prima le sedi (senza Parent), poi le sale o i rack con la sede come Parent.
2. Nella [scheda di ogni asset](pagine/inventory-id.md) scegli l'ubicazione giusta. Dalla Scheda NIS2 il **+** accanto
   al campo ne crea una senza venire qui.
3. Per vedere come sono collegati gli apparati di una sede premi **Mappa**.

## Da dove arrivano i dati

Le ubicazioni le inserisce una persona. La mappa di una sede usa i collegamenti fra apparati letti dalla topologia.

## Se la pagina è vuota

«Nessuna ubicazione» vuol dire che non ne è stata inserita nessuna: premi **Nuova ubicazione**.
