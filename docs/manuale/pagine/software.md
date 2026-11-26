---
percorso: /software
titolo: Software — i programmi installati nel parco macchine
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È l'elenco di **tutti i programmi trovati** su PC e server, messi insieme da più fonti e contati una volta sola per
nome e versione. Per ogni programma dice quante versioni girano, su quanti host, da quali fonti lo si sa e se ha
vulnerabilità note. Serve per rispondere a domande come «su quanti PC c'è ancora la versione vecchia?» o «chi ha
installato quel programma?». Si arriva da **Network › Software**.

Menu e tabelle funzionano come in tutte le pagine: vedi le [parti comuni dell'interfaccia](../INTERFACCIA.md). Qui
sotto c'è quello che Software ha di suo; non ci sono tasto destro né selezione di più righe, e la pagina è tutta in
lettura.

## Il titolo e i filtri

![Il titolo e i filtri di Software](/manuale/software/filtri.png)

Accanto al titolo `icona:package` **Software**: quante righe ci sono («1–50 di 4873») e `icona:chevrons-left`
`icona:chevron-left` `icona:chevron-right` `icona:chevrons-right` per sfogliare le pagine, cinquanta programmi per
volta.

1. `icona:search` **Cerca nome o publisher…**: filtra per nome del programma o per chi lo pubblica.
2. **Sorgenti**: **Wazuh**, **Probe**, **Agent**, **ESET**. Un clic su una sorgente mostra solo i programmi visti da
   lei (il pulsante diventa azzurro); un secondo clic la toglie. Se ne possono accendere più d'una.
   - **Wazuh**: l'agente di sicurezza Wazuh installato sugli host;
   - **Probe**: la lettura di DA-IPAM con WinRM o SSH;
   - **Agent**: l'agente di inventario (GLPI);
   - **ESET**: la console dell'antivirus ESET.
3. **OS**: **Windows**, **Linux**, **Apple**, **Unknown** (sistema non riconosciuto): mostra solo i programmi di quel
   sistema. Anche qui se ne accendono più d'uno.
4. **Solo con vulnerabilità**: l'interruttore lascia solo i programmi con almeno una vulnerabilità nota.

Con un filtro acceso compare **Reset**, che li toglie tutti.

## La tabella

![La tabella dei programmi](/manuale/software/tabella.png)

1. `icona:chevron-right` all'inizio della riga (o un clic su un punto qualsiasi della riga) apre il
   [dettaglio](#dettaglio) del programma.
2. **Versioni**: quante versioni diverse girano; se è una sola si legge direttamente il numero di versione.
3. **Sorgenti**: le etichette delle fonti che l'hanno visto. Più etichette vuol dire più conferme.
4. **CVE**: quante vulnerabilità note ha il programma. Un numero diverso da zero è un collegamento alla pagina delle
   [Vulnerabilità](pagine/vulnerabilities.md) già filtrata su quel programma.

| Colonna | Che cosa dice |
|---|---|
| **Nome** | Il nome del programma. |
| **Versioni** | Quante versioni, o la versione se è una sola. |
| **Publisher** | Chi pubblica il programma. |
| **Sorgenti** | Wazuh, Probe, Agent, ESET. |
| **Host** | Su quanti host è installato. |
| **CVE** | Quante vulnerabilità note. |
| **Ultimo visto** | Quando è stato visto l'ultima volta. |

Un clic su **Nome**, **Host**, **CVE** o **Ultimo visto** ordina l'elenco (`icona:arrow-up-down` si può ordinare,
`icona:arrow-down` ordinato dal più grande). All'apertura è ordinato per numero di host.

## Il dettaglio di un programma {#dettaglio}

![Il dettaglio di un programma](/manuale/software/riga-aperta.png)

Nella schermata i nomi dei computer sono sfocati.

- **Versioni installate**, se ce n'è più d'una: per ogni **Versione** quanti **Host** l'hanno, i nomi dei
  **Computer** (un clic apre la sua [scheda](pagine/objects-id.md)) e l'**Ultimo visto**. «non rilevata» vuol dire
  che la fonte non ha detto la versione.
- **Host**: i primi computer che l'hanno, con **Host**, **IP**, **Versione**, **Network**, **Publisher**, **Fonti**,
  **Installato** (la data d'installazione) e **Visto**.
- **Vedi tutti gli host (N)**, quando sono più di quelli mostrati: apre una finestra con l'elenco completo.

`icona:chevron-down` all'inizio della riga, o un altro clic sulla riga, chiude il dettaglio.

## Come si fa

- **Su quanti PC c'è ancora una versione vecchia di Chrome?**: scrivi «chrome» in **Cerca**, apri la riga e leggi
  **Versioni installate**: quante macchine per ogni versione e quali.
- **Trovare i programmi a rischio**: accendi **Solo con vulnerabilità**, ordina per **CVE**, poi clic sul numero per
  vedere le vulnerabilità.
- **Chi ha installato un programma che non dovrebbe esserci**: cercalo, apri la riga, guarda i computer e la data in
  **Installato**.
- **Controllare che l'antivirus ci sia dappertutto**: cerca il suo agente e confronta il numero in **Host** con i PC
  fra gli [Apparati](pagine/discovery.md) (categoria Postazioni).
- **Vedere solo i server Linux**: **OS** › Linux.

## Cosa vogliono dire i segni

- Le etichette **Wazuh**, **Probe**, **Agent**, **ESET** dicono chi ha visto il programma: più etichette vuol dire
  più conferme. Il nome è sempre scritto dentro l'etichetta.

## Da dove arrivano i dati

Da Wazuh, dalle letture di DA-IPAM con WinRM e SSH (**Accesso agli host** nella
[pagina della subnet](pagine/networks-id.md)), dall'agente GLPI e dalla console ESET.

## Se la pagina è vuota

«Nessun software inventariato»: serve almeno una fonte. Lancia l'accesso agli host Windows e Linux con le credenziali
giuste, oppure configura Wazuh o installa l'agente GLPI. Se l'elenco è vuoto solo con i filtri, premi **Reset**.
