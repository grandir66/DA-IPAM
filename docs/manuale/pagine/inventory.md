---
percorso: /inventory
titolo: Asset — l'inventario degli oggetti dell'istanza
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È l'**inventario degli asset**: server, PC, switch, firewall, NAS, stampanti, macchine virtuali, licenze. Ogni riga è
un oggetto con il suo numero di inventario (asset tag), il prodotto, la categoria e lo stato; nella vista NIS2 anche chi
ne è responsabile e quanto sono delicati i dati che tratta. Serve per il registro degli asset che la normativa NIS2
chiede e per l'inventario tecnico ed economico (garanzie, fornitori, prezzi). Si arriva da **Inventario › Asset** nel
menu.

Nello stesso gruppo del menu ci sono [Assegnatari](pagine/inventory-assignees.md),
[Abbinamenti](pagine/inventory-abbinamenti.md), [Ubicazioni](pagine/inventory-locations.md),
[Licenze](pagine/inventory-licenses.md) e, se il modulo NIS2 è acceso, [Servizi NIS2](pagine/services.md). La pagina
non ha schede in cima.

Tabelle, selezione e segni funzionano come in tutte le pagine: sono spiegati nelle
[parti comuni dell'interfaccia](../INTERFACCIA.md). Qui sotto c'è quello che Asset ha di suo.

## La barra in cima

![La barra di Asset](/manuale/inventory/barra.png)

1. **Vista NIS2** (in alto a destra): l'interruttore cambia colonne e campi. Acceso (di serie) mostra «Solo campi
   rilevanti NIS2»: proprietario, classificazione dei dati, scope NIS2, fine supporto. Spento mostra «Tutti i campi
   ITAM», l'inventario tecnico completo: numero di serie, a cosa è collegato, fine garanzia. La scelta vale anche nelle
   [schede dei singoli asset](pagine/inventory-id.md) e il browser la ricorda.
2. `icona:refresh` **Sincronizza** `icona:chevron-down`: apre il menu per creare o aggiornare gli asset (sotto).
3. `tasto:download` **Esporta CSV**: scarica l'elenco in formato NIS2 o ITAM, secondo la vista, con i filtri di
   categoria, stato e scope. Lo scarica solo un amministratore: in sola lettura il pulsante è spento.
4. `icona:search` **Cerca asset tag, S/N, hostname…**: filtra per numero di inventario, numero di serie o nome.
5. **Categoria**: Tutte, Desktop, Laptop, Server, Switch, Firewall, NAS, Stampante, VM, Licenza, Access Point, Router,
   Other.
6. **Scope NIS2** (solo nella vista NIS2): Tutti, In scope NIS2, Fuori scope.
7. **Stato**: Tutti, Attivo, In magazzino, In riparazione, Dismesso, Rubato.
8. `tasto:search` ricarica l'elenco (la lente gira mentre carica).

### Il menu Sincronizza

![Il menu Sincronizza](/manuale/inventory/sincronizza.png)

- **Da dispositivi di rete**: crea o aggiorna un asset per ogni apparato gestito (switch, router, firewall con la loro
  scheda in [Dispositivi](pagine/devices.md)).
- **Da host**: fa lo stesso partendo dagli host trovati nelle reti.

Mentre lavora la voce dice «Sincronizzazione…» e `icona:refresh` gira; alla fine un messaggio dice quanti asset sono
stati creati o aggiornati. Cambia l'inventario, quindi riesce solo a un amministratore.

## La tabella

![L'inizio della tabella](/manuale/inventory/tabella.png)

1. La casella nell'intestazione seleziona tutte le righe visibili (vedi [Più asset insieme](#selezione)).
2. **Scope**: `icona:shield` **NIS2** vuol dire che l'asset rientra nel perimetro della normativa; il trattino che non
   ci rientra.
3. `icona:pencil` in fondo alla riga apre la [scheda dell'asset](pagine/inventory-id.md), dove si leggono e si
   correggono tutti i campi.

La pagina non ha il menu `icona:more-vertical` né il tasto destro: le azioni su un asset stanno nella sua scheda.

### Le colonne della vista NIS2

| Colonna | Che cosa dice |
|---|---|
| **Asset Tag** | Il numero di inventario. |
| **Prodotto** | Il nome del prodotto, o in mancanza il nome dell'host o la marca. |
| **Categoria** | Il tipo di oggetto (Server, Switch…). |
| **Proprietario** | La persona responsabile, presa dagli [Assegnatari](pagine/inventory-assignees.md). |
| **Classificazione** | Quanto sono delicati i dati che tratta: Pubblico, Interno, Confidenziale, Riservato. |
| **Scope** | `icona:shield` NIS2 se è nel perimetro. |
| **Stato** | Attivo (pieno) o uno degli altri stati (grigio). |
| **EOL** | Quando finisce il supporto del produttore. |

### Le colonne della vista ITAM

![La tabella nella vista ITAM](/manuale/inventory/vista-itam.png)

| Colonna | Che cosa dice |
|---|---|
| **Asset Tag** | Il numero di inventario. |
| **S/N** | Il numero di serie. |
| **Prodotto** | Il nome del prodotto o la marca. |
| **Categoria** | Il tipo di oggetto. |
| **Collegato a** | L'apparato o l'host da cui l'asset prende i dati. Un clic, o `icona:external-link`, apre la sua scheda. |
| **Stato** | Attivo o uno degli altri stati. |
| **Fine garanzia** | Quando scade la garanzia. |

L'elenco mostra le prime 200 righe. Se ce ne sono di più, sopra la tabella compare «Sono mostrati i primi 200 asset»:
restringi con la ricerca o i filtri.

## La fascia «Compliance NIS2»

Nella vista NIS2, se ci sono asset in scope, sopra l'elenco compare una fascia con il punteggio medio di conformità
(su 100), quanti asset in scope hanno dei **gap** (campi obbligatori mancanti) e quanti di questi sono critici, alti o
medi. Due pulsanti:

- **Solo con gap** mostra solo gli asset a cui manca qualcosa; **Mostra tutti** torna all'elenco completo.
- **Export audit** scarica il file per l'audit NIS2 con tutti gli asset in scope. Solo un amministratore.

La fascia è **gialla** se ci sono gap, **verde** se tutti gli asset in scope sono completi.

## Più asset insieme {#selezione}

![La barra della selezione](/manuale/inventory/selezione.png)

Spunta le caselle a sinistra delle righe: sopra la tabella compare la barra con il numero di asset scelti.

- `tasto:pencil` **Modifica multipla**: apre la finestra qui sotto.
- `tasto:refresh` **Sync da discovery**: rilegge dagli host e dagli apparati collegati i dati che mancano negli asset
  scelti; un messaggio dice quanti sono stati aggiornati e quanti saltati (per esempio perché non sono collegati a
  niente).
- `icona:x` **Deseleziona**: toglie la selezione.

Le due azioni cambiano l'inventario: le esegue solo un amministratore.

### La finestra Modifica multipla

![La finestra Modifica multipla](/manuale/inventory/modifica-multipla.png)

Ogni campo ha una casella a sinistra: si cambia **solo il campo spuntato**, gli altri restano come sono su ogni asset.
I campi: **Categoria**, **Stato**, **Marca / Produttore**, **Classificazione dati**, **Sede**, **Reparto**, **Posizione
fisica**, **Antivirus** e **In scope NIS2** (Sì/No). Nella vista ITAM ci sono in più **Fornitore** e **In scope GDPR**.
**Applica a N asset** salva, **Annulla** chiude senza cambiare niente.

## Come si fa

- **Riempire l'inventario la prima volta**: `icona:refresh` Sincronizza › **Da dispositivi di rete**, poi di nuovo
  Sincronizza › **Da host**.
- **Trovare un asset dal numero di serie**: scrivi il numero, o una sua parte, in **Cerca**.
- **Completare i campi NIS2 di un server**: `icona:pencil` sulla sua riga, poi la scheda NIS2 nella
  [scheda dell'asset](pagine/inventory-id.md).
- **Vedere a quali asset manca qualcosa per la NIS2**: vista NIS2 accesa, **Solo con gap** nella fascia gialla.
- **Spostare venti PC nella stessa sede**: Categoria **Desktop**, spunta le righe, `tasto:pencil` Modifica multipla,
  spunta **Sede**, scrivi la sede, **Applica**.
- **Portare in Excel le garanzie in scadenza**: spegni la Vista NIS2 (vista ITAM), poi `tasto:download`.

## Cosa vogliono dire i segni

- **Attivo** (pieno): l'asset è in uso. In magazzino, In riparazione, Dismesso e Rubato hanno il segno grigio.
- `icona:shield` **NIS2**: l'asset è nel perimetro NIS2.
- Fascia **gialla** di compliance: ci sono asset in scope con dei gap. **Verde**: tutti completi.

## Da dove arrivano i dati

Gli asset nascono dalla sincronizzazione con gli host e gli apparati che DA-IPAM conosce, oppure da una scheda host o
apparato. I campi tecnici (sistema operativo, modello, numero di serie, firmware) si aggiornano dai dati letti; quelli
di responsabilità e di compliance li compila una persona. Il proprietario viene dagli
[Assegnatari](pagine/inventory-assignees.md).

## Se la pagina è vuota

«Nessun asset in inventario» vuol dire che non è ancora stata fatta una sincronizzazione: usa **Sincronizza**. Se ci
sono filtri scelti, rimettili su **Tutti**. «Nessun asset con gap NIS2 fra quelli caricati» compare con **Solo con
gap** acceso: premi **Mostra tutti**.
