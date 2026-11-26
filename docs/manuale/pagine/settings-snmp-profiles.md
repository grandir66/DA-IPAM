---
percorso: /settings/snmp-profiles
titolo: Profili SNMP Vendor — come si riconoscono e si leggono gli apparati via SNMP
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Un **profilo SNMP** dice a DA-IPAM come riconoscere un apparato di un certo produttore (per esempio uno switch
Aruba o un firewall Fortinet) dalle risposte SNMP, e quali dati leggergli: modello, numero di serie, firmware. È la
prima fase del riconoscimento (vedi **Config › Identificazione › Pipeline** nella guida
[Impostazioni e Config](pagine/settings.md#identificazione)). Si arriva da **Config › Identificazione › Profili SNMP
dei vendor ›**. In alto a sinistra **Impostazioni** torna indietro. Le parti comuni
sono nelle [parti comuni dell'interfaccia](../INTERFACCIA.md).

## La libreria OID

![La libreria OID](/manuale/settings-snmp-profiles/libreria.png)

**Libreria OID (file)**: i file con gli identificativi SNMP che stanno sul server, nella cartella della libreria: un
file comune per gli identificativi di base (`common.json`), un file per categoria di apparato e un file per profilo
per gli elenchi lunghi. La tabella dice **Tipo** (comuni, categoria, dispositivo), **File** e **Dettaglio** (la
categoria o il profilo a cui vale). Sopra la tabella, **Revisione file** cambia quando cambia un file.

1. `tasto:refresh` **Aggiorna elenco** rilegge la cartella: i file nuovi compaiono da soli.

## La barra dei profili

![La barra dei profili](/manuale/settings-snmp-profiles/barra.png)

Il titolo **Profili (N)** dice quanti profili ci sono.

1. `tasto:download` **Esporta JSON**: scarica tutti i profili in un file.
2. **Esporta in cartelle**: scrive sul server una cartella con un file per profilo (e per categoria), più un elenco
   riassuntivo; serve a chi mantiene la libreria.
3. `tasto:upload` **Importa**: apre la finestra **Importa profili SNMP**, dove si sceglie un file JSON; con la casella
   per **sovrascrivere i profili esistenti** quelli con lo stesso ID vengono rimpiazzati (mai quelli di serie).
4. `tasto:rotate-ccw` **Reset Builtin**: rimette i profili di serie come erano, perdendo le modifiche fatte a quelli.
5. `tasto:plus` **Nuovo profilo**: crea un profilo. I campi: **ID Profilo** (solo lettere minuscole, numeri,
   trattino e trattino basso), nome, **Categoria**, **Confidenza (0-1)** (quanto è sicuro il riconoscimento),
   **Prefissi OID Enterprise** (gli identificativi del produttore; `tasto:plus` ne aggiunge un altro), **Pattern
   sysDescr** (un'espressione sulla descrizione dell'apparato, facoltativa), **Campi OID** (i dati da leggere, ognuno
   col suo identificativo; `icona:trash` toglie un campo) e **Abilitato**.
6. `icona:search` **Cerca per ID, nome o OID…**, con accanto il menu **Tutte le categorie**: filtrano l'elenco.
7. **Mostra builtin**: mostra o nasconde i profili di serie.

Importare, esportare in cartelle, creare, cambiare ed eliminare spetta all'amministratore: chi è in sola lettura vede
i pulsanti, ma il programma rifiuta la modifica.

## L'elenco dei profili

![Le righe dei profili](/manuale/settings-snmp-profiles/riga.png)

1. `icona:chevron-right` apre il dettaglio (`icona:chevron-down` lo chiude): prefissi OID, pattern, **Campi salvati
   nel database**, **OID effettivi a runtime** (quelli presi anche dai file della libreria, che vincono su quelli del
   database), note.
2. La levetta accende o spegne il profilo; un profilo spento è sbiadito.
3. `icona:copy` **Copia JSON**: copia il profilo, per incollarlo altrove (diventa `icona:check` per un attimo).
4. `icona:pencil` **Modifica**: apre la stessa finestra di Nuovo profilo. I profili non di serie hanno anche
   `icona:trash` **Elimina**.

In mezzo: nome, etichetta **builtin** se è di serie, ID; a destra la categoria, quanti OID e quanti campi ha, la
confidenza in percentuale.

## Come si fa

- **Un apparato non viene riconosciuto**: cerca il produttore con `icona:search`. Se il profilo c'è, aprilo con
  `icona:chevron-right` e controlla i prefissi OID; se non c'è, `tasto:plus` **Nuovo profilo**.
- **Leggere il seriale di un modello che non lo dà**: `icona:pencil` sul profilo, aggiungi in **Campi OID** il campo
  col suo identificativo, salva. Gli apparati già trovati si aggiornano alla scansione successiva.
- **Portare i profili su un'altra installazione**: `tasto:download` **Esporta JSON** qui, `tasto:upload` **Importa**
  là.
- **Escludere un profilo che riconosce male**: spegni la sua levetta, invece di eliminarlo.
- **Tornare ai profili di serie dopo prove sbagliate**: `tasto:rotate-ccw` **Reset Builtin**.

## Da dove arrivano i dati

I profili stanno nel database dell'hub e valgono per tutte le istanze; quelli di serie vengono con il programma.
La libreria OID è una cartella di file sul server.

## Se la pagina è vuota

«Nessun profilo trovato» con un filtro scelto: toglilo o accendi **Mostra builtin**.
