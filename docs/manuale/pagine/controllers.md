---
percorso: /controllers
titolo: Controller di rete — UniFi e Omada collegati a DA-IPAM
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Molte reti hanno switch e access point governati da un **controller** (UniFi OS, Omada). Il controller sa già quali
apparati ha, le loro porte, chi è attaccato dove e chi è vicino a chi. Collegandolo qui, DA-IPAM lo legge e porta
quelle informazioni nell'elenco degli apparati, nella [Topologia](pagine/topology.md) e nella
[Mappa porte](pagine/port-map.md), senza dover entrare in ogni switch. Si arriva da **Network › Credenziali**, scheda
**Controller di rete** in cima.

![La pagina Controller di rete](/manuale/controllers/pagina.png)

## Le voci della pagina

1. **Nome**: la freccia accanto al nome apre il dettaglio del controller con le **Ultime letture degli apparati**:
   per ogni lettura **Quando**, **Durata**, **Origine** (pianificata o a mano), **Esito**, quanti apparati **Nuovi**,
   **Aggiornati** e **Saltati** (col motivo), **Porte**, **Vicini** ed **Errori**.
2. **Stato**: **Attivo** se il controller viene letto, disattivato se è stato fermato.
3. **Pianificazione**: quando viene letto da solo (per esempio «ogni giorno (03:00)») e ogni quanto si leggono i
   client collegati.

Le altre colonne: **Tipo** (UniFi OS, Omada), **Indirizzo** della console, **Site** (il sito del controller da
leggere), **Ultima lettura**, e i numeri dell'ultima lettura: **Apparati**, **Porte**, **Vicini**.

Chi ha il ruolo di amministratore vede in più:

- **Aggiungi controller**: si scelgono tipo, indirizzo, site, l'**Accesso alla console** (una credenziale di tipo
  controller presa da [Credenziali](pagine/credentials.md), di solito un utente locale) e la pianificazione.
- Nella colonna **Azioni**: **Sincronizza** (legge subito il controller e scrive apparati, porte e vicini; chiede
  conferma) e il menu **Altre azioni** con **Modifica**, **Certificato**, **Disattiva** / **Attiva** ed **Elimina**.
  Disattivando, il controller non viene più letto ma gli apparati già acquisiti restano.

## Il certificato

Al primo collegamento DA-IPAM si segna l'**impronta del certificato** del controller. Se un giorno il controller
presenta un certificato diverso, la lettura si ferma e **Certificato** mostra le due impronte, **fissata** e
**presentata adesso**: se il cambio è voluto (certificato rinnovato) l'amministratore accetta quella nuova.

## Come si usa

1. Crea in [Credenziali](pagine/credentials.md) una credenziale di tipo controller con un utente locale della console.
2. Premi **Aggiungi controller**, compila e salva.
3. Premi **Sincronizza** per la prima lettura, poi apri il dettaglio con la freccia per vedere com'è andata.

## Da dove arrivano i dati

Dalla console del controller, letta con l'utente indicato, alla pianificazione scelta o a mano con **Sincronizza**.

## Se la pagina è vuota

Non c'è ancora nessun controller collegato: l'amministratore lo aggiunge con **Aggiungi controller**. Se la rete non
ha un controller, switch e access point si leggono uno per uno con SNMP o API.
