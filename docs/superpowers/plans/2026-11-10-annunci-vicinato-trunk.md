# Annunci di vicinato sul sensore trunk: MNDP, Ubiquiti, LLDP-MED e varianti

> Piano del 10/11/2026. Richiesta di Riccardo: «non avrebbe senso montare LLDP/CDP, i protocolli
> che identificano gli oggetti di rete per trovare le porte e chi si presenta utilizzando queste
> tecnologie? Quindi LLDP/CDP/MNDP e varianti». **Stato: tappa 1 in corso (sì di Riccardo il 10/11); il rilascio della sonda aspetta la sua conferma.** Livello proposto:
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
- [!] **1.6 Rilascio della sonda** (fermo: aspetta la conferma di Riccardo). Prima del rilascio: il ramo
  va unito a `main`; la prova `test_il_sensore_non_ascolta_in_rete` è già rossa su `main` per
  `sensore/raggiungibilita.py` (usa `AF_INET`), non per questo lavoro. Prove della sonda, `version:release`, `bash scripts/deploy.sh`
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
