---
percorso: /inventory/licenses
titolo: Licenze software
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Tiene il registro delle **licenze software** (Office, antivirus, sistemi operativi, gestionali) con quanti posti hanno,
quanti ne sono usati e quando scadono. Ogni posto si assegna a un asset dalla [scheda dell'asset](pagine/inventory-id.md).
Si arriva da **Inventario › Licenze** nel menu. La pagina non ha schede in cima, filtri né ricerca.

Le parti che si ripetono in tutte le pagine sono nelle [parti comuni dell'interfaccia](../INTERFACCIA.md).

## La testata e l'elenco

![La testata e l'elenco delle licenze](/manuale/inventory-licenses/testata.png)

1. `icona:arrow-left` torna ad [Asset](pagine/inventory.md).
2. `tasto:plus` **Nuova licenza**: apre la finestra per registrarne una (sotto).

Il titolo dell'elenco dice quante licenze ci sono («Elenco (12)»). Le colonne:

| Colonna | Che cosa dice |
|---|---|
| **Nome** | Il nome della licenza. |
| **Categoria** | Office, Antivirus… come l'ha scritta chi l'ha registrata. |
| **Posti** | Usati / totali, per esempio «8 / 10». Quando i posti liberi finiscono il numero diventa rosso e compare **Esaurita**. |
| **Scadenza** | La data di fine della licenza. |

In fondo alla riga:

- `icona:pencil` apre la stessa finestra come **Modifica licenza**;
- `icona:trash` elimina la licenza **insieme a tutte le sue assegnazioni**, dopo una conferma.

## La finestra Nuova licenza

![La finestra Nuova licenza](/manuale/inventory-licenses/nuova.png)

- **Nome** (obbligatorio).
- **Seriale**: il codice della licenza.
- **Numero posti**: quanti asset la possono usare (almeno 1).
- **Categoria**: testo libero (Office, Antivirus…).
- **Scadenza**: la data di fine.
- **Prezzo acquisto (€)**.
- **Soglia alert posti liberi**: sotto questo numero di posti liberi la licenza va tenuta d'occhio.
- **Note**.

**Crea** salva (in modifica: **Salva**); la finestra si chiude con `icona:x`. Creare, modificare ed eliminare cambia i
dati: riesce solo a un amministratore.

## Come si fa

- **Registrare dieci licenze Office**: `tasto:plus` Nuova licenza, nome, **Numero posti** 10, scadenza, **Crea**.
- **Dare un posto a un PC**: apri la [scheda dell'asset](pagine/inventory-id.md), scheda **Licenze**, tendina **Assegna
  licenza…**: un posto passa da libero a usato.
- **Liberare un posto**: nella stessa scheda, `icona:trash` sulla riga della licenza.
- **Una licenza è Esaurita e serve un posto in più**: `icona:pencil`, aumenta **Numero posti**, **Salva**.
- **Rinnovo annuale**: `icona:pencil`, nuova **Scadenza**, **Salva**.

## Cosa vogliono dire i segni

- **Esaurita** (grigio) con il numero rosso: tutti i posti sono assegnati; per assegnarla a un altro asset bisogna
  liberarne uno o aumentare i posti.

## Da dove arrivano i dati

Le licenze le inserisce una persona; i posti usati si contano dalle assegnazioni fatte nelle schede degli asset.

## Se la pagina è vuota

«Nessuna licenza» vuol dire che non ne è stata registrata nessuna: premi `tasto:plus` **Nuova licenza**. Attenzione: la
pagina mostra l'elenco vuoto anche quando i dati non arrivano (per esempio con la connessione caduta); se sai che ci
sono licenze, ricarica la pagina.
