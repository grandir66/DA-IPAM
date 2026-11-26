---
percorso: /analytics
titolo: Anomalie — disponibilità, latenza e cambi sospetti
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Elenca i **comportamenti fuori dal solito** che DA-IPAM trova confrontando ogni host con la sua storia: un MAC che
cambia sullo stesso indirizzo, un host sconosciuto apparso, porte aperte o chiuse, un apparato che è spento molto più
spesso del normale, una latenza molto più alta della media. Ogni riga è un evento da guardare e poi segnare come
**gestito**.

Si arriva dalla scheda [Cambiamenti](pagine/network-changes.md) (sotto **Network › Apparati**) con il collegamento
**Disponibilità e latenza anomale**; la scheda in cima resta accesa su «Cambiamenti». Menu, schede e tabelle
funzionano come in tutte le pagine: vedi le [parti comuni dell'interfaccia](../INTERFACCIA.md).

## La barra in cima

![La barra delle Anomalie](/manuale/analytics/barra.png)

Accanto al titolo `icona:alert-triangle` **Anomalie**, il numero rosso conta gli eventi non gestiti.

1. **Stato**: **Non gestiti** (all'apertura, gli eventi ancora aperti), **Gestiti**, **Tutti**.
2. **Tipo**: **Tutti i tipi** oppure uno solo fra **MAC flip**, **Nuovo host**, **Cambio porte**, **Uptime anomalo**,
   **Latenza anomala**. A destra, quanti eventi corrispondono.
3. `tasto:refresh` **Aggiorna**: rilegge l'elenco.
4. `tasto:play` **Esegui check**: rifà subito il controllo delle anomalie su tutti gli host, senza aspettare il giro
   programmato.

## La tabella

![La tabella degli eventi](/manuale/analytics/tabella.png)

1. **Severità**: **Alta**, **Media** o **Bassa**, sempre scritte per esteso.
2. **Stato**: `icona:alert-triangle` **Aperto**, oppure `icona:check-circle` **Gestito**.
3. **Gestisci**: segna l'evento come preso in carico. Esce dai «Non gestiti» e resta nello storico con chi l'ha
   gestito e quando.

| Colonna | Che cosa dice |
|---|---|
| **Tipo** | Che anomalia è (sotto). |
| **Severità** | Alta, Media, Bassa. |
| **Descrizione** | Cosa è successo, con indirizzi e valori. |
| **Rilevato** | Quando è stato trovato. |
| **Stato** | Aperto o Gestito. |

I tipi:

- **MAC flip**: sullo stesso indirizzo hanno risposto due schede di rete diverse. Può essere un apparato sostituito,
  una macchina virtuale spostata o qualcuno che usa l'indirizzo di un altro.
- **Nuovo host**: un host mai visto, con il suo MAC e le porte aperte.
- **Cambio porte**: porte aperte o chiuse rispetto all'ultima volta.
- **Uptime anomalo**: l'host è offline molto più spesso del solito (per esempio «100% offline, di solito 46%»).
- **Latenza anomala**: l'host risponde molto più lentamente della sua media.

In alto a destra della tabella, `icona:chevron-left` `icona:chevron-right` sfogliano le pagine, cinquanta eventi per
volta.

**Esegui check**, **Gestisci** e **Segna come gestito** si vedono anche in sola lettura, ma li esegue solo un
**amministratore**.

## Il dettaglio di un evento

![Il dettaglio di un evento](/manuale/analytics/dettaglio.png)

Un clic su una riga apre il dettaglio: la severità e il tipo in cima, la descrizione per intero e i valori di prima e
di adesso. Secondo il tipo:

- **MAC flip**: **MAC precedente** e **Nuovo MAC**, con il produttore;
- **Cambio porte**: **Porte aggiunte** e **Porte rimosse**;
- **Latenza anomala**: **Latenza attuale**, **Baseline** (la media, con lo scarto) e **Z-score** (quanto si allontana
  dalla media: più è alto, più è strano);
- **Uptime anomalo**: **Offline (recente)** e **Offline (baseline)**, in percentuale;
- **Nuovo host**: **MAC** e **Porte aperte**.

In fondo **Rilevato**, e `tasto:check-circle` **Segna come gestito**; un evento già gestito dice da chi e quando.

## Come si fa

- **Ripassare le anomalie della settimana**: lascia **Non gestiti**, apri ogni riga, e quando hai capito
  **Gestisci**.
- **Controllare un MAC flip**: apri la riga e confronta i produttori di **MAC precedente** e **Nuovo MAC**. Se
  l'apparato è stato davvero sostituito, gestisci l'evento; se no, cerca l'indirizzo fra gli
  [Apparati](pagine/discovery.md) e guarda chi è.
- **Vedere solo i problemi di rete lenta**: secondo menu › **Latenza anomala**.
- **Dopo aver sistemato un guasto**: `tasto:play` **Esegui check**, poi `tasto:refresh` **Aggiorna**.
- **Ritrovare chi ha gestito un evento**: primo menu › **Gestiti**, apri la riga.

## Cosa vogliono dire i segni

- **Alta**, **Media**, **Bassa**: la severità è sempre scritta, non solo colorata.
- `icona:alert-triangle` **Aperto**: evento non ancora gestito. `icona:check-circle` **Gestito**: preso in carico.

## Da dove arrivano i dati

Dal controllo delle anomalie, che gira con le scansioni programmate e confronta gli stati, i MAC, le porte e le
latenze di ogni host con la loro media. **Esegui check** lo fa partire subito.

## Se la pagina è vuota

Con «Non gestiti» vuol dire che tutti gli eventi sono stati presi in carico: scegli **Tutti** per lo storico. Su
un'istanza appena installata servono alcuni giorni di scansioni prima che DA-IPAM sappia cosa è «normale».
