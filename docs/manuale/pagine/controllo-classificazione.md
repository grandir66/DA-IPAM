---
percorso: /controllo-classificazione
titolo: Attribuzione — dove la classificazione degli apparati non torna
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

DA-IPAM decide da solo che cosa è ogni apparato (PC, telefono, server, switch…) guardando nome, produttore, porte
aperte e sistema operativo. A volte sbaglia, o le informazioni si contraddicono. Questa pagina raccoglie **le righe
dove qualcosa non torna** e, quando può, propone la classificazione giusta: si controlla la proposta e la si applica
con un clic. Una proposta applicata vale come una scelta fatta a mano: le scansioni successive non la cambiano più.

Si arriva da **Network › Apparati**, scheda **Attribuzione** in cima (le altre schede sono spiegate in
[Apparati](pagine/discovery.md)). Dalla [pagina di una subnet](pagine/networks-id.md) si arriva con la sola rete già
scelta. Menu, schede e tabelle funzionano come in tutte le pagine: vedi le
[parti comuni dell'interfaccia](../INTERFACCIA.md).

Sotto il titolo: quante righe ci sono in archivio e quante hanno qualcosa da guardare.

## La barra in cima

![La barra di Attribuzione](/manuale/controllo-classificazione/barra.png)

1. **I tipi di rilievo**: **Tutti** e un pulsante per ogni tipo di problema, col numero di righe (contando solo
   quelle con proposta, se la casella 2 è spuntata). Un clic mostra solo quel tipo. Compaiono solo i tipi che hanno
   righe:
   - **Il nome dice una cosa, la classe un'altra**: per esempio un apparato si chiama «iPhone» ma è classificato come
     postazione;
   - **Scritto «VM», ma è un server**: la classe dice la forma (macchina virtuale) e non la funzione;
   - **Senza classe**: apparati a cui DA-IPAM non ha saputo dare una categoria;
   - **Sistema operativo non credibile**: il sistema letto non va d'accordo col tipo di apparato;
   - **Lo stesso apparato su tante righe**: lo stesso MAC o nome compare su più indirizzi.
2. **Solo le righe con una proposta**: spuntata (all'apertura lo è), mostra solo le righe per cui DA-IPAM sa già cosa
   proporre. Togli la spunta per vedere anche i rilievi senza proposta, da sistemare a mano.
3. **Ricalcola col motore di oggi**: rifà il riconoscimento su tutte le righe con le regole attuali e dice quante
   hanno cambiato classe. Le scelte fatte a mano non cambiano. Serve dopo un aggiornamento di DA-IPAM o dopo aver
   aggiunto regole di [classificazione](pagine/settings-classifications.md).
4. **Applica alle righe spuntate**: applica la proposta alle righe spuntate. Il pulsante dice quante sono («Applica a
   5 righe») e resta spento finché non ne spunti almeno una.

Ricalcola e Applica cambiano i dati: si vedono anche in sola lettura, ma li esegue solo un **amministratore**.

Se arrivi dalla pagina di una subnet compaiono in più:

- **Solo questa rete ✕**: stai guardando una rete sola; un clic mostra tutte le reti;
- **Fonti in disaccordo**: apre il confronto delle righe di quella rete dove le fonti danno categoria, sistema o
  produttore diversi, per scegliere quale tenere.

## La tabella dei rilievi

![La tabella dei rilievi](/manuale/controllo-classificazione/tabella.png)

Nella schermata i nomi degli apparati e la colonna «Perché» sono sfocati perché possono contenere nomi di persone.

1. La casella nell'intestazione **spunta tutte le proposte** visibili, tranne le righe **A MANO**; quella su ogni
   riga spunta la riga sola (c'è solo dove c'è una proposta).
2. **Adesso**: la classificazione di oggi. **A MANO** vuol dire che l'ha scelta una persona.
3. **Proposta**: la classificazione che DA-IPAM suggerisce. «?» se non sa cosa proporre.
4. **Sicurezza**: quanto DA-IPAM è sicuro della proposta.
5. **Perché**: la ragione del rilievo, scritta per intero (per esempio «si chiama iPhone, ma è scritto
   workstation»).

| Colonna | Che cosa dice |
|---|---|
| **Indirizzo** | L'indirizzo dell'apparato; un clic apre la sua [scheda](pagine/objects-id.md). |
| **Nome** | Il nome come lo conosce DA-IPAM. |
| **Produttore** | Chi fa l'apparato, ricavato dal MAC o letto. |
| **Adesso** | La classificazione attuale, con **A MANO** se scelta da una persona. |
| **Proposta** | La classificazione suggerita. |
| **Sicurezza** | ●●● alta, ●●○ media, ●○○ bassa. |
| **Perché** | La ragione del rilievo. |

Le righe sono in ordine di tipo di rilievo, poi dalla sicurezza più alta alla più bassa.

## Come si fa

- **Sistemare in un colpo le proposte sicure**: lascia spuntato **Solo le righe con una proposta**, guarda le righe
  ●●● **alta**, spunta quelle giuste, **Applica a N righe**.
- **Classificare gli apparati rimasti senza categoria**: pulsante **Senza classe**; per le righe con proposta spunta e
  applica, per quelle con «?» apri la scheda dall'indirizzo e scegli a mano.
- **Ripassare tutto dopo un aggiornamento del programma**: **Ricalcola col motore di oggi**, poi guarda le righe
  nuove.
- **Una proposta su una riga A MANO**: non entra nella spunta di tutte; se la proposta è davvero migliore spunta quella
  riga da sola.
- **Controllare una sola rete**: dalla [pagina della subnet](pagine/networks-id.md) apri Attribuzione; con **Fonti in
  disaccordo** scegli quale fonte tenere quando DHCP, scansione e Active Directory dicono cose diverse.

## Cosa vogliono dire i segni

- ●●● **alta**, ●●○ **media**, ●○○ **bassa**: quanto è sicura la proposta, si legge dal numero di pallini pieni. Le
  proposte a sicurezza bassa vanno lette una per una prima di applicarle.
- **A MANO**: classificazione scelta da una persona, le scansioni non la toccano.

## Da dove arrivano i dati

Dal riconoscimento automatico che gira a ogni scansione: nome dell'host, produttore ricavato dal MAC, porte aperte,
SNMP, sistema operativo letto con WinRM o SSH, Active Directory.

## Se la pagina è vuota

«Niente da guardare qui» vuol dire che il controllo non ha trovato rilievi, oppure che con **Solo le righe con una
proposta** spuntata non ce ne sono con proposta: togli la spunta per vedere gli altri.
