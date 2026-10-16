# ADR 0020 — La mappa per cavo dietro un interruttore per cliente (topologia, tappa T3)

**Stato:** Accepted — pronta il 2026-10-16 sul ramo `topologia/collegamenti-t3`; rilascio con la mappa nuova **spenta** (il numero di versione si scrive al rilascio)
**Data:** 2026-10-16
**Autore:** Riccardo Grandi, con Claude

Numero: il piano di T3 prenotava lo 0019, ma lo 0019 è già di un'altra tappa (`unifi-os-anche-con-utente-locale`).
Questo è lo 0020.

## Contesto

T1 (ADR 0015) ha corretto la mappa con le righe che l'app leggeva già; T2 (ADR 0018) ha aggiunto le letture
in più e ha calcolato **in ombra** il modello «una linea per cavo, albero dallo spanning tree», solo per la
traccia «Cosa cambierebbe con la mappa nuova». T3 porta quel modello **sulla pagina** (spec §13.11.4; decisioni
D1, D2, D5 della spec).

Il rischio è lo stesso di T2, più grande: la mappa è la pagina che i clienti guardano, e due modelli che
decidono lo stesso albero possono dare due mappe diverse. Per questo T3 non sostituisce niente: la mappa nuova
nasce spenta, per cliente, e si accende quando ogni differenza della traccia è spiegata (spec §13.15 punto 5;
decisione del 15/10 notte: niente attese di settimane, ma niente accensioni senza numeri).

## Decisione

**La mappa nuova sta dietro un interruttore per cliente che nasce spento (`topologia.mappa.cavi` in
`tenant_settings`, da «Dati della mappa → Mappa nuova»). Spento, la pagina è quella di T1, bit per bit. Acceso,
il modello per cavo ha la forma che la pagina legge e schermo e traccia scelgono con lo stesso calcolo.**

1. **Un interruttore per cliente, spento al rilascio**, `GET/PUT /api/topology/settings/mappa` (il PUT è da
   admin). Fallisce chiuso: valore assente, illeggibile o sconosciuto = spento. A interruttore spento la rotta
   del modello non legge nemmeno l'ingresso del modello per cavo, perciò una tabella rotta non può toccare la
   mappa di oggi.
2. **Il modello per cavo nella forma della pagina**: tipi nuovi senza logica in `model-types.ts` (genere,
   stato, fiducia), `model.cavi` solo a mappa accesa, `l.cavo` su ogni linea. Ogni modulo comune (`links`,
   `model`, `attach`, `node-index`, `vm-ports`, `vms`, `sites`) prende la strada nuova **solo** se vede `cavi`/
   `cavo`; i moduli di T1 non cambiano.
3. **Un Prim solo per schermo e traccia**: la pagina e la traccia scelgono il collegamento per ogni coppia con
   la stessa funzione. Se la mappa a schermo dice A e la traccia dice B, è un difetto, non una differenza.
4. **Il segmento come nodo calcolato** (`seg:`), con alias per i nomi lunghi (accorciati con `~` e un hash) e
   per le chiavi fuse da T1: l'id non si salva, si ricalcola.
5. **Le scritture nuove**: ruoli «Core» e «Accesso» (`topology_role`), tipo «tunnel» in `MEDIUM`/`MEDIA`, ★
   (collegamento principale) **per collegamento** e non più per coppia, «Togli dal segmento», «Ignora» di un
   fascio cavo per cavo. Candidati per porta in sola lettura (`GET /api/topology/candidati`).
6. **Nessuna migrazione**: nessuna tabella o colonna nuova. L'unica riga in più è `topologia.mappa.cavi`, che
   esiste solo dopo il primo «Accendi».
7. **Anche il lettore MSTP viaggia insieme (T2-a, MK7)**: sui bridge MikroTik in MSTP si leggono le istanze
   (`/interface bridge msti print` e il suo `monitor`): **2 comandi in più solo lì**, in sola lettura; su
   RSTP i comandi restano 6 (router) e 8 (switch). Con le istanze il tunnel fra due bridge della stessa
   regione può dire «bloccato nell'albero comune, attivo per le VLAN dell'istanza»; senza, dice solo
   «bloccato», mai «in parte».

### Misurato sulle copie dei DB (16/10, Task 0 e 13)

Copie prese dopo il giro delle letture notturne (hub e cliente A), con `misura-cavi`.

- **Spento = T1**: l'impronta del modello di T1 è identica a quella salvata prima di T3, sulle due copie
  (0 padri diversi, 0 conteggi diversi). Rifatta dopo i criteri A-D: ancora uguale.
- **Acceso, in memoria**:
  - hub: 1 radice, 0 anomalie, testa uguale a oggi, 6 fasci, 5 padri diversi da oggi, 15 ms;
  - cliente A: 1 radice, 1 anomalia (il core 2), 3 cavi bloccati, tunnel bloccato, segmento della WAN sotto
    una porta del router, 4 padri diversi da oggi, 37 ms (numeri dopo i criteri A-D).
- **Padri diversi da oggi, in parole** (dopo i criteri A-D). Hub: il firewall virtuale entra nel suo hypervisor
  (§13.7.8); uno switch di storage entra nell'albero sotto il router con un fascio 2×10G; il segmento della porta
  5 di uno switch PoE entra nell'albero (H5); due delle tre voci del NAS restano isolate (la terza sta sotto il
  router col suo fascio): l'identità del NAS in tre voci è un fatto a parte, fuori dal §13. Prima del criterio D
  un hypervisor passava sotto il router perché la porta dell'aggregazione su cui sta ha lo stesso nome di una
  porta spenta: risolto per indice. Cliente A: le due radio a 5 GHz entrano nell'albero; il router 2 passa
  «oltre» la radio vicina (salto non letto, §13.3.1 riga 12); il segmento della WAN entra sotto il router 1, con
  due membri più un apparato non gestito (il router di riserva non è letto).
- **Righe 1-11, 13, 14 della tabella 13.3.1** (cliente A) come attese; la 12 nel caso «senza salto» (il salto
  a 5 GHz non è letto); la 15 fuori criterio fino al criterio A. Le righe 12-17 non fanno da cancello (§13.3.1,
  C13): dipendono da letture che mancano.

### Quattro criteri trovati sui dati veri

Non sono correzioni della mappa vecchia: **sono parte del modello nuovo**, trovati dalla misura perché le
fixture inventate non avevano quella forma. Ognuno è una prova in più scritta su una rete inventata con la
stessa forma, vista fallire prima del codice.

- **A — una porta che sente due apparati non dà un cavo.** Fra due router, una porta dietro un ponte radio
  trasparente sente il router 1 da tre interfacce e anche il router di riserva. Prima: due linee, una «certa».
  Ora: una linea «probabile, attraverso apparati non letti». Solo fra due router: estesa agli switch romperebbe
  il caso «oltre» e il fascio dell'hub.
- **B — il bond è il suo fascio.** Prima: il fascio giusto più due linee «instradato» sul bond, dedotte dalla
  tabella MAC. Ora: una linea sola; lo stato viene dai fatti del bond (nel bridge = inoltra), mai «instradato».
- **C — un router o un firewall dentro una VM sta dentro il suo hypervisor**, anche con collegamenti propri
  (§13.7.8). Prima: «fuori dall'albero». Una VM confermata come testa resta fuori dalla regola (scelta di
  Riccardo, §13.16 punto 3).
- **D — due porte con lo stesso nome si distinguono per indice.** Col solo nome la porta è «da completare»;
  l'ambiguità conta solo dentro la stessa lettura.

### «Dalle VM» nei dettagli: deciso dalla misura

`DALLE_VM_SOLO_DETTAGLI = true` (spec §13.15 punto 4). Sul cliente A i collegamenti «dalle VM» non principali
sono 2, tutti verso lo stesso hypervisor (il caso M26), visti da una VM ciascuno, nessuno nella mappa attesa; sull'hub
0. Non si disegnano: stanno nei dettagli dell'hypervisor («visto dalle VM anche su ‹porta›»). Se uno fosse un
cavo vero, si legge lì e si rivede la costante.

## Alternative scartate

- **Accendere la mappa nuova per tutti al rilascio**: due modelli che decidono lo stesso albero, senza averne
  spiegato le differenze su un impianto nostro; la spec vuole prima l'hub, poi un cliente alla volta.
- **Un secondo componente di pagina per la mappa nuova**: due pagine da tenere allineate per ogni ritocco di
  interfaccia, e il cliente vedrebbe due «Topologia». La pagina è una, con due strade dentro i moduli comuni.
- **Salvare i collegamenti calcolati** in una tabella: una cache che invecchia e va ricostruita a ogni lettura
  nuova; il modello si calcola in 15-37 ms, non serve.
- **Convertire le correzioni a mano di prima** in correzioni per collegamento: indovinare il cavo da una coppia
  è una scrittura nei dati del cliente senza che lui lo sappia. Le ★ di prima restano «di prima» finché
  qualcuno sceglie il cavo.

## Conseguenze

- A interruttore spento il rilascio non cambia niente per nessuno: misurato con le impronte, non letto dal codice.
- Tornare indietro: si spegne l'interruttore (la mappa di prima torna subito, nessun dato perso); oppure
  `git revert`. Nessuna migrazione da annullare.
- **Che cosa diventa difficile in futuro**:
  - **due modelli vivi** fino a quando si toglie il ramo vecchio (spec §13.13.3 punto 1, con l'ok di Riccardo,
    non a tempo): una regola nuova di T1 va anche nel modello per cavo e viceversa; `TIPI_SOSPETTI` è una **copia**
    di `SUSPICIOUS_TYPES` di `model.ts` (che è di T1 e non si tocca): due liste da tenere allineate finché il
    modello vecchio non si toglie;
  - **l'id della linea è il collegamento**: cambia se cambia il nome di una porta letta per nome (§13.13.3 punto 3);
    una ★ messa a mano senza porte non combacia mai con un cavo che le porte le ha (le porte nella ★ non sono
    mai NULL da T3: una correzione senza porte toglie la ★ senza porte);
  - **l'id del segmento e i suoi alias**: ogni id `seg:` prodotto deve passare `ID_SEGMENTO` (nomi codificati
    oltre 90 caratteri), e gli alias passano da `canonical`;
  - **MSTP per istanza a metà**: il lettore c'è, ma finché non si leggono le istanze di tutti i bridge un tunnel
    può dire solo «bloccato»; nelle uscite vere dei router 1 e 2 del cliente A il digest della regione è lo
    stesso, e con le copie anonime corrette (16/10) il tunnel risulta «bloccato nell'albero comune, attivo per
    l'istanza 1»; mancano le uscite del router 3 e del router di riserva;
  - **la radio nascosta nella mappa automatica**: la pagina contrae, la traccia fa due radici, e `cavi.anomalie`
    può non combaciare con l'albero a schermo;
  - `sources` delle linee nuove solo per compatibilità con i consumatori di T1;
  - **le misure vanno rifatte** quando arrivano gli altri router MSTP e la lettura dell'host sui nodi 3 e 4;
  - **lldpd sull'hub**: spegnere l'LLDP del firmware X710 fa cadere e risalire la porta una volta; dove il bond ha
    un solo cavo attivo, le VM perdono la rete per qualche secondo. Fatto sui nodi 1, 2 e 5; i nodi 3 e 4 aspettano
    una finestra tranquilla e l'ok di Riccardo.
