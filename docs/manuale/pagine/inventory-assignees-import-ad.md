---
percorso: /inventory/assignees/import-ad
titolo: Importa gli assegnatari da Active Directory
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Propone gli **utenti di Active Directory** da portare fra gli [Assegnatari](pagine/inventory-assignees.md): quelli nuovi
da creare e quelli già presenti con dati da aggiornare (mail, reparto, ruolo). Esclude da sola gli account di servizio,
gli amministrativi, i disattivati, quelli senza nome e cognome e quelli che non si collegano da tempo. **Nessun asset
viene toccato**: si importano solo le persone. Si arriva da `tasto:users` **Importa da Active Directory** nella pagina
Assegnatari.

Le parti che si ripetono in tutte le pagine sono nelle [parti comuni dell'interfaccia](../INTERFACCIA.md).

## La testata e i filtri

![La testata e i filtri](/manuale/inventory-assignees-import-ad/filtri.png)

In alto a destra c'è il dominio letto e quando sono stati letti gli utenti l'ultima volta («utenti letti oggi 07:01»).

1. `icona:arrow-left` torna agli [Assegnatari](pagine/inventory-assignees.md).
2. **Rileggi da AD**: apre la pagina [Active Directory](pagine/active-directory.md), da dove si rilegge il dominio se gli
   utenti sono vecchi.
3. **Solo account abilitati**: lascia fuori gli account spenti.
4. **Con nome e cognome**: lascia fuori gli account senza nome, che di solito sono tecnici.
5. **Accesso negli ultimi**: 30, 90 (di serie), 180 giorni o sempre; lascia fuori chi non si collega da più tempo.
6. **Unità organizzativa**: Tutte, o solo gli utenti di una OU di AD.

Cambiando un filtro l'elenco torna alla prima pagina e la spunta torna quella di serie.

## I riquadri

![I quattro riquadri](/manuale/inventory-assignees-import-ad/riquadri.png)

- **nuovi, proposti**: persone da creare.
- **già presenti, dati da aggiornare**: persone che ci sono già, con mail, reparto o ruolo cambiati in AD.
- **▲ da controllare**: casi dubbi, per esempio senza mail o con un nome già usato da un'altra persona.
- **esclusi (servizio, disattivati, senza nome…)**: lasciati fuori dai filtri e dalle regole.

I riquadri contano e basta: non sono cliccabili.

## L'elenco degli utenti proposti

![L'elenco degli utenti proposti](/manuale/inventory-assignees-import-ad/tabella.png)

La spunta è già messa sui nuovi e su quelli da aggiornare; la casella nell'intestazione prende o lascia tutti quelli
della pagina.

| Colonna | Che cosa dice |
|---|---|
| **Nome**, **Cognome** | Come scritti in AD. Un trattino rosso: manca. |
| **Account** | Il nome di accesso. |
| **Mail**, **Reparto**, **Ruolo** | Dati di AD; passa il mouse su un valore tagliato per leggerlo intero. |
| **Ultimo accesso** | L'ultimo accesso al dominio. |
| **PC dove si collega** | I computer dove l'utente è stato visto, o «nessuno visto». |
| **Esito** | Cosa succede importandolo: ✓ nuovo, ● già presente (da aggiornare o invariato), ▲ da controllare con il motivo («Manca mail»). |

Le righe da controllare hanno il fondo giallo chiaro. Sotto, «1–50 di N» con **pagina precedente** e **pagina
successiva**: la spunta resta passando da una pagina all'altra.

**Esclusi (N) — perché non sono proposti** si apre con un clic e dice quanti ne sono stati lasciati fuori per ogni
motivo (account di servizio, amministrativi, disattivati, senza nome e cognome, senza accessi nel periodo), con qualche
esempio.

## La barra in fondo

![La barra dell'importazione](/manuale/inventory-assignees-import-ad/conferma.png)

Riassume la scelta: quanti selezionati, quanti da creare, quanti da aggiornare. **Annulla** torna agli Assegnatari
senza importare; **Importa N utenti** crea e aggiorna le persone scelte, poi torna all'elenco e un messaggio dice
quanti nuovi, quanti aggiornati e quanti non più in AD. L'importazione cambia i dati: riesce solo a un amministratore.

## Come si fa

- **Prima importazione**: lascia i filtri di serie, togli la spunta dai ▲ dubbi, **Importa N utenti**.
- **Gli utenti sono di settimane fa**: **Rileggi da AD**, rileggi il dominio, torna qui.
- **Importare solo un ufficio**: **Unità organizzativa** › la OU di quell'ufficio.
- **Recuperare chi è in ferie da mesi**: **Accesso negli ultimi** › 180 giorni o sempre.
- **Aggiornare i reparti dopo una riorganizzazione**: guarda il riquadro **già presenti, dati da aggiornare**, lascia la
  spunta, **Importa**.

## Cosa vogliono dire i segni

Nella colonna **Esito**: ✓ verde per i nuovi, ● grigio per gli aggiornamenti e per chi resta com'è, ▲ giallo per i
casi da controllare.

## Da dove arrivano i dati

Dagli utenti che DA-IPAM ha letto da Active Directory e dagli accessi ai PC (per la colonna «PC dove si collega»).

## Se la pagina è vuota

«Nessuna integrazione Active Directory su questo cliente» vuol dire che AD non è configurata: **Configurala** porta alla
pagina [Active Directory](pagine/active-directory.md). «Nessun utente da proporre con questi filtri» vuol dire che i
filtri lasciano fuori tutti: prova **Accesso negli ultimi › sempre** o togli **Con nome e cognome**.
