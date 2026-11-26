---
percorso: /zabbix/agenti
titolo: Agenti di DatIA Mon
versione: 0.9.1369
aggiornata: 2026-11-26
---

## A cosa serve

L'elenco degli apparati a cui **serve l'agente di Zabbix** (Windows e Linux), con lo stato dell'agente, e il comando per
installarlo. È la stessa tabella di [Apparati](pagine/zabbix-apparati.md) vista dal lato dell'agente: filtri, colonne,
tasto destro e scheda di lato funzionano allo stesso modo. Solo per amministratori.

## Le voci della pagina

- I pulsanti con i conteggi: **Tutti**, **Da installare** (l'apparato non è ancora in Zabbix), **Non manda dati**
  (è in Zabbix ma l'agente tace), **Attivo**, **Non so**.
- Le colonne di serie: **Agente**, **Apparato**, **IP**, **Sistema**, **Nome in Zabbix** (quello che l'agente deve
  dichiarare), **Stato**, **Rete · VLAN**, **Proxy**.
- **Prepara l'agente…** sui selezionati: un comando per macchina, oppure uno solo per tutte che usa il nome della
  macchina (per GPO o Intune). L'agente lo installa sempre una persona.

## Come si usa

1. Premi **Da installare** o **Non manda dati**.
2. Spunta le macchine e premi **Prepara l'agente…**.
3. Copia o scarica il comando e fallo lanciare sulla macchina; entro qualche minuto lo stato diventa **Attivo**.

## Da dove arrivano i dati

Dal centro Zabbix di Domarc (stato dell'agente) e dagli host di DA-IPAM (quali sono Windows o Linux).
