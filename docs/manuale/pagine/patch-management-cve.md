---
percorso: /patch-management/cve
titolo: CVE rilevate — le vulnerabilità del software Windows, una per riga
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Elenca le **CVE rilevate** sugli host Windows con inventario software, una per riga, con la gravità, quanti host
tocca e se esiste un aggiornamento automatico. Serve a ragionare per vulnerabilità invece che per host: si apre una
CVE e si aggiornano insieme tutti gli host vulnerabili.

Si arriva dalla scheda **CVE** in cima al [Patch Management](pagine/patch-management.md) (le altre due schede sono
**Panoramica** e [Storico](pagine/patch-management-history.md)). Le parti che si ripetono in tutte le pagine sono nelle
[parti comuni dell'interfaccia](../INTERFACCIA.md). Le immagini del manuale nascondono i codici e i titoli delle CVE.

## La barra in cima

![La barra delle CVE](/manuale/patch-management-cve/barra.png)

Sopra il titolo, `icona:arrow-left` **Patch Management** torna alla Panoramica. In alto a destra: quante CVE ci sono e la
pagina.

1. `tasto:history` **Storico operazioni**: apre lo [Storico](pagine/patch-management-history.md).
2. `tasto:refresh` **Aggiorna**: ricarica l'elenco.
3. `icona:search` **Cerca CVE o titolo…**: filtra per codice o per testo del titolo.
4. **Tutte le severità**: una gravità sola, Critical, High, Medium o Low.
5. **Solo con fix disponibile**: lascia solo le CVE che hanno un pacchetto Chocolatey per correggerle.

## La tabella

![L'elenco delle CVE](/manuale/patch-management-cve/tabella.png)

1. **CVSS**: il punteggio da 0 a 10 nel bollino colorato secondo la gravità; più alto è peggio.
2. **CVE ID**: il codice; un clic apre il [dettaglio della CVE](pagine/patch-management-cve-cveid.md). Anche il
   **Titolo** porta lì (passa il mouse per leggerlo intero).
3. **Fix**: `icona:shield-check` **Sì** se c'è un aggiornamento automatico, `icona:shield-question` **N/D** se manca
   (nessun pacchetto associato).

Le altre colonne: **Severity** (Critical, High, Medium, Low) e **Host** (quanti host vulnerabili). L'elenco parte dalle
più gravi. **Precedente** e **Successiva** sfogliano le pagine. La pagina non ha il menu `icona:more-vertical`, il tasto
destro né la selezione: le azioni si fanno nel dettaglio della CVE.

## Come si fa

- **Partire dalle più pericolose**: lascia l'ordine di serie, le più gravi stanno in cima.
- **Vedere cosa si può chiudere subito**: spunta **Solo con fix disponibile**.
- **Controllare una CVE di cui parla un bollettino**: scrivi il codice in **Cerca**, apri la riga.
- **Aggiornare tutti gli host colpiti da una CVE**: apri la CVE e lancia l'aggiornamento da lì.
- **Le CVE senza fix sono tante**: torna alla Panoramica e lancia `tasto:sparkles` **Calcola matching**.

## Cosa vogliono dire i segni

- Il bollino rosso con il numero: il CVSS.
- `icona:shield-check` **Sì** in **Fix**: si aggiorna con Chocolatey. `icona:shield-question` **N/D**: serve **Calcola
  matching** o un **Pin manuale**.

## Da dove arrivano i dati

Dall'inventario software degli host Windows (Wazuh e Scanner-Edge), incrociato con le vulnerabilità note.

## Se la pagina è vuota

**Nessuna CVE trovata**: serve almeno un host con inventario software e una vulnerabilità rilevata da Wazuh o
Scanner-Edge. Esegui una scansione dell'inventario dalla pagina dell'host, verifica le integrazioni, togli i filtri.
