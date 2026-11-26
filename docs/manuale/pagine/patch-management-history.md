---
percorso: /patch-management/history
titolo: Storico operazioni — tutto quello che è stato fatto sugli host
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È il **registro delle operazioni** del Patch Management: verifiche, installazioni di Chocolatey, aggiornamenti,
disinstallazioni. Non si modifica e non si cancella. Serve a sapere cosa è stato fatto, su quale host, da chi e com'è
andata, e a leggere il log di un'operazione fallita.

Si arriva dalla scheda **Storico** del [Patch Management](pagine/patch-management.md) o da **Storico operazioni** in
[CVE rilevate](pagine/patch-management-cve.md). In alto a destra quante operazioni, la pagina e **Aggiorna**.

![Lo Storico operazioni](/manuale/patch-management-history/pagina.png)

## Le voci della pagina

1. **Cerca host (hostname / IP)**: filtra per host. Accanto, **CVE** filtra per codice della vulnerabilità.
2. **Solo le mie**: lascia solo le operazioni lanciate da te.
3. **Status**: l'esito di ogni operazione.

Gli altri filtri:

- **Status**: **Tutti**, **In coda**, **In corso**, **Successo**, **Fallita**, **Riavvio richiesto**, **Annullata**.
- **Azione**: **Tutte**, **Probe**, **Bootstrap**, **Upgrade**, **Install**, **Uninstall**, **Rollback**.
- **Dal**: la data da cui partire.

Colonne: **Data** (da quanto tempo, e la data esatta), **Host**, **Azione**, **Pacchetto / CVE**, **Status**,
**Durata**. Una riga che chiede un riavvio porta **Riavvio necessario**. **Precedente** e **Successiva** sfogliano.

## Il dettaglio di un'operazione

Un clic su una riga apre la finestra con **Status**, **Azione**, **Avviata**, **Conclusa**, **Durata**, **Utente**,
**Pacchetto**, **Riavvio necessario**, **Messaggio errore** (se è fallita) e il **log** completo dell'operazione.

## Come si usa

1. Filtra **Status › Fallita** per vedere cosa non è andato.
2. Apri la riga e leggi **Messaggio errore** e il log.
3. Filtra **Riavvio richiesto** per sapere quali host vanno riavviati per completare un aggiornamento.

## Cosa vogliono dire i segni

- **Successo** (con il codice di uscita), **Fallita**, **In coda**, **In corso**, **Riavvio richiesto**, **Annullata**:
  l'esito dell'operazione.

## Da dove arrivano i dati

Ogni operazione lanciata dalle pagine del Patch Management viene registrata qui, con il log restituito dall'host.

## Se la pagina è vuota

**Nessuna operazione trovata**: non è ancora stata lanciata nessuna operazione, oppure i filtri sono troppo stretti.
Togli i filtri.
