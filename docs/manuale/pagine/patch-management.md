---
percorso: /patch-management
titolo: Patch Management — host Windows e programmi da aggiornare
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È il punto di partenza per **aggiornare i programmi sugli host Windows**. Elenca gli host con il loro software e le
vulnerabilità (CVE) che quel software porta, oppure i programmi installati con quanti host li hanno. Da qui si entra
nel dettaglio di un host o di un programma per lanciare un'operazione: verificare Chocolatey, installarlo, aggiornare
un pacchetto. Gli aggiornamenti passano da **Chocolatey** via **WinRM**.

Si arriva da **Applicativi › Patch Management** nel menu; la voce c'è solo se il modulo è acceso. In cima tre
schede: **Panoramica** (questa), [CVE](pagine/patch-management-cve.md) e [Storico](pagine/patch-management-history.md).

![La Panoramica del Patch Management](/manuale/patch-management/pagina.png)

Le immagini del manuale nascondono i nomi degli host e i conteggi delle CVE.

## Le voci della pagina

1. **Device**: l'elenco degli host Windows con il loro inventario software.
2. **Software**: l'elenco dei programmi installati, raccolti da tutti gli host.
3. **Cerca hostname, IP, OS...** (in **Software**: **Cerca nome software...**): filtra mentre scrivi.
4. **Filtro di gravità** (in **Device**): **Tutti**, **Solo Critical**, **Critical + High**, **+ Medium**. Mostra solo
   gli host che hanno CVE almeno di quella gravità. In **Software** al suo posto ci sono le spunte **Solo con CVE** e
   **Solo patchable** (programmi per cui esiste un pacchetto Chocolatey).
5. **Calcola matching**: incrocia le CVE con il software installato e associa a ogni programma il suo pacchetto
   Chocolatey, per tutta l'istanza. Si lancia dopo nuovi inventari o se mancano dei fix.

A destra della barra: quanti device (o software) e la pagina, e **Aggiorna**.

## Le colonne di Device

- La casella a sinistra: seleziona l'host per le azioni di gruppo. È spenta se WinRM non è configurato.
- **Host**: il nome, che apre il [dettaglio dell'host](pagine/patch-management-device-hostid.md).
- **IP**, **OS**: indirizzo e sistema operativo.
- **Software**: quanti programmi ha l'inventario.
- **CVE**: quattro conteggi per gravità, **C** critiche, **H** alte, **M** medie, **L** basse.
- **WinRM**: **OK** se l'accesso remoto è configurato e validato.
- **Ultimo probe**: l'esito dell'ultima verifica di Chocolatey (**OK**, **Errore**, **Mai**) e quando. **▲ dato di N
  giorni fa** avvisa che software e CVE della riga sono quelli letti allora.

Sotto l'elenco, con almeno un host selezionato: **Bootstrap Choco (N)** installa Chocolatey sugli host scelti
(serve prima di ogni patch) e **Install Wazuh agent** installa l'agente Wazuh (solo se il manager Wazuh è
configurato). Si apre una finestra che segue l'operazione host per host.

## Le colonne di Software

**Nome** (apre il [dettaglio del programma](pagine/patch-management-software-softwarekey.md)), **Versione**,
**Publisher**, **Host** (quanti lo hanno), **CVE**, **Choco** (il pacchetto Chocolatey associato), **Patchable** (se si
può aggiornare in automatico).

## Come si usa

1. Parti da **Device** con **Solo Critical** per vedere gli host più esposti.
2. Apri un host, guarda i programmi con CVE e lancia l'aggiornamento da lì.
3. Se lo stesso programma è su molti host, passa a **Software**, apri il programma e aggiornalo su tutti insieme.
4. Se un programma non ha il pacchetto, premi **Calcola matching**; se ancora manca, si fissa a mano con **Pin
   manuale** nel dettaglio.
5. Segui le operazioni in [Storico](pagine/patch-management-history.md).

## Cosa vogliono dire i segni

- **C**, **H**, **M**, **L**: CVE critiche, alte, medie, basse.
- **OK** verde in WinRM: si può operare sull'host. Senza, l'host non è selezionabile.
- **Errore** / **OK** / **Mai** in Ultimo probe: esito della verifica di Chocolatey.
- **▲ dato di N giorni fa**: l'inventario è vecchio.

## Da dove arrivano i dati

L'inventario software degli host Windows viene da Wazuh e dallo Scanner-Edge; le CVE dalle stesse fonti. Le
operazioni partono da DA-IPAM verso l'host via WinRM.

## Se la pagina è vuota

**Nessun device trovato**: compaiono solo gli host Windows con inventario software. Esegui una scansione
dell'inventario dalla pagina dell'host e verifica che le integrazioni Wazuh e Scanner-Edge siano attive. Se il modulo
non è installato, la pagina rimanda a **Impostazioni → Moduli**.
