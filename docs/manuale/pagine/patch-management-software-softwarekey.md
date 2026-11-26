---
percorso: /patch-management/software/[softwareKey]
titolo: Patch di un programma — le sue CVE e gli host che lo hanno
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Mostra **un programma** installato sugli host: le CVE che lo riguardano e l'elenco degli host che lo hanno. Serve ad
aggiornare lo stesso programma su molti host in un colpo solo. Si arriva dalla scheda **Software** della
[Panoramica](pagine/patch-management.md), con un clic sul nome; `icona:arrow-left` **Patch Management** in cima torna
indietro.

Le parti che si ripetono in tutte le pagine sono nelle [parti comuni dell'interfaccia](../INTERFACCIA.md). Le immagini
del manuale nascondono i codici delle CVE e i nomi degli host.

## La scheda del programma e le sue CVE

![La scheda del programma e le sue CVE](/manuale/patch-management-software-softwarekey/testata.png)

In cima: `icona:package` nome e versione del programma, il pacchetto Chocolatey (**choco: ?** se non è associato; con
il pacchetto la pagina dice che l'aggiornamento automatico è disponibile), il produttore, quante CVE e quanti host lo
hanno (e quanti con WinRM).

1. `tasto:pin` **Pin manuale fix**: fissa a mano il pacchetto Chocolatey del programma, con la stessa finestra del
   [dettaglio di una CVE](pagine/patch-management-cve-cveid.md). C'è solo se il pacchetto manca e il programma ha
   almeno una CVE.
2. `tasto:refresh` **Aggiorna**: rilegge programma e host.
3. **CVE rilevate (N)**: le vulnerabilità note del programma, una per riga, con la gravità, il codice (un clic apre la
   [pagina della CVE](pagine/patch-management-cve-cveid.md)), il CVSS e da dove viene il dato. **Mostra tutte (N
   altre)** apre l'elenco intero.

## Host con questo pacchetto

![I filtri e l'elenco degli host](/manuale/patch-management-software-softwarekey/host.png)

1. `icona:search` **Cerca hostname, IP, custom name…**: filtra gli host.
2. **Solo con WinRM**: lascia solo gli host su cui si può operare. A destra, quanti host sono selezionati sul massimo
   di 50.

Solo host Windows con il programma installato. La casella di ogni riga è spenta se WinRM non è validato; quella in
testa prende tutti quelli selezionabili.

| Colonna | Che cosa dice |
|---|---|
| **Hostname** | Il nome; un clic apre il [dettaglio dell'host](pagine/patch-management-device-hostid.md). |
| **IP**, **OS** | Indirizzo e sistema operativo. |
| **WinRM** | **ok** se l'accesso remoto è validato. |
| **Choco** | Esito dell'ultima verifica di Chocolatey: **ok**, **fail**, **?** (mai verificato). |
| **Ultimo probe** | Quando è stata fatta quella verifica, o «mai». |

### I pulsanti sugli host scelti

![I pulsanti sugli host scelti](/manuale/patch-management-software-softwarekey/azioni.png)

- `tasto:play` **Probe selezionati**: verifica Chocolatey e i pacchetti da aggiornare.
- `tasto:wrench` **Bootstrap choco**: installa Chocolatey dove manca.
- `tasto:rocket` **Upgrade selezionati (N)**: aggiorna il programma all'ultima versione disponibile. Spento se manca il
  pacchetto Chocolatey (passando il mouse si legge perché).

Ogni lancio apre la [finestra dell'operazione](pagine/patch-management.md#finestra-operazione) e finisce nello
[Storico](pagine/patch-management-history.md). Sono operazioni sugli host: le lancia un amministratore.

## Come si fa

- **Aggiornare un browser su tutti i PC**: lascia **Solo con WinRM**, casella in testa, `tasto:rocket` **Upgrade
  selezionati**.
- **Il programma non ha il pacchetto (choco: ?)**: `tasto:pin` **Pin manuale fix** con il nome del pacchetto.
- **Alcuni host non hanno Chocolatey**: selezionali, `tasto:wrench` **Bootstrap choco**, poi l'upgrade.
- **Vedere chi ha ancora il programma senza WinRM**: spegni **Solo con WinRM**: le righe con la casella spenta vanno
  sistemate a mano o con WinRM.
- **Leggere una CVE del programma**: un clic sul codice nell'elenco **CVE rilevate**.

## Cosa vogliono dire i segni

- **ok** verde: a posto. **?**: mai verificato. **fail**: ultima verifica fallita.
- **choco: ?**: nessun pacchetto Chocolatey associato.

## Da dove arrivano i dati

Dall'inventario software degli host (Wazuh e Scanner-Edge) e dall'abbinamento con i pacchetti Chocolatey.

## Se la pagina è vuota

Se il programma **non è stato trovato**, forse è stato tolto da tutti gli host: **Torna alla lista software**.
**Nessun host trovato con questo pacchetto installato**, oppure nessuno coi filtri: spegni **Solo con WinRM** o pulisci
la ricerca.
