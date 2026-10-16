# ADR 0018 — Letture in più spente e modello per cavo in ombra (topologia, tappa T2)

**Stato:** Accepted — rilasciata con tutto spento il 2026-10-15 (v0.3.297); lettura dell'host (T2.5) il 2026-10-15 notte (v0.3.299); letture accese il 15-16/10 (sotto, «Aggiornamento del 16/10»)
**Data:** 2026-10-15
**Autore:** Riccardo Grandi, con Claude

Numero: il piano di T2 prenotava lo 0017, ma il piano approvato della tappa 2 delle credenziali
(`docs/superpowers/plans/2026-10-15-tappa2-archivio-credenziali.md`, già su `dev`) lo usa per l'archivio
unico delle credenziali. Questo è lo 0018.

## Contesto

T1 e T1b (ADR 0015) hanno corretto la mappa con le righe che l'app leggeva già. La mappa «una linea per
cavo, albero dallo spanning tree» (T3, spec §13.11.4) ha bisogno di fatti che oggi nessuno legge: lo stato
di ogni porta nello spanning tree, i bridge e la loro radice, i fasci, gli indici delle porte nelle righe
LLDP, i MAC propri degli apparati. Leggerli vuol dire comandi nuovi sui MikroTik, campi nuovi dal
controller e letture SNMP nuove sugli switch degli altri: carico in più sugli apparati dei clienti e righe
nuove nei loro DB.

La decisione D4 della spec (§13.11.3) è il **freno con traccia contabile**: prima si legge e si confronta,
senza che la mappa cambi; si accende la mappa nuova per un cliente solo quando ogni differenza è spiegata.

## Decisione

**Le letture in più nascono spente e si accendono per cliente; i loro fatti vanno in tabelle e colonne
nuove che il modello di oggi non legge; il modello per cavo si calcola in ombra, a richiesta, solo per la
traccia «Cosa cambierebbe con la mappa nuova».**

1. **Quattro interruttori per cliente** (`topologia.lettura.mikrotik`, `.controller`, `.snmp`, `.host` in
   `tenant_settings`), tutti spenti al rilascio, accesi e spenti da «Dati della mappa → Letture in più per
   la mappa» (`PUT /api/topology/settings/letture`, admin). Ogni lettura ha la sua cadenza (sugli apparati
   al più una volta l'ora; il controller con la sua lettura notturna), il lucchetto per apparato, il tempo
   massimo (20 s per comando SSH, 10 s per lettura SNMP) e l'esito per apparato in parole.
2. **Tre esiti per lettura**: letto (anche vuoto), non riuscito col suo codice, **non so** (tempo scaduto,
   connessione caduta, uscita non capita). «Non so» non scrive mai una lista vuota: un vuoto falso
   scriverebbe fatti falsi nel DB del cliente.
3. **Schema additivo** (`migrateTopologyCavi`, all'apertura del tenant, in transazione, idempotente, senza
   CHECK e senza ricostruire tabelle): `topology_port_facts`, `topology_bridge_facts`,
   `topology_device_macs`; colonne nuove in `device_neighbors` (`discovered_by`, `local_port_index`,
   `remote_port_index`, `remote_caps`) e in `network_devices` (`uplink_local_port_idx`, `uplink_source`).
   Una riga nel journal per tenant: `topologia cavi (T2), aggiunto …`.
4. **Una fonte nuova non tocca le righe di oggi** (R7, I33): il modello di T1 e l'attribuzione leggono solo
   `source IN ('device','unifi')`; una riga `ssh`/`snmp`/`controller`/`host` non cambia una riga
   `device`/`unifi` sulla stessa chiave, e la potatura a 90 giorni di una fonte nuova pota solo le sue.
5. **Il modello per cavo in ombra** (`src/lib/topology/cavi/`): prove per porta → collegamenti (cavo,
   fascio, tunnel, ponte radio, senza fili, segmento) con stato e fiducia → albero dallo spanning tree.
   Si calcola solo quando un admin preme «Calcola» (`GET /api/topology/traccia`, admin), in memoria, e
   non si salva. A schermo la mappa resta quella di T1, anche a letture accese.

Misurato il 15/10 sulle copie dei DB (Task 14): migrazione su 4 tenant in 7-22 ms per apertura,
`integrity_check` invariato, seconda apertura senza modifiche; impronta del modello di T1 identica prima di
T2, a letture spente e a letture accese, sull'hub e sul cliente A; classificazioni degli host invariate
(0 differenze). Traccia: cliente A 0 padri diversi e 1 anomalia; hub 1 padre diverso, dovuto alla velocità
di una porta col nome doppio che il modello per cavo non trovava, corretto nella revisione finale (dopo:
0 padri diversi sulla stessa copia e alla stessa ora). Tempo del modello di T1 sul cliente A uguale prima e
dopo T2 (circa 18 ms sul Mac), modello per cavo 27-43 ms (solo a richiesta). A schermo (Task 15, 1280 e
1920 px) la mappa è identica a prima di T2.

## Alternative scartate

- **Accendere le letture per tutti al rilascio**: carico nuovo sugli apparati di tutti i clienti senza
  averlo misurato su un impianto nostro; la spec vuole prima l'hub, poi un cliente alla volta, ognuno con
  la conferma di Riccardo.
- **Scrivere lo stato dello spanning tree in `switch_ports`**: la tabella la leggono il modello di oggi,
  la scheda dell'apparato e la sincronizzazione del controller; un campo cambiato lì cambia la mappa
  prima che la traccia l'abbia spiegato (contro R7).
- **Ricostruire `device_neighbors`** con la fonte o l'indice della porta nella chiave: tabella con chiavi
  esterne (ADR 0008); le colonne si aggiungono in coda, la chiave resta quella di oggi.
- **Calcolare il modello per cavo a ogni apertura della mappa**: raddoppia il tempo del calcolo per una
  cosa che serve solo a decidere; a richiesta costa solo a chi la guarda.

## Conseguenze

- Il rilascio, a letture spente, cambia sugli apparati solo due percorsi a mano, in sola lettura: la
  lettura dello spanning tree dalla pagina dell'apparato e dalla scansione in blocco degli apparati di una
  rete (via SNMP una sessione per lettura, SN1, che prima perdeva otto letture su nove; via SSH sui MikroTik
  `/interface bridge print terse without-paging` e `/interface bridge monitor [find] once`, MK3 e MK5). Nel
  DB: le tabelle e le colonne nuove, vuote.
- La lettura degli hypervisor (`topologia.lettura.host`) e le istanze MSTP (MK7) non ci sono in questo
  rilascio: aspettano le uscite vere T2-b e T2-a. La pagina le dice «non disponibili».
- **Che cosa diventa difficile in futuro**:
  - **due modelli da tenere allineati** fino a T3: una regola nuova del modello di oggi va portata anche nel
    modello per cavo, o la traccia mostra differenze che non sono della rete (la velocità del nome doppio,
    regola I70 di T1, mancava nel modello per cavo ed è stata trovata solo dalla misura sulle copie);
  - **le impronte vanno ricalcolate** quando T1 cambia di proposito: la prova «a letture spente la mappa è
    identica» confronta impronte salvate, e un cambio voluto di T1 le rende vecchie;
  - **le letture SNMP sono dedotte dalle MIB** (IF-MIB, BRIDGE-MIB, RSTP-MIB, LLDP-MIB, CISCO-CDP-MIB, LAG-MIB,
    IEEE8021-MSTP-MIB), mai viste su un apparato: la prima lettura vera può smentire i valori (ruolo MSTP,
    numerazione della porta locale LLDP); l'indipendenza dal prodotto si scrive solo dopo;
  - **la potatura è per fonte**: chi aggiunge una fonte deve potare solo le sue righe, mai quelle
    `device`/`unifi`;
  - **le colonne SNMP sono ridotte**: delle tabelle grandi si leggono solo le colonne usate (16 letture
    invece di 10 tabelle intere, che in v1 non stanno nei 10 s); un campo nuovo vuol dire una lettura in più;
  - una colonna in più rispetto al DDL della spec, `lag_state` (membro attivo o di riserva di un bond), che
    scrive solo la lettura degli hypervisor: fino a T2-b resta vuota;
  - **lettura degli hypervisor e MSTP rimandate**: quando arrivano T2-b e T2-a, si scrivono i lettori
    sulle uscite vere e si rimisura la traccia.
- Tornare indietro: si spegne l'interruttore, senza codice; oppure `git revert`, e le tabelle nuove restano,
  non lette da nessuno (spec §13.11.3).

## Aggiornamento del 16/10 (accensioni e secondo rilascio)

- **Accensioni** (con l'ok di Riccardo, decisione del 15/10 notte: niente attese di settimane, si va avanti appena i
  numeri sono spiegati): MikroTik e controller sull'hub e sul cliente A; host solo sull'hub. **SNMP spento** su tutti e
  due: la lettura gira solo nel giro completo degli switch e solo su `device_type = switch` senza controller, e gli unici
  apparati così sono server segnati switch (sull'hub manca anche il job `arp_poll`). Prima lettura MikroTik: 6 comandi su
  6, nessun «non so» (B1 confermato: RouterOS dà il codice d'uscita), +1-2 s sulla scansione che la fa.
- **T2-b**: `lldpd` 1.0.18 sul nodo 1 dell'hub, LLDP del firmware X710 spento un porto alla volta (coppia LACP sempre
  intera; servizio `i40e-fw-lldp-off` per i riavvii). Il controller ora vede il nodo su 4 porte come un apparato solo
  (telaio = MAC della prima scheda, port id = MAC di ogni scheda, nessun nome di sistema). Sugli altri nodi il bond a 10G
  regge su un cavo solo: lì cambiare la bandiera fa ripartire la porta, quindi non si fa senza un intervento a parte.
- **T2.5 (Task 7) sulla forma vera**: gli switch UniFi non annunciano l'indirizzo di gestione, uno annuncia le capacità e
  uno no; lo stato del membro è `info_slave_data.state` (un bond active-backup, uno LACP); il MAC permanente
  `perm_hwaddr`. Lettura parziale come per i MikroTik (schede scritte anche se `lldpcli` manca o scade); un nodo con più
  apparati sullo stesso indirizzo dà `NODO_AMBIGUO`, gli apparati spenti non contano.
- **Non accolto dalla revisione**: che una fonte nuova non riempia le colonne nuove (`discovered_by`, indici, capacità)
  di una riga `device`/`unifi` sulla stessa chiave. È voluto: la chiave non contiene la fonte, quelle colonne le legge solo
  il modello per cavo (§13.5.7, «Chi legge che cosa»), ed è l'unico posto dove una lettura in più dice qualcosa di un
  vicino già noto. Tre prove lo tengono.
