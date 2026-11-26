---
percorso: /settings/mdm
titolo: MDM (Headwind) — i telefoni Android gestiti, come host
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Collega DA-IPAM al server **Headwind MDM**, che gestisce i telefoni e i tablet Android dell'azienda. Una volta
collegato, i dispositivi mobili vengono importati come host e la loro scheda si arricchisce con i dati dell'MDM.
È un modulo opzionale. Si arriva da **Impostazioni › Moduli**, con **Apri** sulla riga **MDM (Headwind)**. È
riservata agli amministratori: chi non lo è torna alle impostazioni.

![La pagina MDM](/manuale/settings-mdm/pagina.png)

## Le voci della pagina

Il riquadro **Connessione Headwind MDM**:

- **URL base**: l'indirizzo del pannello Headwind MDM.
- **Username** e **Password**: l'account con cui DA-IPAM legge il pannello. La password viene salvata cifrata e
  non si rivede: per tenere quella già salvata si lascia il campo vuoto.
- **Campo utente (mappa il profilo utente del dispositivo)**: quale campo di Headwind contiene il nome di chi usa il
  dispositivo (per esempio **Descrizione**).
- **Stato**: la casella **Integrazione MDM attiva** accende la sincronizzazione automatica (ogni 60 minuti) e crea
  il job pianificato; togliendo la spunta il job sparisce. Dopo 5 errori di fila la sincronizzazione si spegne da
  sola: riaccenderla azzera il contatore.
- **Salva** registra; **Sincronizza ora** fa subito un giro di importazione.

Il riquadro **Stato sincronizzazione** dice com'è andata: **Ultimo tentativo**, **Ultima riuscita**, **Errori
consecutivi** e **Ultimo errore**.

## Come si usa

1. Scrivi URL, utente e password del pannello Headwind, scegli il campo utente, **Salva**.
2. Premi **Sincronizza ora** e guarda **Stato sincronizzazione**: se c'è un errore, lo spiega l'ultima riga.
3. Se va bene, spunta **Integrazione MDM attiva** e **Salva**: da lì in poi la sincronizzazione è automatica.

## Da dove arrivano i dati

Dal pannello Headwind MDM, letto a ogni sincronizzazione. I dispositivi importati compaiono fra gli
[apparati](pagine/discovery.md).

## Se la pagina è vuota

«Mai» nelle date vuol dire che non c'è ancora stata una sincronizzazione: configura la connessione e premi
**Sincronizza ora**.
