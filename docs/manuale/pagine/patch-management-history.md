---
percorso: /patch-management/history
titolo: Storico operazioni — tutto quello che è stato fatto sugli host
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È il **registro delle operazioni** del Patch Management: verifiche, installazioni di Chocolatey, aggiornamenti,
disinstallazioni. Non si modifica e non si cancella. Serve a sapere cosa è stato fatto, su quale host, da chi e com'è
andata, e a leggere il log di un'operazione fallita.

Si arriva dalla scheda **Storico** in cima al [Patch Management](pagine/patch-management.md) o da `tasto:history`
**Storico operazioni** in [CVE rilevate](pagine/patch-management-cve.md). Le parti che si ripetono in tutte le pagine
sono nelle [parti comuni dell'interfaccia](../INTERFACCIA.md). Le immagini del manuale nascondono i nomi degli host.

## La barra e i filtri

![La barra e i filtri dello Storico](/manuale/patch-management-history/filtri.png)

Sotto il titolo, **← Torna a Patch Management** riporta alla Panoramica; accanto, quante operazioni ci sono e la
pagina.

1. `tasto:refresh` **Aggiorna**: ricarica l'elenco.
2. `icona:search` **Cerca host (hostname / IP)**: filtra per host.
3. **CVE**: filtra per codice della vulnerabilità.
4. **Status**: Tutti, In coda, In corso, Successo, Fallita, Riavvio richiesto, Annullata.
5. **Azione**: Tutte, Probe, Bootstrap, Upgrade, Install, Uninstall, Rollback.
6. **Dal**: la data da cui partire.
7. **Solo le mie**: lascia solo le operazioni lanciate da te.

Con un filtro attivo compare **Reset**, che li toglie tutti.

## La tabella

![L'elenco delle operazioni](/manuale/patch-management-history/tabella.png)

| Colonna | Che cosa dice |
|---|---|
| **Data** | Da quanto tempo, e sotto la data esatta (passa il mouse per leggerla intera). |
| **Host** | Il nome e l'indirizzo dell'host. |
| **Azione** | Probe, Bootstrap, Upgrade, Install, Uninstall, Rollback. |
| **Pacchetto / CVE** | Il pacchetto Chocolatey e la CVE per cui è stata lanciata, se c'è. |
| **Status** | L'esito; una riga che chiede un riavvio porta anche **Riavvio necessario**. |
| **Durata** | Quanto è durata. |

**Precedente** e **Successiva** sfogliano le pagine. La pagina non ha il menu `icona:more-vertical`, il tasto destro né
la selezione: è un registro da leggere.

## Il dettaglio di un'operazione

![Il dettaglio di un'operazione](/manuale/patch-management-history/dettaglio.png)

Un clic su una riga apre la finestra con l'host in cima e poi **Status**, **Azione**, **Avviata**, **Conclusa**,
**Durata**, **Utente** («Automatico» se l'ha lanciata un'operazione programmata), **Pacchetto**, **Riavvio
necessario**, **Messaggio errore** (se è fallita, spesso con il suggerimento per risolvere) e **Output**, il registro
completo restituito dall'host. **Chiudi** o `icona:x` chiudono la finestra.

## Come si fa

- **Vedere cosa non è andato stanotte**: **Status** › Fallita, **Dal** › la data di ieri.
- **Capire perché un aggiornamento è fallito**: apri la riga, leggi **Messaggio errore** e **Output**.
- **Sapere quali host vanno riavviati**: **Status** › Riavvio richiesto.
- **Ricostruire tutto quello che è stato fatto su un PC**: scrivi il nome in **Cerca host**.
- **Controllare il lavoro fatto per una CVE**: scrivi il codice nel filtro **CVE**.

## Cosa vogliono dire i segni

- **Successo** (con il codice di uscita), **Fallita**, **In coda**, **In corso**, **Riavvio richiesto**, **Annullata**:
  l'esito dell'operazione.

## Da dove arrivano i dati

Ogni operazione lanciata dalle pagine del Patch Management, a mano o programmata, viene registrata qui con il log
restituito dall'host.

## Se la pagina è vuota

**Nessuna operazione trovata**: non è ancora stata lanciata nessuna operazione, oppure i filtri sono troppo stretti.
Premi **Reset**.
