---
percorso: /patch-management/software/[softwareKey]
titolo: Patch di un programma — le sue CVE e gli host che lo hanno
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Mostra **un programma** installato sugli host: le CVE che lo riguardano e l'elenco degli host che lo hanno. Serve ad
aggiornare lo stesso programma su molti host in un colpo solo. Si arriva dalla scheda **Software** della
[Panoramica](pagine/patch-management.md), con un clic sul nome; **← Patch Management** torna indietro.

![Il dettaglio di un programma](/manuale/patch-management-software-softwarekey/pagina.png)

Le immagini del manuale nascondono i nomi degli host.

## Le voci della pagina

In cima: nome e versione del programma, il pacchetto Chocolatey (**choco: ?** se non è associato; con il pacchetto
la pagina dice che l'aggiornamento automatico è disponibile), il produttore, quante CVE e quanti host. A destra
**Aggiorna**.

1. **Pin manuale fix**: fissa a mano il pacchetto Chocolatey del programma. Serve almeno una CVE associata.
2. **CVE rilevate**: le vulnerabilità note del programma, con gravità, codice (si apre la
   [pagina della CVE](pagine/patch-management-cve-cveid.md)), CVSS e fonte. **Mostra tutte** apre l'elenco intero.
3. **Cerca hostname, IP, custom name...**: filtra gli host.
4. **Solo con WinRM**: lascia solo gli host su cui si può operare.

## Host con questo pacchetto

Solo host Windows con il programma installato. Colonne: la casella (spenta se WinRM non è validato), **Hostname**,
**IP**, **OS**, **WinRM**, **Choco**, **Ultimo probe**.

In fondo, sugli host selezionati:

- **Probe selezionati**: verifica Chocolatey e i pacchetti da aggiornare.
- **Bootstrap choco**: installa Chocolatey dove manca.
- **Upgrade selezionati (N)**: aggiorna il programma all'ultima versione disponibile. Spento se manca il pacchetto
  Chocolatey (passando il mouse si legge perché).

Ogni lancio apre una finestra con l'avanzamento e finisce nello [Storico](pagine/patch-management-history.md).

## Come si usa

1. Controlla che il programma abbia il pacchetto Chocolatey; se no, **Pin manuale fix**.
2. Accendi **Solo con WinRM** e seleziona gli host.
3. Se serve, **Bootstrap choco**; poi **Upgrade selezionati**.

## Cosa vogliono dire i segni

- **ok** verde: a posto. **?**: mai verificato. **fail**: ultima verifica fallita.
- **choco: ?**: nessun pacchetto Chocolatey associato.

## Da dove arrivano i dati

Dall'inventario software degli host (Wazuh e Scanner-Edge) e dall'abbinamento con i pacchetti Chocolatey.

## Se la pagina è vuota

Se il programma **non è stato trovato**, forse è stato tolto da tutti gli host: **Torna alla lista software**.
**Nessun host trovato con questo pacchetto installato**, oppure nessuno coi filtri: spegni **Solo con WinRM** o pulisci
la ricerca.
