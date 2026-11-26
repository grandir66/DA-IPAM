---
percorso: /zabbix/modelli
titolo: Modelli di DatIA Mon
versione: 0.9.1369
aggiornata: 2026-11-26
---

## A cosa serve

Mostra i **modelli di Zabbix** che il centro lascia collegare, famiglia per famiglia, e **quanti apparati** li hanno.
Si legge soltanto: per aggiungere o togliere un modello si va agli apparati. Solo per amministratori.

## Le voci della pagina

- **Cerca modello o famiglia**: filtra mentre scrivi.
- **Tutti** / **Solo in uso**: tutti i modelli dell'elenco, o solo quelli che almeno un apparato ha.
- Le colonne: **Famiglia**, **Modello**, **Nell'elenco del centro** («● sì», oppure «▲ no, fuori elenco» quando un
  apparato ha un modello che il centro non propone per quella famiglia), **Apparati che lo hanno**.
- **Vedi gli apparati**: apre [Apparati](pagine/zabbix-apparati.md) già filtrata su quel modello e quella famiglia; lì
  si usa **Aggiungi un modello…** o **Togli un modello…**.

## Da dove arrivano i dati

Dal centro Zabbix di Domarc: l'elenco dei modelli adatti a ogni famiglia e i modelli collegati a ogni apparato.

## Se la pagina è vuota

«Il centro non si legge» con il motivo: vedi [Centro e proxy](pagine/zabbix-centro.md).
