---
percorso: /services/[id]
titolo: Scheda di un servizio NIS2
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È la scheda di **un servizio** del catalogo NIS2: i suoi dati (criticità, RTO, RPO, responsabili) e l'elenco degli asset
da cui dipende. Serve per l'analisi d'impatto: se un asset si guasta o viene compromesso, si vede subito quali servizi
ne soffrono. Si apre con **Apri** da [Servizi NIS2](pagine/services.md); la freccia in alto a sinistra torna al
catalogo.

In cima c'è il nome del servizio, il segno **NIS2** se è in perimetro e il conteggio «N asset linkati (M primari)».

Nessuna schermata: sull'istanza usata per le immagini del manuale non c'è ancora nessun servizio da aprire.

## Le voci della pagina

- **Elimina** (in alto a destra): cancella il servizio dopo una conferma; i collegamenti agli asset vengono tolti, gli
  asset restano.
- **La fascia gialla** «Servizio in scope NIS2 senza asset primari»: compare quando il servizio è in perimetro NIS2 ma
  non ha nessun asset segnato come primario. Per l'analisi d'impatto serve almeno un asset critico come primario.
- **Anagrafica servizio**: Nome, Descrizione, Stato, Criticità, In scope NIS2, RTO (min), RPO (min), Business owner,
  Technical owner, URL SLA, Note. **Salva** scrive le modifiche di questo riquadro.
- **Asset di cui il servizio dipende**: la tabella degli asset collegati, con le colonne **Asset**, **Tipo
  dipendenza**, **Criticità asset**, **Note** e, in fondo alla riga, il pulsante per **scollegare** l'asset (dopo una
  conferma).
- **Collega asset**: apre la finestra per aggiungere un asset. Si sceglie l'**Asset** (sono mostrati i primi 200: se
  non lo trovi, cerca per nome), il **Tipo dipendenza** e, se serve, una **Nota** (es. «master database, fallback su
  replica»). **Collega** salva, **Annulla** chiude. Il pulsante è grigio quando tutti gli asset sono già collegati.

I tre tipi di dipendenza:

- **Primario**: il servizio non funziona senza.
- **Secondario**: senza, il servizio funziona peggio.
- **Supporto**: utile ma non critico.

## Come si usa

1. Controlla e completa l'**Anagrafica servizio**, poi premi **Salva**.
2. Premi **Collega asset** per ogni asset da cui il servizio dipende, scegliendo il tipo di dipendenza.
3. Se compare la fascia gialla, segna come **Primario** almeno l'asset senza cui il servizio si ferma.

## Da dove arrivano i dati

Il servizio lo scrive una persona; gli asset vengono dall'[inventario](pagine/inventory.md) e le persone dagli
[Assegnatari](pagine/inventory-assignees.md). La stessa relazione si vede dal lato dell'asset, nella scheda **Servizi**
della [scheda dell'asset](pagine/inventory-id.md).

## Se la pagina è vuota

«Servizio non trovato» vuol dire che è stato eliminato o che l'indirizzo è sbagliato: torna a
[Servizi NIS2](pagine/services.md). «Nessun asset collegato» vuol dire che le dipendenze non sono ancora state inserite:
premi **Collega asset**.
