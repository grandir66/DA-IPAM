---
percorso: /inventory
titolo: Asset — l'inventario degli oggetti dell'istanza
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È l'**inventario degli asset**: server, PC, switch, firewall, NAS, stampanti, macchine virtuali, licenze. Ogni riga è un
oggetto con il suo numero di inventario (asset tag), il prodotto, la categoria, lo stato e, nella vista NIS2, chi ne è
responsabile e quanto sono delicati i dati che tratta. Serve per tenere il registro degli asset che la normativa NIS2
chiede, e per l'inventario tecnico ed economico (garanzie, fornitori, prezzi). Si arriva da **Inventario › Asset** nel
menu.

Nello stesso gruppo del menu ci sono [Assegnatari](pagine/inventory-assignees.md),
[Abbinamenti](pagine/inventory-abbinamenti.md), [Ubicazioni](pagine/inventory-locations.md),
[Licenze](pagine/inventory-licenses.md) e, se il modulo NIS2 è acceso, [Servizi NIS2](pagine/services.md).

![La pagina Asset](/manuale/inventory/pagina.png)

## Le voci della pagina

1. **Vista NIS2** (in alto a destra): l'interruttore cambia le colonne e i campi. Acceso (di serie) mostra «Solo
   campi rilevanti NIS2»: proprietario, classificazione dei dati, scope NIS2, fine supporto. Spento mostra «Tutti i
   campi ITAM», l'inventario tecnico completo: numero di serie, a cosa è collegato, fine garanzia. La scelta resta
   anche nelle schede dei singoli asset.
2. **Sincronizza**: apre un menu con due voci. **Da dispositivi di rete** crea o aggiorna gli asset partendo dagli
   apparati gestiti (switch, router, firewall con la loro scheda); **Da host** fa lo stesso partendo dagli host trovati
   nelle reti. Accanto, la freccia in giù **esporta in CSV** l'elenco (formato NIS2 o ITAM, secondo la vista): la
   scarica solo un amministratore.
3. **Cerca asset tag, S/N, hostname…**: filtra per numero di inventario, numero di serie o nome. Dopo la casella ci
   sono i filtri **Categoria** (Desktop, Laptop, Server, Switch, Firewall, NAS, Stampante, VM, Licenza, Access Point,
   Router, Other), **Scope NIS2** (solo nella vista NIS2: In scope NIS2, Fuori scope) e **Stato** (Attivo, In
   magazzino, In riparazione, Dismesso, Rubato). La lente in fondo ricarica l'elenco.
4. **Scope**: il segno **NIS2** dice che l'asset rientra nel perimetro della normativa; il trattino che non ci rientra.
5. **La matita** in fondo alla riga apre la [scheda dell'asset](pagine/inventory-id.md), dove si correggono tutti i
   campi.

Le colonne della **vista NIS2**: Asset Tag, Prodotto, Categoria, Proprietario (la persona responsabile, presa dagli
[Assegnatari](pagine/inventory-assignees.md)), Classificazione (Pubblico, Interno, Confidenziale, Riservato), Scope,
Stato, EOL (fine del supporto del produttore).

Le colonne della **vista ITAM**: Asset Tag, S/N (numero di serie), Prodotto, Categoria, **Collegato a** (l'apparato o
l'host da cui l'asset prende i dati: un clic apre la sua scheda), Stato, Fine garanzia.

## La fascia «Compliance NIS2»

Nella vista NIS2, se ci sono asset in scope, sopra l'elenco compare una fascia con il punteggio medio di conformità
(su 100), quanti asset in scope hanno dei **gap** (campi obbligatori mancanti) e quanti di questi sono critici, alti o
medi. Due pulsanti:

- **Solo con gap** mostra solo gli asset a cui manca qualcosa; **Mostra tutti** torna all'elenco completo.
- **Export audit** scarica il file per l'audit NIS2 con tutti gli asset in scope (solo amministratori).

## Agire su più asset insieme

Spunta la casella a sinistra delle righe (quella in testa le prende tutte). Sopra l'elenco compare una barra:

- **Modifica multipla**: apre una finestra con i campi Categoria, Stato, Marca / Produttore, Classificazione dati,
  Sede, Reparto, Posizione fisica, Fornitore, Antivirus, In scope GDPR, In scope NIS2. Si abilita solo il campo che
  si vuole cambiare: gli altri restano come sono su ogni asset.
- **Sync da discovery**: rilegge dagli host e dagli apparati collegati i dati che mancano negli asset selezionati.
- **Deseleziona**: toglie la selezione.

## Come si usa

1. Per trovare un asset scrivi una parte del nome, del numero di serie o dell'asset tag in **Cerca**.
2. Per riempire l'inventario la prima volta usa **Sincronizza › Da dispositivi di rete** e poi **Da host**.
3. Per completare i campi NIS2 di un asset clicca la matita e compila la **Scheda NIS2**.
4. Per sapere a quali asset manca qualcosa per la NIS2 usa **Solo con gap** nella fascia gialla.
5. Per cambiare lo stesso campo su molti asset (es. la sede) selezionali e usa **Modifica multipla**.

## Cosa vogliono dire i segni

- **Attivo** (pieno): l'asset è in uso. Gli altri stati (In magazzino, In riparazione, Dismesso, Rubato) hanno il
  segno grigio.
- **NIS2** con lo scudo: in perimetro NIS2.
- Fascia **gialla** di compliance: ci sono asset in scope con dei gap. **Verde**: tutti completi.

## Da dove arrivano i dati

Gli asset nascono dalla sincronizzazione con gli host e gli apparati che DA-IPAM conosce, oppure da una scheda host o
apparato. I campi tecnici (sistema operativo, modello, numero di serie, firmware) si aggiornano da soli dai dati letti;
quelli di responsabilità e di compliance li compila una persona. Il proprietario viene dagli
[Assegnatari](pagine/inventory-assignees.md).

## Se la pagina è vuota

«Nessun asset in inventario» vuol dire che non è ancora stata fatta una sincronizzazione: usa **Sincronizza**. Se ci
sono filtri scelti, rimettili su **Tutti**. Se l'elenco dice «Sono mostrati i primi … asset», restringi con la ricerca
o con i filtri per vedere gli altri.
