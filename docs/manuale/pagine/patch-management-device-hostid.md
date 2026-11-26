---
percorso: /patch-management/device/[hostId]
titolo: Patch di un host — il suo software, le CVE e le operazioni
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Mostra **un host Windows** dal punto di vista delle patch: il suo inventario software, le CVE di ogni programma e le
operazioni che si possono lanciare (verifica e installazione di Chocolatey, aggiornamenti, disinstallazioni,
installazione di agenti). Si arriva con un clic sul nome di un host nella [Panoramica](pagine/patch-management.md) o nel
[dettaglio di una CVE](pagine/patch-management-cve-cveid.md); `icona:arrow-left` **Patch Management** in cima torna
indietro.

Le parti che si ripetono in tutte le pagine sono nelle [parti comuni dell'interfaccia](../INTERFACCIA.md). Le immagini
del manuale nascondono il nome dell'host e i conteggi delle CVE.

## La scheda dell'host e le operazioni

![La scheda dell'host e i pulsanti delle operazioni](/manuale/patch-management-device-hostid/testata.png)

In cima: nome e indirizzo, `icona:shield-check` **WinRM ok** (o non configurato), lo stato di Chocolatey (**Choco
installato**, **Choco mancante / KO**, **Non testato**), il sistema operativo e l'ultimo probe con il suo esito. In
basso a destra il riassunto: quanti software, quanti con CVE, quanti aggiornabili.

1. `tasto:refresh` **Aggiorna**: rilegge l'host e il suo inventario.
2. `tasto:play` **Probe host**: verifica la versione di Chocolatey e i pacchetti da aggiornare su questo host.
3. `tasto:wrench` **Bootstrap choco**: installa Chocolatey se manca; spento se l'ultimo probe dice che c'è già. Si può
   ripetere senza danni.
4. `tasto:shield-check` **Installa Wazuh agent**: spento se il manager Wazuh non è configurato.
5. `tasto:monitor-smartphone` **MeshAgent (choco)**: installa l'agente MeshCentral come pacchetto Chocolatey, per il
   [Controllo remoto](pagine/rmm.md).
6. **GLPI Agent (choco)**: installa l'agente GLPI che manda l'inventario a DA-IPAM.
7. `icona:external-link` **Vedi host in IPAM**: apre la [scheda dell'host](pagine/objects-id.md).

I pulsanti dal 2 al 6 chiedono WinRM configurato: se manca sono spenti, e passando il mouse si legge il motivo. Ognuno
apre la [finestra dell'operazione](pagine/patch-management.md#finestra-operazione).

## Software installati

![I filtri e l'elenco del software](/manuale/patch-management-device-hostid/software.png)

1. `icona:search` **Cerca software, publisher, versione…**: filtra l'inventario.
2. **Solo con CVE patchabili** (accesa di serie): solo i programmi con vulnerabilità che si possono aggiornare.
3. **Solo con CVE**: solo i programmi con vulnerabilità, aggiornabili o no. Spegni tutte e due per vedere tutto
   l'inventario. A destra, quanti programmi sono selezionati sul massimo di 50.
4. **Azioni**: i pulsanti della riga (sotto).

| Colonna | Che cosa dice |
|---|---|
| La casella | Seleziona il programma per l'aggiornamento di gruppo. C'è solo per i programmi aggiornabili. |
| **Software** | Il nome e, sotto, da dove viene il dato (per esempio wazuh-agent). |
| **Versione**, **Publisher** | La versione installata e chi lo produce. |
| **CVE** | I conteggi per gravità; passa il mouse per il dettaglio, un clic apre la CVE. |
| **Choco** | Il pacchetto Chocolatey associato; se manca, il pulsante `tasto:pin` **Pin manuale** per fissarlo a mano (si apre la stessa finestra del [dettaglio di una CVE](pagine/patch-management-cve-cveid.md)). |

I pulsanti in **Azioni**:

- `tasto:rocket` **Patch**: aggiorna quel programma (passa il mouse per leggere il comando, `choco upgrade … -y`). C'è
  solo se il programma ha un pacchetto.
- `tasto:trash` **Disinstalla**: apre la conferma «Disinstallare software?», che dice come verrà tolto: con Chocolatey
  se c'è il pacchetto, altrimenti in silenzio dal registro di Windows; se il programma non ha un comando silenzioso lo
  segnala senza toccare l'host. È **irreversibile**: **Disinstalla** conferma, **Annulla** chiude.

### L'aggiornamento di gruppo

![La barra dell'aggiornamento di gruppo](/manuale/patch-management-device-hostid/barra.png)

In fondo alla pagina: «Seleziona uno o più software patchabili per il batch» finché non scegli niente, poi «N software
selezionati». `tasto:rocket` **Patch selezionati (N)** li aggiorna tutti insieme.

Tutte le operazioni cambiano l'host: le lancia un amministratore. Finiscono nello
[Storico](pagine/patch-management-history.md).

## Come si fa

- **Preparare l'host la prima volta**: `tasto:play` **Probe host**; se Chocolatey manca, `tasto:wrench` **Bootstrap
  choco**.
- **Chiudere le CVE aggiornabili**: lascia accesa **Solo con CVE patchabili**, casella in testa, `tasto:rocket`
  **Patch selezionati**.
- **Un programma vulnerabile non ha il pacchetto**: `tasto:pin` **Pin manuale** sulla sua riga.
- **Togliere un programma che non serve più**: spegni i filtri, cercalo, `tasto:trash` **Disinstalla**, conferma.
- **Mettere l'host sotto controllo remoto**: `tasto:monitor-smartphone` **MeshAgent (choco)**.

## Cosa vogliono dire i segni

- **Choco installato** (verde): l'ultima verifica è andata bene. **Choco mancante / KO** (rosso): va installato.
  **Non testato**: nessuna verifica ancora.
- Casella assente su un programma: non c'è un pacchetto Chocolatey.

## Da dove arrivano i dati

L'inventario dell'host da Wazuh o Scanner-Edge; Chocolatey e le operazioni via WinRM. Con inventari molto grandi la
pagina avvisa che alcuni dati potrebbero essere troncati.

## Se la pagina è vuota

**Nessun software inventory disponibile per questo host**: esegui una scansione dell'inventario (Wazuh o
Scanner-Edge). **Nessun software corrisponde ai filtri**: spegni **Solo con CVE patchabili** o **Solo con CVE**.
