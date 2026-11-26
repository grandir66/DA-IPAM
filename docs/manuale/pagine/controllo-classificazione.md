---
percorso: /controllo-classificazione
titolo: Attribuzione — dove la classificazione degli apparati non torna
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

DA-IPAM decide da solo che cosa è ogni apparato (PC, telefono, server, switch…) guardando nome, produttore, porte
aperte e sistema operativo. A volte sbaglia, o le informazioni si contraddicono. Questa pagina raccoglie **le righe
dove qualcosa non torna** e, quando può, propone la classificazione giusta: si controlla la proposta e la si applica
con un clic. Una proposta applicata vale come una scelta fatta a mano: le scansioni successive non la cambiano più.

Si arriva da **Network › Apparati**, scheda **Attribuzione** in cima. Dalla pagina di una subnet si arriva con la sola
rete già scelta.

![La pagina Attribuzione](/manuale/controllo-classificazione/pagina.png)

Nella schermata i nomi degli apparati e la colonna «Perché» sono sfocati perché contengono nomi di persone.

## Le voci della pagina

1. **I tipi di rilievo**: **Tutti** e poi un pulsante per ogni tipo di problema, col numero di righe:
   - **Il nome dice una cosa, la classe un'altra**: per esempio un apparato si chiama «iPhone» ma è classificato come
     postazione.
   - **Senza classe**: apparati a cui DA-IPAM non ha saputo dare una categoria.
   - **Sistema operativo non credibile**: il sistema letto non va d'accordo col tipo di apparato.
   - **Lo stesso apparato su tante righe**: lo stesso MAC o nome compare su più indirizzi.
   Un clic mostra solo quel tipo.
2. **Solo le righe con una proposta**: spuntata, mostra solo le righe per cui DA-IPAM sa già cosa proporre. Togli la
   spunta per vedere anche i rilievi senza proposta, da sistemare a mano dalla scheda dell'apparato.
3. **Ricalcola col motore di oggi**: rifà il riconoscimento su tutte le righe con le regole attuali. Le scelte fatte a
   mano non cambiano. Serve dopo un aggiornamento di DA-IPAM o dopo aver aggiunto regole di classificazione.
4. **Applica alle righe spuntate**: applica la proposta alle righe con la casella spuntata a sinistra. Il pulsante
   dice quante sono («Applica a 5 righe») e resta spento finché non ne spunti almeno una.
5. **Proposta**: la classificazione che DA-IPAM suggerisce al posto di quella in **Adesso**.
6. **Sicurezza**: quanto DA-IPAM è sicuro della proposta: **alta** (tre pallini pieni), **media**, **bassa** (un
   pallino pieno e due vuoti). Le proposte a sicurezza bassa vanno lette una per una prima di applicarle.

Le altre colonne:

- **Indirizzo**, **Nome**, **Produttore**: l'apparato, come lo conosce DA-IPAM.
- **Adesso**: la classificazione di oggi. Il segno **A MANO** vuol dire che l'ha scelta una persona: quella riga non
  entra nella selezione di tutte le righe.
- **Perché**: la ragione del rilievo, scritta per intero (per esempio «si chiama iPhone ma è scritto workstation»).

Se si arriva dalla pagina di una subnet compaiono anche **Solo questa rete ✕** (toglie il filtro della rete e mostra
tutte le reti) e **Fonti in disaccordo**, che apre il confronto delle righe dove le fonti danno categoria, sistema o
produttore diversi, per scegliere quale tenere.

## Come si usa

1. Scegli un tipo di rilievo in alto, oppure lascia **Tutti**.
2. Leggi la colonna **Perché** e la **Proposta**. Se la proposta è giusta spunta la casella della riga.
3. Quando hai spuntato tutte le righe giuste premi **Applica a N righe**.
4. Le righe senza proposta, o con una proposta sbagliata, si correggono a mano dalla scheda dell'apparato
   ([scheda dell'oggetto](pagine/objects-id.md)).

Le azioni che cambiano i dati (applicare, ricalcolare) le esegue chi ha il ruolo di amministratore.

## Cosa vogliono dire i segni

- ●●● **alta**, ●●○ **media**, ●○○ **bassa**: quanto è sicura la proposta, si legge dal numero di pallini pieni.
- **A MANO**: classificazione scelta da una persona, le scansioni non la toccano.

## Da dove arrivano i dati

Dal riconoscimento automatico che gira a ogni scansione: nome dell'host, produttore ricavato dal MAC, porte aperte,
SNMP, sistema operativo letto con WinRM o SSH, Active Directory.

## Se la pagina è vuota

«Niente da guardare qui» vuol dire che il controllo non ha trovato rilievi, oppure che con **Solo le righe con una
proposta** spuntata non ce ne sono con proposta: togli la spunta per vedere gli altri.
