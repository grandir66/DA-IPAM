---
percorso: /services/[id]
titolo: Scheda di un servizio NIS2
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È la scheda di **un servizio** del catalogo NIS2: i suoi dati (criticità, RTO, RPO, responsabili) e l'elenco degli asset
da cui dipende. Serve per l'analisi d'impatto: se un asset si guasta o viene compromesso, si vede subito quali servizi
ne soffrono. Si apre con **Apri**, o con il nome del servizio, da [Servizi NIS2](pagine/services.md).

Nessuna schermata: sull'istanza usata per le immagini del manuale non c'è ancora nessun servizio da aprire. Le parti che
si ripetono in tutte le pagine sono nelle [parti comuni dell'interfaccia](../INTERFACCIA.md).

## La testata

- `icona:arrow-left` torna a [Servizi NIS2](pagine/services.md).
- In cima il nome del servizio, `icona:shield` **NIS2** se è in perimetro, e sotto «Servizio NIS2 — N asset linkati (M
  primari)».
- `tasto:trash` **Elimina** (in alto a destra): cancella il servizio dopo una conferma; i collegamenti agli asset
  vengono tolti, gli asset restano.

**La fascia gialla** «▲ Servizio in scope NIS2 senza asset primari» compare quando il servizio è in perimetro NIS2 ma
non ha nessun asset segnato come primario: per l'analisi d'impatto serve almeno un asset critico come primario.

## Anagrafica servizio

I campi: **Nome**, **Descrizione**, **Stato** (Attivo, In dismissione, Dismesso), **Criticità** (Bassa, Media, Alta,
Critica), **In scope NIS2**, **RTO (min)**, **RPO (min)**, **Business owner** e **Technical owner** (fra gli
[Assegnatari](pagine/inventory-assignees.md); `tasto:plus` ne crea uno al volo), **URL SLA**, **Note**. **Salva** scrive
le modifiche di questo riquadro.

## Asset di cui il servizio dipende

Il titolo dice quanti sono. Le colonne:

| Colonna | Che cosa dice |
|---|---|
| **Asset** | L'asset tag o il nome; un clic, o `icona:external-link`, apre la [scheda dell'asset](pagine/inventory-id.md). Sotto, il nome dell'host se è diverso. |
| **Tipo dipendenza** | Primario, Secondario o Supporto (vedi sotto). |
| **Criticità asset** | La criticità NIS2 scritta nella scheda dell'asset. |
| **Note** | La nota del collegamento. |

`icona:trash` in fondo alla riga **scollega** l'asset dal servizio, dopo una conferma; l'asset resta in inventario.

`tasto:plus` **Collega asset** apre la finestra per aggiungerne uno:

- **Asset**: si sceglie dalla tendina (sono mostrati i primi 200: se non lo trovi, cerca per nome);
- **Tipo dipendenza**;
- **Note (opzionale)**, per esempio «master database, fallback su replica».

**Collega** salva, **Annulla** chiude. Il pulsante è grigio quando tutti gli asset sono già collegati.

I tre tipi di dipendenza:

- **Primario**: il servizio non funziona senza.
- **Secondario**: senza, il servizio funziona peggio.
- **Supporto**: utile ma non critico.

Salvare, collegare, scollegare ed eliminare cambia i dati: riesce solo a un amministratore.

## Come si fa

- **Completare i dati di un servizio**: compila l'**Anagrafica servizio**, **Salva**.
- **Dire che la posta dipende da due server**: `tasto:plus` **Collega asset** per il primo, Tipo **Primario**,
  **Collega**; ripeti per il secondo.
- **Togliere la fascia gialla**: collega, o ricollega, come **Primario** l'asset senza cui il servizio si ferma.
- **Un server è stato dismesso**: `icona:trash` sulla sua riga per scollegarlo, poi collega quello nuovo.
- **Togliere un servizio che non esiste più**: `tasto:trash` **Elimina**, oppure Stato **Dismesso** per tenerne la
  storia.

## Da dove arrivano i dati

Il servizio lo scrive una persona; gli asset vengono dall'[inventario](pagine/inventory.md) e le persone dagli
[Assegnatari](pagine/inventory-assignees.md). La stessa relazione si vede dal lato dell'asset, nella scheda
[Servizi](pagine/inventory-id.md#servizi) della scheda dell'asset.

## Se la pagina è vuota

«Servizio non trovato» vuol dire che è stato eliminato o che l'indirizzo è sbagliato: torna a
[Servizi NIS2](pagine/services.md). «Nessun asset collegato» vuol dire che le dipendenze non sono ancora state inserite:
premi `tasto:plus` **Collega asset**.
