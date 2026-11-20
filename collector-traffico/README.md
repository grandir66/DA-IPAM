# Collector di traffico

Una VM leggera che ascolta il traffico in copia (mirror) e conta **chi parla con chi**.
IPAM la legge col cursore e calcola le anomalie. Spec:
`docs/superpowers/specs/2026-11-20-collector-traffico-design.md`.

**Non è** la sonda pesante (l'NDR con Suricata e Zeek): è un servizio a sé, senza codice in
comune con Edge né con l'NDR, e in un punto di ascolto va **o** il collector **o** la sonda
pesante. Non manda mai niente sulla rete ascoltata: la scheda in mirror non ha indirizzo,
ha ARP e IPv6 spenti.

## Com'è fatto

| Pezzo | Cosa fa |
|---|---|
| `pmacctd` (pacchetto Debian) | conta i pacchetti del mirror per sorgente, destinazione, protocollo e porte; ogni 300 secondi scrive un file in `/var/lib/collector-traffico/in/` |
| `collector/piega.py` | da righe per flusso a coppie client-server: la porta effimera si butta, le due direzioni si sommano, gli indirizzi fuori dalle reti interne diventano `esterno` (se ne tiene solo il numero), multicast e broadcast diventano `diffusione` |
| `collector/archivio.py` | SQLite con un numero progressivo per riga; tiene 7 giorni |
| `collector/api.py` | HTTPS sulla 8477, gettone in `Authorization: Bearer` |
| `collector/__main__.py` | ogni 30 secondi prende i file nuovi; legge da `/proc/net/dev` pacchetti visti e scartati |
| `collector/ascolto.py`, `collector/controlli.py` | nomi DNS e TLS, controlli sul contenuto (vedi sotto) |

Solo libreria standard di Python: niente da installare oltre a `pmacct`, `tcpdump`, `python3`, `openssl`.

## Installazione (Debian 12, da root)

```bash
bash /opt/collector-traffico/installa.sh <scheda in mirror> [nome]
```

Stampa l'impronta del certificato e dice dove sta il gettone (`/etc/collector-traffico/gettone`),
senza stamparlo. Configurazione in `/etc/collector-traffico/collector.env`: `MIRROR_IF`, `NOME`,
`RETI_INTERNE` (aggiunte alle private), `MIRROR_DOPPIO=1` se ogni pacchetto arriva due volte (vedi «I casi del piano»),
`FLUSSI=no|netflow|sflow`.

## API

Ogni richiesta vuole il gettone; senza: 401.

- `GET /v1/stato` → `{versione, nome, avviato, ultimo_seq, pacchetti_visti, pacchetti_persi, copertura}`,
  con `copertura = 1 - persi / (visti + persi)`.
- `GET /v1/coppie?dopo=<seq>&limite=<1..1000>` → `{righe, ultimo_seq, altri, buco}`. Ogni riga:
  `seq, inizio, durata_s, client, server, proto, porta, byte, pacchetti, flussi, esterni, fonte`.
  `buco: true` vuol dire che chi legge era rimasto indietro di più di 7 giorni e delle righe sono andate perse.

## Prove

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM/collector-traffico && python3 -m unittest discover -s tests -t .
```

Le prove sono `unittest` della libreria standard; girano anche con `python3 -m pytest collector-traffico/tests`
dove pytest è installato.

## Fermare e riavviare

`pmacctd` si ferma con **SIGINT**, non con SIGTERM (lo fa il servizio): con SIGTERM esce senza scrivere la
finestra in corso. Sul banco un riavvio ha perso così 4 minuti di conteggio. Con SIGINT scrive un file in
anticipo; il collector lo prende come una finestra in più, con l'ora d'inizio approssimata (i byte sono giusti).
Fermare `collector-traffico` ferma anche conteggio e ascolto (`PartOf`).

## Nomi e controlli sul contenuto (`collector-ascolto`)

Un secondo processo lancia `tcpdump` con un filtro nel kernel (solo le porte dei controlli, più il saluto
TLS su qualunque porta), legge i primi 256 byte dei pacchetti e li passa a `collector/controlli.py`.
Gira come utente `collector` con il solo permesso di catturare. In archivio va **il fatto, mai il valore**:

| `tipo` | Scatta quando |
|---|---|
| `chiaro_telnet` | dati verso la 23 |
| `chiaro_ftp` | `PASS` verso la 21 |
| `chiaro_posta` | `USER`/`PASS` sulla 110, `LOGIN` sulla 143, `AUTH PLAIN`/`AUTH LOGIN` sulla 25 |
| `chiaro_http_basic` | `Authorization: Basic` verso la 80 |
| `chiaro_ldap` | bind semplice sulla 389 con password non vuota |
| `snmp_vecchio` | versione 1 o 2c; dice solo **se** la comunità è `public` o `private` |
| `smb1` | la **risposta** del server alla negoziazione in SMB1 (la sola richiesta la mandano anche i client moderni) |
| `tls_vecchio` | saluto del client con versione massima TLS 1.0 o meno |
| `ntlm1` | risposta NTLM lunga 24 byte sulla 445 |
| `nome_conteso` | risposta LLMNR o NetBIOS da un indirizzo diverso da chi aveva già risposto per quel nome |
| `impianto_scrittura` | Modbus con funzione 5, 6, 15, 16; S7 «scrivi variabile» |
| `dns_anomalo` | nome più lungo di 100 caratteri, o più di 1000 richieste in 5 minuti dallo stesso host |

Lo stesso fatto fra gli stessi due host si scrive una volta l'ora. Dal DNS e dal saluto TLS si tengono
anche i nomi, al più 200 diversi per host al giorno, contati per finestra di 5 minuti.

- `GET /v1/fatti?dopo=&limite=` → righe `seq, visto, tipo, client, server, porta, dettaglio`
- `GET /v1/nomi?dopo=&limite=` → righe `seq, visto, client, tipo (dns|sni), nome, conteggio`

**Secondo gruppo** (riconoscere il protocollo su qualunque porta): c'è solo il filtro per misurarlo
(`SECONDO_GRUPPO_MISURA=1` nell'env), nessun controllo. Non si accende senza il sì di Riccardo.

## NetFlow e sFlow

Seconda sorgente, spenta di serie: `FLUSSI=netflow` (UDP 2055, `nfacctd`) oppure `FLUSSI=sflow` (UDP 6343,
`sfacctd`) in `/etc/collector-traffico/collector.env`, poi si rilancia `installa.sh`. Stesso conteggio e
stessa cartella del mirror; il prefisso del file (`netflow-`, `sflow-`, `mirror-`) dice la fonte, che arriva
fino a IPAM nella colonna `fonte`. I flussi campionati non si sommano al mirror dello stesso tratto: IPAM
prende il massimo fra le fonti, come fra due collector.

**Da fare con Riccardo**: i comandi per accendere l'esportazione su uno switch e su un firewall che Domarc
usa davvero, e la prova con un apparato vero. Finora il percorso è provato solo con un file di esempio.

## Banco su PX-NAS (20/11/2026)

Tutto sul PX-NAS (`192.168.99.1`), rete 99, bridge `vmbr0`. Mai su reti di clienti.

| Cosa | Dov'è |
|---|---|
| `collector-banco` | VM 109, Debian 12 (immagine cloud), 1 vCPU, 512 MB, 8 GB su `zfs`. `eth0` di gestione in DHCP (il 20/11: 192.168.99.89), `ens19` in mirror senza indirizzo |
| `banco-carico` | contenitore 110, Debian 12 (il 20/11: 192.168.99.88): fa il traffico di prova verso `banco-sim` e l'`iperf3` verso il nodo |
| `banco-sim` | contenitore 103, c'era già: Modbus su `192.168.99.221:502`, HTTP su `192.168.99.222:80`. Non è stato toccato |

Il DNS del nodo (`192.168.6.254`) non risponde: per scaricare l'immagine i nomi sono stati chiesti al router
della rete 99, senza cambiare la configurazione del nodo. VM e contenitore hanno `192.168.99.254` come DNS.

### Mirror dentro Proxmox

La seconda scheda della VM (`tap109i1`) si stacca dal bridge, così riceve **solo** quello che le copia `tc`:

```bash
ip link set tap109i1 nomaster
tc qdisc add dev veth103i0 clsact
tc filter add dev veth103i0 ingress matchall action mirred egress mirror dev tap109i1
tc filter add dev veth103i0 egress  matchall action mirred egress mirror dev tap109i1
```

Per toglierlo: `tc filter del dev veth103i0 ingress; tc filter del dev veth103i0 egress; tc qdisc del dev veth103i0 clsact`.
Niente di questo sopravvive a un riavvio del nodo o della VM: va rimesso a mano (`nomaster` compreso).
Per buttare il banco: `qm stop 109 && qm destroy 109` e `pct stop 110 && pct destroy 110`.

### Misura

`iperf3` da `banco-carico` al nodo, 5 minuti per carico, col solo veth di `banco-carico` in mirror. Sul
contenitore TSO e GSO sono spenti: senza, il veth passa pacchetti «giganti» da 20-60 KB e la VM ne vede un
ventesimo (una porta SPAN vera consegna pacchetti da 1500 byte: la prima misura, fatta così, non valeva).

| Carico | Pacchetti al secondo | Scartati da pcap | Scartati dalla scheda | RAM usata nella VM |
|---|---|---|---|---|
| 50 Mbit/s | 5.500 | 0 | 1 | 141 MB |
| 100 Mbit/s | 11.100 | 0 | 2 | 142 MB |
| 200 Mbit/s | 22.100 | 0 | 3 | 142 MB |

- **Byte contati contro byte mandati**: nelle due finestre tutte dentro la misura, 2,475 GB contati su 2,47
  attesi (passaggio da 50 a 100 Mbit/s) e 4,874 GB su 4,86 (da 100 a 200). In una riprova di due minuti a
  200 Mbit/s, 3,14 GB contati su 3,11 attesi (la differenza sono i pacchetti di conferma del ricevente).
  **Copertura a 200 Mbit/s: intera**, entro l'errore di lettura dell'ora di inizio e fine.
- **CPU** a 200 Mbit/s, conteggio più ascolto col primo gruppo di controlli: circa il **7% dell'unica vCPU**
  (somma di utente, sistema e interruzioni sul minuto).
- **RAM**: 153 MB usati su 469 con tutto acceso; i processi del collector occupano circa 130 MB. `pmacctd`
  con la cache di serie da 65537 voci ne chiedeva 265 e il kernel lo uccideva: ora 8191 voci, 33 MB.
- **Disco**: dopo 35 minuti di banco l'archivio è 1,1 MB (728 coppie, circa 120 per finestra).
- **Secondo gruppo**: col filtro acceso, sullo stesso traffico, CPU circa 3%. Non dice molto: `iperf3` manda
  pochi pacchetti «con dati spinti», il traffico vero di un ufficio ne ha molti di più. Resta spento.

**Non misurato**: migliaia di flussi diversi insieme (la misura ha un flusso solo: il costo di `pmacctd`
cresce coi flussi, non coi byte), una scheda fisica con una porta SPAN vera, più di 200 Mbit/s, una giornata intera.

### I casi del piano

1. **Tag VLAN**: 20 pacchetti UDP e una richiesta DNS mandati con tag 77 da `banco-carico`. `pmacctd` li
   conta (`10.77.0.1 → 10.77.0.2`) e l'ascolto tiene il nome (`tag.banco.test`): i due filtri con `vlan` funzionano.
2. **Pacchetto visto due volte**: 10 richieste HTTP da `banco-carico` a `banco-sim`: 127 pacchetti col solo
   veth di `banco-sim` in mirror, 259 con tutti e due. Il raddoppio c'è **solo per il traffico fra due
   porte entrambe in mirror**: quello verso una porta non copiata arriva una volta sola. `MIRROR_DOPPIO=1`
   dimezza tutto, quindi è giusto solo se ogni pacchetto arriva doppio (mirror di una VLAN intera in entrata
   e in uscita). La via pulita è chiedere allo switch la copia **in una sola direzione** (solo entrata) su tutte le porte.

### Rifare la cattura dei controlli

`tests/dati/controlli-banco.pcap` viene dal banco: sul contenitore dei server finti che accettano tutto,
dal nodo un client che fa un accesso per controllo con la password finta `ProvaSegreta123`, sulla VM
`tcpdump -s 256` su `ens19`. Dalla cattura si tengono i pacchetti con carico e si azzerano i MAC. Dopo la
prova, `grep -r ProvaSegreta /var/lib/collector-traffico /var/log /etc/collector-traffico` sulla VM: niente.
