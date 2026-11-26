---
percorso: /services
titolo: Servizi NIS2 — servizi e dipendenze
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È il **catalogo dei servizi** dell'azienda (posta, gestionale, sito, centralino, file server) con gli asset da cui
ciascuno dipende. La NIS2 chiede di sapere quali servizi si fermano se un asset viene compromesso o si guasta: questa
pagina tiene la mappa, con criticità, tempi massimi di ripristino (RTO) e di perdita dati (RPO) e i responsabili. Si
arriva da **Inventario › Servizi NIS2** nel menu; la voce c'è solo se il modulo NIS2 è acceso.

![La pagina Servizi NIS2](/manuale/services/pagina.png)

## Le voci della pagina

1. **Cerca per nome…**: filtra i servizi mentre scrivi. Accanto, il filtro **Stato** (Tutti, Attivo, In dismissione,
   Dismesso) e il filtro **Scope NIS2** (Tutti, Solo in scope NIS2, Fuori scope).
2. **Nuovo servizio**: apre la finestra per crearne uno. I campi sono **Nome** (obbligatorio), **Descrizione**,
   **Stato**, **Criticità** (Bassa, Media, Alta, Critica), **In scope NIS2**, **RTO (minuti)**, **RPO (minuti)**,
   **Business owner** e **Technical owner** (scelti fra gli [Assegnatari](pagine/inventory-assignees.md)), **URL SLA**,
   **Note**.

Le colonne dell'elenco, quando ci sono servizi:

- **Nome**, **Stato**, **NIS2** (il segno se il servizio è in perimetro).
- **Criticità**: Bassa, Media, Alta, Critica.
- **RTO**: entro quanto il servizio deve tornare in funzione. **RPO**: quanti minuti di dati si possono perdere al
  massimo.
- **Business owner**: chi risponde del servizio.
- **Asset linkati**: quanti asset ne fanno parte.
- **Apri**: apre la [scheda del servizio](pagine/services-id.md), dove si collegano gli asset.

## Come si usa

1. Premi **Nuovo servizio**, scrivi il nome, scegli la criticità, spunta **In scope NIS2** se serve e indica RTO e
   RPO.
2. Apri il servizio con **Apri** e collega gli asset da cui dipende, segnando quali sono **primari** (senza di loro il
   servizio si ferma).
3. Usa il filtro **Solo in scope NIS2** per preparare l'elenco da presentare all'audit.

## Da dove arrivano i dati

I servizi li scrive una persona; gli asset vengono dall'[inventario](pagine/inventory.md) e le persone dagli
[Assegnatari](pagine/inventory-assignees.md).

## Se la pagina è vuota

«Nessun servizio» vuol dire che il catalogo non è ancora stato compilato: premi **Nuovo servizio**. Se ci sono filtri
scelti, rimettili su **Tutti**.
