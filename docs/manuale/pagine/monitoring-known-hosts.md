---
percorso: /monitoring/known-hosts
titolo: Monitoraggio host conosciuti
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Elenca gli **host conosciuti**, cioè quelli che qualcuno ha segnato come da tenere d'occhio (server, apparati di rete,
stampanti importanti), con lo stato dell'ultimo controllo: se rispondono, quando hanno risposto l'ultima volta e con
quanta latenza. Gli host che non rispondono sono evidenziati. Si arriva dalla **Dashboard**, dal riquadro degli host
monitorati o dal collegamento «Segna gli host da tenere d'occhio».

![La pagina Monitoraggio host conosciuti](/manuale/monitoring-known-hosts/pagina.png)

## Le voci della pagina

1. **Verifica ora**: fa subito il controllo (ping e prova TCP) su tutti gli host dell'elenco, come il lavoro programmato
   «Monitoraggio host conosciuti». Con molti host può richiedere un po' di tempo; il pulsante dice «Verifica in corso…»
   finché non ha finito.
2. **Stato**: **Online** se l'host ha risposto all'ultimo controllo, **Offline** se no. Accanto agli host che non
   rispondono compare il segno **Irraggiungibile** e la riga ha il fondo rosato.

Le altre colonne:

- **Rete**: il nome e l'indirizzo della subnet.
- **IP**: un clic lo copia.
- **Hostname / nome**: il nome dato a mano, oppure quello letto dalla rete o dal DNS inverso.
- **Ultimo contatto**: data e ora dell'ultima risposta.
- **Latenza ms**: il tempo di risposta all'ultimo controllo, in millisecondi.
- **La freccia** in fondo alla riga apre la scheda dell'host.

## Come si usa

1. Per sapere se un server importante è giù, cerca la riga con **Irraggiungibile**.
2. Dopo aver riacceso un apparato, premi **Verifica ora** per aggiornare lo stato senza aspettare il prossimo giro.
3. Per aggiungere host all'elenco, apri la scheda della rete (**Network › Subnet**), seleziona gli indirizzi e usa
   **Segna come conosciuti**.

## Cosa vogliono dire i segni

- ● **Online** (verde): ha risposto all'ultimo controllo.
- **Offline** o **Sconosciuto** con **Irraggiungibile** (rosso): non ha risposto, oppure non è mai stato provato.

## Da dove arrivano i dati

Dal lavoro programmato «Monitoraggio host conosciuti», che prova gli host a intervalli regolari con ping e connessioni
TCP. Gli orari si cambiano dalle Schedulazioni nelle impostazioni.

## Se la pagina è vuota

«Nessun host conosciuto» vuol dire che nessuno è stato ancora segnato: dalla scheda di una rete seleziona gli IP e usa
**Segna come conosciuti**.
