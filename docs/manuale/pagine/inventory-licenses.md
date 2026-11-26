---
percorso: /inventory/licenses
titolo: Licenze software
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Tiene il registro delle **licenze software** (Office, antivirus, sistemi operativi, gestionali) con quanti posti hanno,
quanti ne sono usati e quando scadono. Ogni posto si assegna a un asset dalla scheda dell'asset. Si arriva da
**Inventario › Licenze** nel menu; la freccia in alto a sinistra torna ad [Asset](pagine/inventory.md).

![La pagina Licenze](/manuale/inventory-licenses/pagina.png)

## Le voci della pagina

1. **Nuova licenza**: apre la finestra per registrarne una. I campi sono **Nome** (obbligatorio), **Seriale**,
   **Numero posti**, **Categoria** (testo libero: Office, Antivirus…), **Scadenza**, **Prezzo acquisto (€)**, **Soglia
   alert posti liberi** (sotto questo numero di posti liberi la licenza va tenuta d'occhio), **Note**.

Le colonne dell'elenco, quando ci sono licenze:

- **Nome** e **Categoria**.
- **Posti**: usati / totali, per esempio «8 / 10». Quando i posti liberi finiscono il numero diventa rosso e compare il
  segno **Esaurita**.
- **Scadenza**: la data di fine della licenza.
- In fondo alla riga, la **matita** apre la modifica e il **cestino** elimina la licenza insieme a tutte le sue
  assegnazioni.

## Come si usa

1. Premi **Nuova licenza**, scrivi nome, numero di posti e scadenza, salva.
2. Apri la [scheda dell'asset](pagine/inventory-id.md) che usa la licenza, scheda **Licenze**, e scegli la licenza dal
   menu **Assegna licenza…**: un posto passa da libero a usato.
3. Per liberare un posto, nella stessa scheda premi il cestino sulla riga della licenza.

## Cosa vogliono dire i segni

- **Esaurita**: tutti i posti sono assegnati; per assegnarla a un altro asset bisogna liberarne uno o aumentare i posti.

## Da dove arrivano i dati

Le licenze le inserisce una persona; i posti usati si contano dalle assegnazioni fatte nelle schede degli asset.

## Se la pagina è vuota

«Nessuna licenza» vuol dire che non ne è stata registrata nessuna: premi **Nuova licenza**.
