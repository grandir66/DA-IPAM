---
percorso: /monitoring/known-hosts
titolo: Monitoraggio host conosciuti
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Elenca gli **host conosciuti**, cioè quelli che qualcuno ha segnato come da tenere d'occhio (server, apparati di rete,
stampanti importanti), con lo stato dell'ultimo controllo: se rispondono, quando hanno risposto l'ultima volta e con
quanta latenza. Gli host che non rispondono sono evidenziati. Si arriva dalla [Dashboard](pagine/dashboard.md), dal
riquadro degli host monitorati o dal collegamento «Segna gli host da tenere d'occhio».

Le tabelle funzionano come in tutte le pagine: vedi le [parti comuni dell'interfaccia](../INTERFACCIA.md). Questa
pagina non ha ricerca, filtri né tasto destro: è un elenco corto da guardare a colpo d'occhio.

## Il pulsante in cima

![Il pulsante Verifica ora](/manuale/monitoring-known-hosts/barra.png)

1. `tasto:activity` **Verifica ora**: fa subito il controllo (ping e prova TCP) su tutti gli host dell'elenco, come il
   lavoro programmato «Monitoraggio host conosciuti». Con molti host può richiedere un po' di tempo: il pulsante dice
   «Verifica in corso…» finché non ha finito, poi un messaggio in basso a destra dà l'esito e la tabella si aggiorna.
   Il pulsante si vede anche in sola lettura, ma la verifica la avvia solo un **amministratore**; è spento se l'elenco
   è vuoto.

## La tabella

![La tabella degli host conosciuti](/manuale/monitoring-known-hosts/tabella.png)

Nella schermata la colonna dei nomi è sfocata.

1. **Stato**: ● **Online** se l'host ha risposto all'ultimo controllo, **Offline** se no. Accanto agli host che non
   rispondono (o mai provati) compare il segno **Irraggiungibile** e la riga ha il fondo rosato.
2. **Latenza ms**: il tempo di risposta all'ultimo controllo, in millisecondi.
3. `icona:external-link` apre la [scheda dell'host](pagine/objects-id.md).

| Colonna | Che cosa dice |
|---|---|
| **Rete** | Il nome della subnet e il suo indirizzo. |
| **IP** | L'indirizzo. Un clic lo copia. |
| **Hostname / nome** | Il nome dato a mano, oppure quello letto dalla rete o dal DNS inverso. |
| **Stato** | Online, Offline o Sconosciuto, più **Irraggiungibile** quando non risponde. |
| **Ultimo contatto** | Data e ora dell'ultima risposta. |
| **Latenza ms** | Il tempo di risposta all'ultimo controllo. |

## Come si fa

- **Sapere se un server importante è giù**: cerca le righe col fondo rosato e il segno **Irraggiungibile**.
- **Controllare un apparato appena riacceso**: `tasto:activity` **Verifica ora**, senza aspettare il prossimo giro.
- **Aggiungere host all'elenco**: apri la [pagina della subnet](pagine/networks-id.md) (**Network › Subnet**),
  seleziona gli indirizzi e usa **Segna come conosciuti**.
- **Capire da quanto non risponde**: guarda **Ultimo contatto**; per lo storico della latenza apri la scheda con
  `icona:external-link`.

## Cosa vogliono dire i segni

- ● **Online** (verde): ha risposto all'ultimo controllo.
- **Offline** o **Sconosciuto** con **Irraggiungibile** (rosso): non ha risposto, oppure non è mai stato provato.

## Da dove arrivano i dati

Dal lavoro programmato «Monitoraggio host conosciuti», che prova gli host a intervalli regolari con ping e connessioni
TCP. Gli orari si cambiano dalle [Schedulazioni](pagine/settings-schedulazioni.md) nelle impostazioni.

## Se la pagina è vuota

«Nessun host conosciuto» vuol dire che nessuno è stato ancora segnato: dalla scheda di una rete seleziona gli IP e usa
**Segna come conosciuti**.
