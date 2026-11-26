---
percorso: /services
titolo: Servizi NIS2 — servizi e dipendenze
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È il **catalogo dei servizi** dell'azienda (posta, gestionale, sito, centralino, file server) con gli asset da cui
ciascuno dipende. La NIS2 chiede di sapere quali servizi si fermano se un asset viene compromesso o si guasta: questa
pagina tiene la mappa, con criticità, tempi massimi di ripristino (RTO) e di perdita dati (RPO) e i responsabili. Si
arriva da **Inventario › Servizi NIS2** nel menu; la voce c'è solo se il modulo NIS2 è acceso. La pagina non ha schede
in cima.

Le parti che si ripetono in tutte le pagine sono nelle [parti comuni dell'interfaccia](../INTERFACCIA.md).

## La barra del catalogo

![La barra del catalogo dei servizi](/manuale/services/barra.png)

Il titolo del riquadro dice quanti servizi ci sono («Catalogo servizi (6)»).

1. `icona:search` **Cerca per nome…**: filtra i servizi mentre scrivi.
2. **Stato**: Tutti, Attivo, In dismissione, Dismesso.
3. **Scope NIS2**: Tutti, Solo in scope NIS2, Fuori scope.
4. `tasto:plus` **Nuovo servizio**: apre la finestra per crearne uno (sotto).

## L'elenco

| Colonna | Che cosa dice |
|---|---|
| **Nome** | Il servizio, con la descrizione sotto. Un clic, o `icona:external-link`, apre la [scheda del servizio](pagine/services-id.md). |
| **Stato** | Attivo, In dismissione, Dismesso. |
| **NIS2** | `icona:shield` **NIS2** se il servizio è nel perimetro, il trattino se no. |
| **Criticità** | bassa, media, alta, critica. |
| **RTO** | Entro quanti minuti il servizio deve tornare in funzione. |
| **RPO** | Quanti minuti di dati si possono perdere al massimo. |
| **Business owner** | Chi risponde del servizio. |
| **Asset linkati** | Quanti asset ne fanno parte, e fra parentesi quanti sono **primari** (senza di loro il servizio si ferma). |

In fondo alla riga **Apri** apre la [scheda del servizio](pagine/services-id.md), dove si collegano gli asset. La pagina
non ha il menu `icona:more-vertical`, il tasto destro né la selezione di più righe.

## La finestra Nuovo servizio

![La finestra Nuovo servizio](/manuale/services/nuovo.png)

- **Nome** (obbligatorio) e **Descrizione**.
- **Stato**: Attivo, In dismissione, Dismesso.
- **Criticità**: Bassa, Media, Alta, Critica.
- **In scope NIS2**: spuntato di serie.
- **RTO (minuti)** e **RPO (minuti)**.
- **Business owner** e **Technical owner**, scelti fra gli [Assegnatari](pagine/inventory-assignees.md); `tasto:plus`
  accanto crea una persona al volo.
- **URL SLA**: il collegamento al contratto di servizio.
- **Note**.

**Crea** salva, **Annulla** chiude. Creare un servizio cambia i dati: riesce solo a un amministratore.

## Come si fa

- **Registrare la posta aziendale**: `tasto:plus` Nuovo servizio, nome «Posta», criticità Alta, RTO 240, RPO 60,
  **Crea**; poi **Apri** e collega i server della posta.
- **Preparare l'elenco per l'audit**: **Scope NIS2** › Solo in scope NIS2.
- **Trovare i servizi senza asset collegati**: guarda la colonna **Asset linkati** a zero.
- **Vedere da cosa dipende il gestionale**: cerca «gestionale», **Apri**.
- **Mettere da parte un servizio che si sta spegnendo**: **Apri**, Stato **In dismissione**.

## Da dove arrivano i dati

I servizi li scrive una persona; gli asset vengono dall'[inventario](pagine/inventory.md) e le persone dagli
[Assegnatari](pagine/inventory-assignees.md).

## Se la pagina è vuota

«Nessun servizio» vuol dire che il catalogo non è ancora stato compilato: premi `tasto:plus` **Nuovo servizio**. Se ci
sono filtri scelti, rimettili su **Tutti**.
