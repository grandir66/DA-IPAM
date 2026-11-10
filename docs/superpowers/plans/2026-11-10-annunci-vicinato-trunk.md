# Annunci di vicinato sul sensore trunk: MNDP, Ubiquiti, LLDP-MED e varianti

> Piano del 10/11/2026. Richiesta di Riccardo: «non avrebbe senso montare LLDP/CDP, i protocolli
> che identificano gli oggetti di rete per trovare le porte e chi si presenta utilizzando queste
> tecnologie? Quindi LLDP/CDP/MNDP e varianti». **Stato: tappa 1 fatta e rilasciata il 10/11 (sonda 0.8.291, attiva sull'hub); tappe 2 e 3 da fare.** Livello proposto:
> **leggero** (due tappe, due repo, nessuna zona rossa fino al rilascio della sonda ai clienti).

## Cosa c'è oggi (misurato sull'hub il 10/11)

| Da dove | Cosa arriva | Dove sta |
| --- | --- | --- |
| Ascolto sul trunk | solo CDP: 42 annunci; 0 LLDP, 0 MNDP | `trunk_vicini` |
| Lettura dagli apparati | LLDP: 130 vicini da 21 apparati | `device_neighbors` |
| Lettura dagli apparati | MNDP: 37 vicini da **un solo** MikroTik | `device_neighbors` |
| LibreNMS | 107 vicini | `librenms_vicino` |

- Il sensore è Python, nella sonda: DA-Vul-can `infra/scanner-edge/app/scanner_edge/sensore/`.
  `cattura.py` fa salire dal kernel broadcast, multicast e ARP; `pacchetti.py` interpreta ARP, DHCP,
  mDNS, LLMNR, NetBIOS, SSDP, ICMPv6, **LLDP, CDP**, STP; i vicini finiscono nella tabella `vicino`
  ed escono da `GET /vicini`.
- DA-IPAM li legge in `src/lib/trunk/sensore-trunk.ts` (→ `trunk_vicini`), li porta sugli host in
  `src/lib/trunk/apparati-dal-trunk.ts` (modello, firmware, evidenze `cdp`/`lldp`) e li usa in
  Mappa porte e Topologia.
- **MNDP è in broadcast (UDP 5678)**: il filtro lo fa già salire, manca solo chi lo interpreta. Lo stesso
  vale per la scoperta Ubiquiti (UDP 10001).
- **LLDP non attraversa gli switch** (indirizzo riservato 01:80:C2:00:00:0E): dal trunk si sente solo
  l'apparato a cui il sensore è attaccato, e un bridge Linux (Proxmox) lo scarta. Zero LLDP sul trunk
  dell'hub è quindi atteso: per LLDP la strada resta la lettura dagli apparati.

## Tappa 1 — la sonda (DA-Vul-can)

- [x] **1.1 Misura prima di scrivere.** Fatta il 10/11 sul trunk dell'hub (VM 533, scheda `enp6s19`
  nello spazio di rete `trunk`, `tcpdump` per 200 secondi):

  | Protocollo | Telai | Apparati (MAC sorgenti) | Note |
  | --- | --- | --- | --- |
  | MNDP (UDP 5678) | 239 | 14 | in 10 VLAN (2, 4, 5, 6, 7, 15, 20, 40, 133, 666) e senza tag |
  | Ubiquiti (UDP 10001) | 516 | 6 | annunci versione 2 |
  | CDP | 3.050 | 55 | lo mandano anche i MikroTik |
  | LLDP | 0 | 0 | atteso: non attraversa gli switch |
  | EDP, FDP | 0 | 0 | non si implementano |

  Non misurata la sonda 79993.
- [x] **1.2 MNDP in `pacchetti.py`.** `_mndp`: nome, modello dalla scheda («MikroTik» non è un modello),
  versione senza la data di compilazione, interfaccia che parla, IPv4, MAC; bit `mndp` nella maschera;
  il nome finisce anche sull'osservazione dell'host. Prove sulla struttura del telaio vero (nomi e
  indirizzi cambiati). DA-Vul-can, ramo `macbook/sensore-mndp`.
- [x] **1.3 Scoperta Ubiquiti.** `_ubnt`, versioni 1 e 2: nome, modello, versione (campo 0x16 quando c'è,
  altrimenti la stringa del firmware), IPv4, MAC. Prova sulla struttura del telaio vero.
- [-] **1.4 LLDP-MED e campi in più.** Rinviato: sul trunk dell'hub non arriva LLDP, quindi non c'è un
  telaio vero su cui provarlo. Si riprende dove il sensore è attaccato a uno switch che lo manda.
- [-] **1.5 EDP / FDP.** Annullato: la misura non ne ha trovati.
- [x] **1.6 Rilascio della sonda** (sì di Riccardo, 10/11). DA-Vul-can 0.8.291 pubblicato con
  `scripts/deploy.sh --applica`. Le sonde restano dove sono: il loro timer gira con `SOLO_SU_COMANDO=1`
  e aspetta la versione fissata da DA-Link. Aggiornata a mano solo la sonda dell'hub (VM 533) con
  `aggiorna-sonda.sh`. *Verifica (10/11):* il sensore dell'hub risponde 0.8.291 e `GET /vicini` dà
  `cdp` 42, `mndp` 32, `ubnt` 2 dopo un minuto e mezzo (es. `CRS504-4XQ` su `ether1`, `CCR2004-1G-12S+2XS`
  su `VL_4_SERVER`, RouterOS 7.25.1). Resta rossa su `main` la prova `test_il_sensore_non_ascolta_in_rete`,
  per `sensore/raggiungibilita.py`, non per questo lavoro.

## Tappa 2 — DA-IPAM

- [x] **2.1 Accogliere i protocolli nuovi.** Non serviva codice: `salvaVicini` accetta qualunque
  protocollo. Sull'hub, due minuti dopo la sonda nuova, `trunk_vicini` aveva `mndp` 32 righe e `ubnt` 2.
  Aggiunti a `PROTOCOLLI_LOCALI`. Trovato e corretto un effetto non voluto: la regola «Switch che si
  annuncia» faceva un rilievo per ogni riga, anche MNDP: ora vale solo per CDP e LLDP (Riccardo, 10/11:
  «serve solo per ottenere dati»).
- [x] **2.2 Dagli annunci agli host.** Fonti `mndp` e `ubnt` nel motore di attribuzione (peso 0,9):
  categoria dal modello annunciato (`CCR…` router, `CRS…` switch, `cAP…` access point; `USW/USF/USC`
  switch, `U6/UAP` access point, `UDM/USG` router) e produttore dal protocollo. Un apparato si annuncia
  da ogni interfaccia col suo MAC: le righe senza host prendono quello delle altre righe dello stesso
  sistema, se è uno solo. Modello e firmware li riempiva già `portaApparatiDalTrunk`.
- [-] **2.3 MNDP letto da tutti i MikroTik.** Annullato: non era un difetto. Sull'hub c'è un solo
  MikroTik registrato come apparato (`MK-RTR-CORE`); gli altri si conoscono solo perché si annunciano
  sul trunk. È il motivo per cui l'ascolto serve.
- [-] **2.4 Mappa porte e Topologia.** Niente da cambiare per ora: l'identità arriva sugli host
  (modello, firmware, categoria), che Mappa porte e Topologia leggono già. I collegamenti restano
  quelli letti dagli apparati.
- [x] **Verifica sull'hub (10/11, 0.9.1112):** prove `mndp` attive nel riconoscimento: produttore
  `mikrotik` su 14 host, categoria `network.router` su 8 e `network.switch` su 6. Il modello annunciato
  vale prima della capacità generica del CDP (un CRS in CDP si dichiara router).
- [x] **Modello annunciato al posto di quello generico** (Riccardo, 10/11: «Sì, fallo»). Verifica
  sull'hub (0.9.1117): «13 campi riempiti su 21 host»; 15 host hanno ora il modello vero
  (`CRS504-4XQ`, `CRS304-4XG`, `CRS309-1G-8S+`, `CCR2004-1G-12S+2XS`, `CCR2004-16G-2S+`, `RB5009UPr+S+`,
  `CHR`) al posto di «MikroTik» / «RouterOS (…)». Un modello vero già scritto non si tocca.
- [x] **Il modello decide la categoria** (Riccardo, 10/11: «decide il modello»). `mndp` e `ubnt` sono
  fonti dichiarative sulla categoria (`AUTHORITATIVE_SOURCES`), solo per le sigle riconosciute, emesse
  a 0,95; il generico «apparato di rete» resta a 0,85. Verifica sull'hub (0.9.1121): dei 15 host che si
  annunciano, 6 sono `network.switch` (`CRS304-4XG`, `CRS504-4XQ`, `CRS309-1G-8S+`) e 9 `network.router`
  (`CCR2004…`, `RB5009UPr+S+`, `CHR`). Prima erano tutti router.
- [ ] **2.5 Dove si vede** (tavola mostrata a Riccardo il 10/11, in attesa del sì): una riga per apparato, non per annuncio; filtri per protocollo e per «non in DA-IPAM» / «non registrato come apparato»; aperta, le interfacce con VLAN e indirizzo. Testo di prima: In «Reti dal trunk» un elenco «Annunci» con protocollo, sistema, porta,
  indirizzo, VLAN, ultima vista. Da proporre oggetto per oggetto prima di scriverlo.

## Tappa 3 — cos'altro dice il trunk (Riccardo, 10/11: «arrivano tante informazioni passive per tanti protocolli… non so cosa si può estrarre in più»)

Misura del 10/11. Storico dei sensori (il sensore tiene solo ciò che ha capito, non i pacchetti): hub
357 apparati, 145 senza nome; DTS 656, 215 senza nome. Cattura di 185 secondi sul trunk dell'hub, tutto
il broadcast e multicast (9.968 telai):

| Cosa arriva | Apparati (hub) | Oggi | Cosa se ne ricava |
| --- | --- | --- | --- |
| SSDP (UDP 1900) | 114 nello storico | solo «visto» | tipo di apparato e prodotto (`SERVER`, `NT`, `USN`) |
| mDNS (UDP 5353) | 132 nello storico | solo il nome | servizi offerti e modello dai campi TXT (stampanti, Apple, Chromecast) |
| DHCP (UDP 67/68) | 185 nello storico | nome e impronta | classe del produttore (opz. 60), nome completo (81), identificativo (61) |
| NetBIOS datagrammi (UDP 138) | 13 in 3 minuti | scartato | nome Windows, dominio o gruppo di lavoro, versione del sistema, ruolo (DC, SQL, stampa) |
| DHCPv6 (UDP 547) | 11 in 3 minuti | scartato | identificativo stabile dell'host (DUID), nome, produttore |
| WS-Discovery (UDP 3702) | 3 in 3 minuti | scartato | stampanti, telecamere ONVIF e Windows: tipo e modello |
| Spanning tree | 1 sorgente | solo «visto» | chi è la radice, costo e porta: verso dove sta il centro della rete; cambi di topologia |
| ICMPv6, annunci dei router | 3 in 3 minuti | solo «visto» | router IPv6 e prefissi annunciati (anche quelli che non dovrebbero esserci) |
| IGMP | 130 telai | scartato | chi ascolta quali gruppi multicast (audio/video, TV) |
| CDP, campi in più | 55 | nome, porta, modello | VLAN voce, dominio VTP, alimentazione PoE |
| Protezione dai cicli MikroTik (0x9003) | 1 | scartato | quali porte la mandano |
| UDP 2647, 2021, 1990, 48000 | 4, 1, 1, 2 | scartato | da identificare: annunci di prodotto |

Non visti sull'hub ma probabili dai clienti con impianti (72729): Profinet DCP, EtherNet/IP, BACnet,
che dicono nome, modello e produttore di PLC e pannelli senza interrogarli. Serve una cattura là.

- [~] **3.1** SSDP, mDNS (servizi e TXT) e DHCP (opzioni 60 e 81). **Scritto nel sensore**, non
  rilasciato: DA-Vul-can, ramo `macbook/sensore-passivo`. Tabella nuova `dichiarazione` (mac, chiave,
  valore, VLAN, prima e ultima vista; al più 16 valori per apparato e chiave), `GET /dichiarazioni`.
  Chiavi: `ssdp_server`, `ssdp_tipo`, `ssdp_agente`, `mdns_servizio`, `mdns_modello`, `dhcp_classe`,
  `dhcp_fqdn`. *Verifica (10/11):* la cattura vera del trunk dell'hub (9.923 telai, 185 secondi)
  passata agli interpreti: nessun errore; ne escono `HP-iLO-5/3.22` e `HP-iLO-4/2.81` (i BMC di due
  server), una stampante 3D, un Chromecast Ultra, Spotify Connect, due client `ARM__boot` e un
  `udhcp 1.34.1`. In tre minuti parlano pochi apparati: i numeri veri si vedono lasciandolo girare.
  Prove del sensore: 62 verdi, resta rossa quella di `raggiungibilita.py` che non è di questo lavoro.
- [ ] **3.2** NetBIOS datagrammi, DHCPv6, WS-Discovery.
- [ ] **3.3** Spanning tree (radice, costo, cambi) e annunci dei router IPv6.
- [ ] **3.4** Cattura di tre minuti a DTS e, se c'è l'accesso, a 72729 e 70151: cosa gira dai clienti.
- [ ] **3.5** DA-IPAM: questi dati entrano come prove nel riconoscimento degli apparati (oggi un terzo
  resta senza nome) e in «Reti dal trunk».

Accessi: DTS raggiunta (`ssh dts`); 72729 rifiuta la chiave; il nome della 70151 non si risolve dal MacBook.

## Domande per Riccardo (prima di partire)

1. Un MikroTik che si annuncia in MNDP su una VLAN degli utenti è un **rilievo** (come «Switch che si
   annuncia (CDP/LLDP)», con rimedio «spegni MNDP sulle porte utenti») o solo un dato d'inventario?
2. Il rilascio della sonda ai clienti (1.6): subito a fine tappa 1, o prima solo sull'hub e sul 79993?

## Rischi

- Il sensore gira anche dai clienti: un interprete che sbaglia su un telaio storto non deve fermare la
  cattura (ogni protocollo dentro il suo `try`, come gli altri).
- MNDP rivela nomi e versioni: restano nel DB del tenant, non escono verso DA-Link (regola «Cosa esce»).

## Stima

Tappa 1: una sessione. Tappa 2: una sessione, più la tavola della 2.5. Totale realistico: due
sessioni di lavoro, più il tuo tempo per le due domande e la conferma del rilascio.
