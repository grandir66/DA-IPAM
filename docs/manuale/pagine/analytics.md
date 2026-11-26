---
percorso: /analytics
titolo: Anomalie — disponibilità, latenza e cambi sospetti
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Elenca i **comportamenti fuori dal solito** che DA-IPAM trova confrontando ogni host con la sua storia: un MAC che
cambia sullo stesso indirizzo, un host sconosciuto apparso, porte aperte o chiuse, un apparato che è spento molto più
spesso del normale, una latenza molto più alta della media. Ogni riga è un evento da guardare e poi segnare come
**gestito**.

Si arriva dalla scheda **Cambiamenti** (sotto **Network › Apparati**) con il collegamento **Disponibilità e latenza
anomale**; la scheda in cima resta accesa su «Cambiamenti».

![La pagina Anomalie](/manuale/analytics/pagina.png)

## Le voci della pagina

1. **Stato**: **Non gestiti** (di serie, gli eventi ancora aperti), **Gestiti**, **Tutti**.
2. **Tipo**: **Tutti i tipi** oppure uno solo fra **MAC flip**, **Nuovo host**, **Cambio porte**, **Uptime anomalo**,
   **Latenza anomala**. A destra c'è il numero di eventi che corrispondono.
3. **Aggiorna**: rilegge l'elenco.
4. **Esegui check**: rifà subito il controllo delle anomalie su tutti gli host, senza aspettare il giro programmato.
5. **Gestisci**: segna l'evento come preso in carico. Esce dai «Non gestiti» e resta nello storico con chi l'ha
   gestito e quando.

Il numero rosso accanto al titolo **Anomalie** conta gli eventi non gestiti. Le frecce in alto a destra della tabella
sfogliano le pagine.

Le colonne:

- **Tipo**: che anomalia è.
  - **MAC flip**: sullo stesso indirizzo hanno risposto due schede di rete diverse. Può essere un apparato sostituito,
    una macchina virtuale spostata o qualcuno che usa l'indirizzo di un altro.
  - **Nuovo host**: un host mai visto, con il suo MAC e le porte aperte.
  - **Cambio porte**: porte aperte o chiuse rispetto all'ultima volta.
  - **Uptime anomalo**: l'host è offline molto più spesso del solito (per esempio «100% offline, di solito 46%»).
  - **Latenza anomala**: l'host risponde molto più lentamente della sua media.
- **Severità**: **Alta**, **Media** o **Bassa**, scritte per esteso.
- **Descrizione**: cosa è successo, con indirizzi e valori.
- **Rilevato**: quando è stato trovato.
- **Stato**: **Aperto** col triangolo, oppure gestito.

Un clic su una riga apre il dettaglio: la descrizione per intero, i valori di prima e di adesso (MAC precedente e
nuovo, porte aggiunte e rimosse, latenza attuale e media, percentuale di tempo offline) e il pulsante per gestirla.

## Come si usa

1. Lascia **Non gestiti**: sono gli eventi da guardare.
2. Apri una riga per leggere i valori. Per un **MAC flip** controlla se l'apparato è stato cambiato davvero.
3. Quando hai capito, premi **Gestisci**.
4. Per vedere solo un tipo di problema sceglilo nel secondo menu.

Gestire un evento e lanciare il controllo spetta a chi ha il ruolo di amministratore.

## Cosa vogliono dire i segni

- **Alta**, **Media**, **Bassa**: la severità è sempre scritta, non solo colorata.
- ⚠ **Aperto**: evento non ancora gestito.

## Da dove arrivano i dati

Dal controllo delle anomalie, che gira con le scansioni programmate e confronta gli stati, i MAC, le porte e le
latenze di ogni host con la loro media. **Esegui check** lo fa partire subito.

## Se la pagina è vuota

Con «Non gestiti» vuol dire che tutti gli eventi sono stati presi in carico: scegli **Tutti** per lo storico. Su
un'istanza appena installata servono alcuni giorni di scansioni prima che DA-IPAM sappia cosa è «normale».
