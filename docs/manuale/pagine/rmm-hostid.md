---
percorso: /rmm/[hostId]
titolo: Sessione remota con l'agente MeshCentral
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Apre una **sessione remota su un computer** che ha l'agente MeshCentral, dentro DA-IPAM: si vede e si comanda il
desktop, si apre un terminale, si scambiano file o si lanciano comandi. La sessione si apre già autenticata, senza
passare dalla console di MeshCentral. Si arriva da **Controllo remoto** in [Controllo remoto (RMM)](pagine/rmm.md), o dal
pulsante **Controllo remoto** nella scheda dell'host.

Nessuna schermata: aprire la pagina avvia una sessione vera sul computer.

## Le voci della pagina

La barra in alto è di DA-IPAM; il riquadro sotto mostra il computer.

- **Indietro**: torna all'elenco del [Controllo remoto](pagine/rmm.md).
- Il **nome del computer**, il segno **online** / **offline** e il sistema operativo.
- **Le quattro modalità**:
  - **Desktop**: lo schermo del computer, con tastiera e mouse.
  - **Terminale**: la riga di comando del computer.
  - **File**: le cartelle del computer, per caricare e scaricare file.
  - **Comandi**: un pannello di DA-IPAM per lanciare un comando e leggerne il risultato (vedi sotto).
  Un nuovo clic sulla modalità già scelta la riconnette.
- **Le due frecce** (Riconnetti): l'accesso dura 3 minuti; se la sessione scade, si riapre da qui.
- **La freccia che esce** (Apri in una scheda separata): apre la stessa sessione in una scheda nuova del browser.

## Il pannello Comandi

Si scrive il comando nella casella (Invio va a capo, **Ctrl+Invio** lo esegue) e si preme **Esegui**. Su Windows la
casella **PowerShell (altrimenti cmd)** sceglie l'interprete; su Linux e Mac si usa bash. Il comando gira come
amministratore del computer (root o SYSTEM) e si ferma dopo 30 secondi. Sotto compaiono i risultati, il più recente in
alto; **Pulisci** li cancella.

## Se il riquadro resta vuoto

Sotto il riquadro compare una spiegazione con la causa trovata dal server:

- **Il certificato di MeshCentral va accettato una volta**: il browser non si fida ancora del certificato di
  MeshCentral. **Apri MeshCentral in una scheda**, accetta l'avviso del browser, torna qui e premi **Riconnetti**.
- **MeshCentral non si lascia mostrare dentro DA-IPAM da questo indirizzo**: DA-IPAM è aperto con un indirizzo che
  MeshCentral non ammette; la spiegazione dice quali indirizzi vanno ammessi. Nel frattempo si usa **Apri MeshCentral in
  una scheda**.

## Come si usa

1. Apri la sessione da [Controllo remoto (RMM)](pagine/rmm.md).
2. Scegli **Desktop** per lavorare sullo schermo, **Comandi** per un controllo veloce (per esempio lo spazio sul disco).
3. Se la sessione si blocca, premi le due frecce per riconnetterti.

## Da dove arrivano i dati

Dal server MeshCentral dell'appliance: DA-IPAM chiede un accesso monouso e mostra la sessione in un riquadro. Il
pannello Comandi parla direttamente con l'agente.

## Se la pagina è vuota

«Nessun agente MeshCentral associato a questo host» vuol dire che sul computer non c'è l'agente, o che il suo nodo non è
ancora associato: installalo dalla scheda dell'host oppure associalo da [Controllo remoto (RMM)](pagine/rmm.md).
