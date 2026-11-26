---
percorso: /zabbix/centro
titolo: Centro e proxy di DatIA Mon
versione: 0.9.1369
aggiornata: 2026-11-26
---

## A cosa serve

Dice **a quale centro Zabbix** questa installazione è collegata, se **si legge** e se **si scrive**, e come sta il
**proxy**. Si legge soltanto: i cambi si fanno con **Apri la configurazione**. Solo per amministratori.

## Le voci della pagina

- **La riga di stato**: «si legge», «si legge, dati vecchi», «non si legge» (con il motivo) o «lettura spenta»; accanto
  «si scrive» o «sola lettura».
- **Lettura**: indirizzo del centro, codice cliente, identificativo della chiave di lettura (mai la chiave), se il
  certificato è fissato, ultima lettura riuscita, ultimo errore.
- **Scrittura**: identificativo della chiave di scrittura o «▲ manca», chi l'ha inserita e quando, se si può scrivere e
  perché no, i tetti del centro (10 scritture al minuto, 100 apparati aggiunti al giorno).
- **Proxy**: quello su questa macchina (gira, fermo, non installato) e quelli che il centro vede per questo cliente
  (in linea o no).

## Cosa resta fuori

Creare o spostare un proxy, registrare il cliente e le sue reti si fanno in DA-Link e in DA-Zabbix.
