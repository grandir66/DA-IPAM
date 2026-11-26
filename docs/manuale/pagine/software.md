---
percorso: /software
titolo: Software — i programmi installati nel parco macchine
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È l'elenco di **tutti i programmi trovati** su PC e server, messi insieme da più fonti e contati una volta sola per
nome e versione. Per ogni programma dice quante versioni girano, su quanti host, da quali fonti lo si sa e se ha
vulnerabilità note. Serve per rispondere a domande come «su quanti PC c'è ancora la versione vecchia?» o «chi ha
installato quel programma?». Si arriva da **Network › Software**.

![La pagina Software](/manuale/software/pagina.png)

## Le voci della pagina

1. **Cerca nome o publisher…**: filtra per nome del programma o per chi lo pubblica.
2. **Sorgenti**: **Wazuh**, **Probe**, **Agent**, **ESET**. Un clic su una sorgente mostra solo i programmi visti da
   lei; un secondo clic la toglie.
   - **Wazuh**: l'agente di sicurezza Wazuh installato sugli host.
   - **Probe**: la lettura di DA-IPAM con WinRM o SSH.
   - **Agent**: l'agente di inventario (GLPI).
   - **ESET**: la console dell'antivirus ESET.
3. **OS**: **Windows**, **Linux**, **Apple**, **Unknown** (sistema non riconosciuto): mostra solo i programmi di quel
   sistema.
4. **Solo con vulnerabilità**: l'interruttore lascia solo i programmi con almeno una vulnerabilità nota.
5. **CVE**: quante vulnerabilità note ha il programma. Un numero diverso da zero porta alla pagina delle
   vulnerabilità già filtrata su quel programma.

Le altre colonne: **Nome**, **Versioni** (quante versioni diverse; se è una sola si legge direttamente),
**Publisher**, **Sorgenti** (le etichette delle fonti che l'hanno visto), **Host** (su quanti host è installato),
**Ultimo visto**. Un clic sull'intestazione di una colonna la ordina. In alto, accanto al titolo, il numero totale e le
frecce per sfogliare le pagine.

La **freccia** a sinistra di una riga la apre: compaiono le versioni e, per ciascuna, i computer su cui è installata
(**Computer**, **Network**, **Fonti**, **Installato**, **Visto**). Un clic sul nome del computer apre la sua
[scheda](pagine/objects-id.md).

## Come si usa

1. Scrivi il nome del programma in **Cerca**.
2. Apri la riga con la freccia per vedere le versioni e su quali computer stanno.
3. Per cercare i programmi a rischio accendi **Solo con vulnerabilità** e ordina per **CVE**.

## Cosa vogliono dire i segni

- Le etichette **Wazuh**, **Probe**, **Agent**, **ESET** dicono chi ha visto il programma: più etichette vuol dire
  più conferme. Il nome è sempre scritto dentro l'etichetta.

## Da dove arrivano i dati

Da Wazuh, dalle letture di DA-IPAM con WinRM e SSH (**Accesso agli host** nella
[pagina della subnet](pagine/networks-id.md)), dall'agente GLPI e dalla console ESET.

## Se la pagina è vuota

«Nessun software inventariato»: serve almeno una fonte. Lancia l'accesso agli host Windows e Linux con le credenziali
giuste, oppure configura Wazuh o installa l'agente GLPI. Se l'elenco è vuoto solo con i filtri, toglili.
