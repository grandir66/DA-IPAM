---
percorso: /patch-management/cve
titolo: CVE rilevate — le vulnerabilità del software Windows, una per riga
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Elenca le **CVE rilevate** sugli host Windows con inventario software, una per riga, con la gravità, quanti host
tocca e se esiste un aggiornamento automatico. Serve a ragionare per vulnerabilità invece che per host: si apre una
CVE e si aggiornano insieme tutti gli host vulnerabili.

Si arriva dalla scheda **CVE** del [Patch Management](pagine/patch-management.md). In alto a destra: quante CVE e la
pagina, **Storico operazioni** (porta allo [Storico](pagine/patch-management-history.md)) e **Aggiorna**.

![L'elenco delle CVE](/manuale/patch-management-cve/pagina.png)

## Le voci della pagina

1. **Cerca CVE o titolo...**: filtra per codice o per testo del titolo. Accanto, **Tutte le severità** sceglie una
   gravità sola (Critical, High, Medium, Low).
2. **Solo con fix disponibile**: lascia solo le CVE che hanno un pacchetto Chocolatey per correggerle.
3. **Fix**: **Sì** se c'è un aggiornamento automatico, **N/D** se manca (nessun pacchetto associato).

Le altre colonne: **CVSS** (il punteggio da 0 a 10), **Severity**, **CVE ID** (apre il
[dettaglio della CVE](pagine/patch-management-cve-cveid.md)), **Titolo**, **Host** (quanti host vulnerabili).
**Precedente** e **Successiva** sfogliano le pagine.

## Come si usa

1. Lascia l'ordine di serie: le più gravi stanno in cima.
2. Spunta **Solo con fix disponibile** per vedere cosa si può chiudere subito.
3. Clicca una riga per aprire la CVE e aggiornare gli host.

## Cosa vogliono dire i segni

- Il numero nel bollino rosso è il CVSS: più alto è peggio.
- **Sì** in **Fix**: si aggiorna con Chocolatey. **N/D**: serve **Calcola matching** o un **Pin manuale**.

## Da dove arrivano i dati

Dall'inventario software degli host Windows (Wazuh e Scanner-Edge), incrociato con le vulnerabilità note.

## Se la pagina è vuota

**Nessuna CVE trovata**: serve almeno un host con inventario software e una vulnerabilità rilevata da Wazuh o
Scanner-Edge. Esegui una scansione dell'inventario dalla pagina dell'host, verifica le integrazioni, togli i filtri.
