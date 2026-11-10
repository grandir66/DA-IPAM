# Annunci di vicinato sul sensore trunk: MNDP, Ubiquiti, LLDP-MED e varianti

> Piano del 10/11/2026. Richiesta di Riccardo: «non avrebbe senso montare LLDP/CDP, i protocolli
> che identificano gli oggetti di rete per trovare le porte e chi si presenta utilizzando queste
> tecnologie? Quindi LLDP/CDP/MNDP e varianti». **Stato: in attesa del sì.** Livello proposto:
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

- [ ] **1.1 Misura prima di scrivere.** Dieci minuti di cattura sul sensore dell'hub (VM 533) e di una
  sonda libera (79993), contando i telai per indirizzo di destinazione e porta UDP: MNDP 5678, Ubiquiti
  10001, EDP (00:E0:2B:00:00:00), FDP (01:E0:52:CC:CC:CC), LLDP-MED. Si salva un telaio vero per tipo.
  *Fatto quando:* tabella «protocollo → telai, host» nel piano; si implementano solo quelli visti.
- [ ] **1.2 MNDP in `pacchetti.py`.** `_mndp` sui datagrammi UDP 5678: MAC (1), identità (5), versione (7),
  piattaforma (8), scheda (12), interfaccia (16), IPv4 (17). Diventa un `Vicino(protocollo="mndp", …)`;
  nuovo bit nella maschera dei protocolli. *Verifica:* prova in `app/tests/test_sensore_trunk.py` col
  telaio vero della 1.1.
- [ ] **1.3 Scoperta Ubiquiti** (UDP 10001, risposte e annunci v1/v2): MAC, IP, nome, modello, firmware
  → `Vicino(protocollo="ubnt", …)`. Solo se la 1.1 ne trova.
- [ ] **1.4 LLDP-MED e campi in più.** Dai TLV dell'organizzazione 00-12-BB: modello, seriale, firmware,
  tipo di apparato (telefono, access point); da 802.1: VLAN della porta. Da CDP: VLAN voce, seriale
  dove c'è. Colonne nuove in `vicino` con `ALTER TABLE` idempotente (già l'uso in `rubrica.py`).
- [ ] **1.5 EDP / FDP**: solo se la 1.1 ne trova. FDP ha il formato di CDP: stesso interprete, altro
  indirizzo.
- [ ] **1.6 Rilascio della sonda.** Prove della sonda, `version:release`, `bash scripts/deploy.sh`
  (dry-run), poi `--applica`. **Qui si chiede conferma**: il pacchetto va alle sonde dei clienti.
  *Verifica:* `GET /vicini` del sensore dell'hub mostra righe `mndp`.

## Tappa 2 — DA-IPAM

- [ ] **2.1 Accogliere i protocolli nuovi.** `trunk_vicini` e `sostituisciVicini` accettano `mndp`,
  `ubnt`, `edp`, `fdp` e i campi nuovi; `PROTOCOLLI_LOCALI` in `trunk/appartenenza.ts`.
  *Verifica:* prova con la risposta vera di `/vicini`.
- [ ] **2.2 Dagli annunci agli host.** `apparati-dal-trunk.ts`: evidenze `mndp` e `ubnt` nel motore di
  attribuzione (peso come `cdp`), modello e firmware riempiti. *Verifica:* sull'hub, quanti host
  `unknown` cambiano classe (numero prima e dopo).
- [ ] **2.3 MNDP letto da tutti i MikroTik.** Oggi arriva da un apparato solo, mentre la credenziale
  «SSH - Mikrotik» è usata da 41. Prima la causa (lettura spenta, comando, parser), poi un fix.
  *Verifica:* `SELECT COUNT(DISTINCT device_id) FROM device_neighbors WHERE protocol='mndp'`.
- [ ] **2.4 Mappa porte e Topologia.** Gli annunci sentiti sul trunk entrano come **identità**
  dell'oggetto (nome, modello, interfaccia che parla); il collegamento porta-porta resta quello letto
  dagli apparati. *Verifica:* una schermata a 1920 della Mappa porte.
- [ ] **2.5 Dove si vede.** In «Reti dal trunk» un elenco «Annunci» con protocollo, sistema, porta,
  indirizzo, VLAN, ultima vista. Da proporre oggetto per oggetto prima di scriverlo.

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
