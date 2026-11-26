---
percorso: /patch-management/device/[hostId]
titolo: Patch di un host — il suo software, le CVE e le operazioni
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Mostra **un host Windows** dal punto di vista delle patch: il suo inventario software, le CVE di ogni programma e le
operazioni che si possono lanciare (verifica e installazione di Chocolatey, aggiornamenti, disinstallazioni,
installazione di agenti). Si arriva con un clic sul nome di un host nella [Panoramica](pagine/patch-management.md);
**← Patch Management** torna indietro.

![Il dettaglio di un host](/manuale/patch-management-device-hostid/pagina.png)

Le immagini del manuale nascondono il nome dell'host e i conteggi delle CVE.

## Le voci della pagina

In cima: nome e indirizzo, **WinRM ok** (o non configurato), lo stato di Chocolatey (**Choco installato**, **Choco
mancante / KO**, **Non testato**), il sistema operativo e l'ultimo probe. A destra **Aggiorna** e il riassunto
(quanti software, quanti con CVE, quanti aggiornabili).

1. **Probe host**: verifica la versione di Chocolatey e i pacchetti da aggiornare su questo host.
2. **Bootstrap choco**: installa Chocolatey se manca (spento se c'è già). Si può ripetere senza danni.

Gli altri pulsanti della riga: **Installa Wazuh agent** (serve il manager Wazuh configurato), **MeshAgent (choco)**
(installa l'agente MeshCentral come pacchetto Chocolatey), **GLPI Agent (choco)** (installa l'agente GLPI che manda
l'inventario a DA-IPAM), **Vedi host in IPAM** (apre la scheda dell'host). Tutti chiedono WinRM configurato.

3. **Cerca software, publisher, versione...**: filtra l'inventario.
4. **Solo con CVE patchabili** (accesa di serie) e **Solo con CVE**: lasciano solo i programmi con vulnerabilità,
   aggiornabili o no. Spegnile per vedere tutto l'inventario.

## Software installati

Colonne: la casella (solo per i programmi aggiornabili, cioè con un pacchetto Chocolatey), **Software**,
**Versione**, **Publisher**, **CVE** (per gravità; un clic sulla riga apre la CVE), **Choco** (il pacchetto
associato), **Azioni**:

- **Pin manuale**: fissa a mano il pacchetto Chocolatey del programma, se l'abbinamento non lo trova.
- **Patch**: aggiorna quel programma.
- **Disinstalla**: disinstallazione silenziosa dal registro di Windows. Chiede conferma: è irreversibile; se il
  programma non ha un comando di disinstallazione silenzioso lo segnala senza toccare l'host.

In fondo, sui programmi selezionati, il pulsante per aggiornarli tutti insieme (massimo 50). Ogni operazione apre una
finestra con l'avanzamento e finisce nello [Storico](pagine/patch-management-history.md).

## Come si usa

1. Se Chocolatey è **Non testato**, premi **Probe host**; se manca, **Bootstrap choco**.
2. Guarda i programmi con CVE patchabili, spunta quelli da aggiornare e lancia l'aggiornamento.
3. Un programma che non serve più si toglie con **Disinstalla**.

## Cosa vogliono dire i segni

- **Choco installato** (verde): l'ultima verifica è andata bene. **Choco mancante / KO** (rosso): va installato.
  **Non testato**: nessuna verifica ancora.
- Casella spenta su un programma: non c'è un pacchetto Chocolatey, oppure nessuna CVE.

## Da dove arrivano i dati

L'inventario dell'host da Wazuh o Scanner-Edge; Chocolatey e le operazioni via WinRM. Con inventari molto grandi la
pagina avvisa che alcuni dati potrebbero essere troncati.

## Se la pagina è vuota

**Nessun software inventory disponibile per questo host**: esegui una scansione dell'inventario (Wazuh o
Scanner-Edge). **Nessun software corrisponde ai filtri**: spegni **Solo con CVE patchabili** o **Solo con CVE**.
