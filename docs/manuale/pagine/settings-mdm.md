---
percorso: /settings/mdm
titolo: MDM (Headwind) — i telefoni Android gestiti, come host
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Collega DA-IPAM al server **Headwind MDM**, che gestisce i telefoni e i tablet Android dell'azienda. Una volta
collegato, i dispositivi mobili vengono importati come host e la loro scheda si arricchisce con i dati dell'MDM.
È un modulo opzionale. Si arriva da **Impostazioni › Moduli**, con **Apri** sulla riga **MDM (Headwind)** (vedi
[Impostazioni](pagine/settings.md#moduli)). È riservata agli amministratori: chi è in sola lettura viene riportato
alle impostazioni. Menu e parti comuni: [parti comuni dell'interfaccia](../INTERFACCIA.md).

## La connessione

![Il riquadro Connessione Headwind MDM](/manuale/settings-mdm/pagina.png)

1. **URL base**: l'indirizzo del pannello Headwind MDM, con la porta (per esempio `http://indirizzo:8088`).
2. **Username** e, sotto, **Password**: l'account con cui DA-IPAM legge il pannello. La password viene salvata
   cifrata e non si rivede: per tenere quella già salvata si lascia il campo vuoto.
3. **Campo utente (mappa il profilo utente del dispositivo)**: quale campo di Headwind contiene il nome di chi usa il
   dispositivo. Valori: **Descrizione (description)**, **Campo personalizzato 1 (custom1)**, **2 (custom2)**,
   **3 (custom3)**.
4. **Stato**: finché la connessione non è salvata c'è la casella **Integrazione MDM attiva (sincronizzazione
   automatica ogni 60 minuti)**; accesa, crea il job pianificato «mdm_sync», spenta lo toglie. Dopo il primo
   salvataggio la casella diventa una riga **ACCESA**/**SPENTA** con **cambia da Opzioni ›**: da lì in poi si accende e
   si spegne da [Opzioni](pagine/settings-opzioni.md). Dopo 5 errori di fila la sincronizzazione si spegne da sola:
   riaccenderla azzera il contatore.
5. `tasto:save` **Salva** registra i campi.
6. `tasto:refresh` **Sincronizza ora** fa subito un giro di importazione; sotto compare l'esito («Sincronizzazione
   completata: N dispositivi, M modifiche», oppure l'errore in rosso).

Con l'URL scritto compare anche `icona:external-link` **Apri pannello Headwind**, che apre il pannello in una scheda
nuova.

## Lo stato della sincronizzazione

![Il riquadro Stato sincronizzazione](/manuale/settings-mdm/stato.png)

- **Ultimo tentativo** e **Ultima riuscita**: data e ora, oppure «Mai».
- **Errori consecutivi**: quanti giri di fila sono falliti (il limite è 5).
- **Ultimo errore**: il messaggio dell'ultimo giro fallito, «—» se non ce ne sono.

## Come si fa

- **Collegare il pannello la prima volta**: scrivi URL, Username e Password, scegli il Campo utente, `tasto:save`
  **Salva**, poi `tasto:refresh` **Sincronizza ora** e leggi l'esito.
- **Accendere la sincronizzazione automatica**: dopo una prova riuscita, nella riga **Stato** usa **cambia da
  Opzioni ›** e accendi il modulo.
- **La sincronizzazione si è spenta da sola**: leggi **Ultimo errore** (di solito password cambiata o pannello non
  raggiungibile), correggi il campo, **Salva**, **Sincronizza ora**, poi riaccendila da Opzioni.
- **Cambiare la password dell'account MDM**: scrivi solo la nuova Password e **Salva**; gli altri campi restano.
- **Vedere a chi è assegnato un telefono**: se il nome sta in un campo personalizzato di Headwind, scegli quel campo
  in **Campo utente**, **Salva** e **Sincronizza ora**.

## Da dove arrivano i dati

Dal pannello Headwind MDM, letto a ogni sincronizzazione. I dispositivi importati compaiono fra gli
[apparati](pagine/discovery.md).

## Se la pagina è vuota

«Mai» nelle date vuol dire che non c'è ancora stata una sincronizzazione: configura la connessione e premi
`tasto:refresh` **Sincronizza ora**.
