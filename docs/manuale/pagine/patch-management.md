---
percorso: /patch-management
titolo: Patch Management — host Windows e programmi da aggiornare
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È il punto di partenza per **aggiornare i programmi sugli host Windows**. Elenca gli host con il loro software e le
vulnerabilità (CVE) che quel software porta, oppure i programmi installati con quanti host li hanno. Da qui si entra
nel dettaglio di un host o di un programma per lanciare un'operazione: verificare Chocolatey, installarlo, aggiornare
un pacchetto. Gli aggiornamenti passano da **Chocolatey** via **WinRM**.

Si arriva da **Applicativi › Patch Management** nel menu; la voce c'è solo se il modulo è acceso. In cima tre
schede della sezione: **Panoramica** (questa), [CVE](pagine/patch-management-cve.md) e
[Storico](pagine/patch-management-history.md). Schede, tabelle e segni funzionano come nelle
[parti comuni dell'interfaccia](../INTERFACCIA.md); qui c'è quello che la pagina ha di suo.

Le immagini del manuale nascondono i nomi degli host e i conteggi delle CVE.

## La barra in cima

![La barra della Panoramica](/manuale/patch-management/barra.png)

1. `tasto:sparkles` **Calcola matching**: incrocia le CVE con il software installato e associa a ogni programma il suo
   pacchetto Chocolatey, per tutta l'istanza. Si lancia dopo nuovi inventari o se mancano dei fix; alla fine un
   messaggio dice quanti abbinamenti ha trovato e la pagina si ricarica.
2. `icona:server-cog` **Device**: l'elenco degli host Windows con il loro inventario software.
3. `icona:package` **Software**: l'elenco dei programmi installati, raccolti da tutti gli host.
4. `icona:search` **Cerca hostname, IP, OS…**: filtra mentre scrivi.
5. **Gravità**: **Tutti**, **Solo Critical**, **Critical + High**, **+ Medium**. Mostra solo gli host che hanno CVE
   almeno di quella gravità; il pulsante acceso è azzurro.
6. `tasto:refresh` **Aggiorna**: ricarica l'elenco. Accanto, quanti device ci sono e la pagina.

## La scheda Device {#device}

![L'elenco dei device](/manuale/patch-management/device.png)

1. La casella seleziona l'host per le azioni di gruppo (sotto). È spenta se WinRM non è configurato: passa il mouse per
   leggere il motivo.
2. **CVE**: quattro conteggi per gravità, **C** critiche, **H** alte, **M** medie, **L** basse; il trattino se non ne
   ha.
3. **WinRM**: `icona:shield-check` **OK** se l'accesso remoto è configurato e validato, **N/D** se no.
4. **Ultimo probe**: l'esito dell'ultima verifica di Chocolatey (**OK**, **Errore**, **Mai**) e quando. **▲ dato di N
   giorni fa** avvisa che software e CVE della riga sono quelli letti allora.

Le altre colonne: **Host** (il nome, che apre il [dettaglio dell'host](pagine/patch-management-device-hostid.md); sotto,
il nome di rete se ne è stato dato uno a mano), **IP**, **OS** (passa il mouse per leggerlo intero), **Software**
(quanti programmi ha l'inventario). Sotto l'elenco **Precedente** e **Successiva** cambiano pagina.

### Le azioni su più host

![La barra delle azioni su più host](/manuale/patch-management/azioni.png)

In fondo alla pagina resta sempre la barra delle azioni di gruppo. Finché non scegli niente dice «Seleziona host con
WinRM ✓ per azioni bulk»; poi «N host selezionati».

- `tasto:rocket` **Bootstrap Choco (N)**: installa Chocolatey sugli host scelti. Serve prima di ogni aggiornamento.
- `tasto:wand` **Installa Wazuh (N)**: installa l'agente Wazuh. È spento se il manager Wazuh non è configurato (passa il
  mouse per leggere dove si configura).

Tutte e due aprono la [finestra dell'operazione](#finestra-operazione). Cambiano gli host: le deve lanciare un
amministratore.

## La scheda Software {#software}

![L'elenco dei programmi](/manuale/patch-management/software.png)

1. `icona:search` **Cerca nome software…**: filtra mentre scrivi.
2. **Solo con CVE**: solo i programmi con vulnerabilità note.
3. **Solo patchable**: solo i programmi che si possono aggiornare in automatico (hanno un pacchetto Chocolatey).
4. **Choco**: il pacchetto Chocolatey associato, **N/D** se manca.

| Colonna | Che cosa dice |
|---|---|
| **Nome** | Il programma; un clic apre il [dettaglio del programma](pagine/patch-management-software-softwarekey.md). |
| **Versione** | La versione installata. |
| **Publisher** | Chi lo produce. |
| **Host** | Su quanti host è installato. |
| **CVE** | Quante vulnerabilità note porta. |
| **Choco** | Il pacchetto Chocolatey, o N/D. |
| **Patchable** | **Sì** se si può aggiornare in automatico, **No** se no. |

## La finestra dell'operazione {#finestra-operazione}

Ogni operazione lanciata (verifica, installazione di Chocolatey o di Wazuh, aggiornamento) apre una finestra che la
segue host per host: per ognuno lo stato (queued in coda, running in corso, success riuscita, failed fallita, reboot
pending serve un riavvio, cancelled annullata), il codice di uscita e, con **Output**, il registro in diretta. Se un
host chiede un riavvio, la finestra lo dice e suggerisce di pianificarlo a mano. **Annulla rimanenti (N)** toglie dalla
coda quelli non ancora partiti; **Chiudi** chiude la finestra (l'operazione continua e resta nello
[Storico](pagine/patch-management-history.md)).

## Come si fa

- **Vedere gli host più esposti**: scheda **Device**, **Solo Critical**.
- **Preparare dieci PC agli aggiornamenti**: spunta le righe con WinRM OK, `tasto:rocket` **Bootstrap Choco**.
- **Aggiornare Chrome su tutti i PC**: scheda **Software**, cerca «chrome», apri il programma e aggiornalo da lì.
- **Un programma non ha il pacchetto**: `tasto:sparkles` **Calcola matching**; se manca ancora, si fissa a mano con
  **Pin manuale** nel [dettaglio del programma](pagine/patch-management-software-softwarekey.md).
- **Trovare cosa si può aggiornare subito**: scheda **Software**, spunta **Solo con CVE** e **Solo patchable**.
- **Seguire un'operazione già partita**: scheda [Storico](pagine/patch-management-history.md).

## Cosa vogliono dire i segni

- **C**, **H**, **M**, **L**: CVE critiche, alte, medie, basse.
- `icona:shield-check` **OK** verde in WinRM: si può operare sull'host. **N/D**: l'host non è selezionabile.
- **Errore** / **OK** / **Mai** in Ultimo probe: esito della verifica di Chocolatey.
- **▲ dato di N giorni fa**: l'inventario è vecchio.

## Da dove arrivano i dati

L'inventario software degli host Windows viene da Wazuh e dallo Scanner-Edge; le CVE dalle stesse fonti. Le
operazioni partono da DA-IPAM verso l'host via WinRM.

## Se la pagina è vuota

**Nessun device trovato**: compaiono solo gli host Windows con inventario software. Esegui una scansione
dell'inventario dalla pagina dell'host e verifica che le integrazioni Wazuh e Scanner-Edge siano attive. Se il modulo
non è installato, la pagina lo dice e rimanda a **Impostazioni → Moduli**.
