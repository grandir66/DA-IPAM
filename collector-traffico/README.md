# Collector di traffico

Una VM leggera che ascolta il traffico in copia (mirror) e conta **chi parla con chi**.
IPAM la legge col cursore e calcola le anomalie. Spec:
`docs/superpowers/specs/2026-11-20-collector-traffico-design.md`.

**Due profili** (dal 23/11/2026): **avanzato**, di serie, dove conta e controlla Zeek; **leggero** (`pmacctd` più
l'ascolto scritto da noi) per le macchine piccole. Stesse tabelle e stessa API: IPAM non vede la differenza, se non
nella riga del collector. Vedi «Profilo avanzato (Zeek)».

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
bash /opt/collector-traffico/installa.sh [--profilo avanzato|leggero] <scheda in mirror> [nome]
```

Di serie il profilo avanzato; sotto 2 vCPU o 1900 MB di RAM `installa.sh` scende al leggero e lo stampa.
Rilanciarlo con l'altro profilo cambia profilo senza toccare l'archivio.

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

## Profilo avanzato (Zeek, 23/11/2026)

Piano `docs/superpowers/plans/2026-11-23-sonda-avanzata-zeek.md`, spec `…/specs/2026-11-23-sonda-avanzata-zeek-design.md`.

| Pezzo | Cosa fa |
|---|---|
| `zeek-collector.service` | Zeek 9.0.1 (`zeek-lts-core`, versione fissata in `installa.sh`), da solo, senza `zeekctl`, sulla scheda in mirror; registri JSON in `/var/lib/collector-traffico/zeek/`, chiusi ogni 5 minuti allineati all'orologio. Parte solo con `PROFILO=avanzato` e freno non tirato |
| `zeek/sonda.zeek` | l'elenco degli script caricati e i **filtri per campo**: comunità SNMP, utenti e password di HTTP, FTP, LDAP, NTLM, Kerberos, `uri` di HTTP non arrivano mai su disco. Di un segreto si tiene il fatto (`comunita_nota`, `accesso_basic`, `accesso_chiaro`). Ogni registro fuori elenco è spento (in Zeek 9 MySQL, RADIUS, SOCKS e RDP scrivono utenti) |
| `collector/zeek_adattatore.py` | dentro `collector-traffico`, a ogni giro: prende i registri **chiusi**, li traduce nelle tabelle di sempre (`conn` → coppie con `byte_ritorno` e `risposta`, esterni, connessioni; `dns`/`ssl` → nomi; `software` → nomi di tipo `software`; `ftp`, `http`, `ldap`, `snmp`, `modbus`, `ssl`+`x509`, `notice` → fatti), scrive la finestra in una transazione col nome del registro, poi li cancella. Un registro che non si legge va in `zeek/scartati/` e si conta in `/v1/stato` |
| `collector/profili.py` | chi fa ogni controllo: nel profilo avanzato l'ascolto lascia a Zeek i suoi (e anche connessioni e nomi DNS/TLS); resta all'ascolto ciò che Zeek non vede: identità (ARP, CDP, LLDP), telnet, posta, nomi contesi, DNS anomali, SMB1, NTLM1, scrittura S7 |
| `zeek-freno.timer` | da root ogni minuto (`collector.zeek_stato`): sopra il 70% del disco ferma Zeek e lascia `DATI/zeek-freno`, sotto il 50% lo riavvia. Da root perché `collector-traffico` gira con `NoNewPrivileges` e una Debian minima non ha polkit |

- **Copertura** dai contatori di Zeek (`stats.log`: `pkts_link`, `pkts_dropped`), mai da `capture_loss`.
- **`/v1/stato`** in più: `profilo`, `motore` (`zeek`|`pmacct`), `versione_motore`, `freno`, `scartati`.
- **Risorse**: 2 vCPU, 2 GB; registri al massimo una finestra (circa 25 MB sul DA-PX-03), poi cancellati.
- **Connessioni vive (24/11)**: Zeek da solo scrive una connessione quando finisce, e quelle sempre aperte non si
  vedevano. `sonda.zeek` scrive in `conn`, 5 secondi prima della chiusura di ogni finestra, quello che ogni connessione
  più vecchia di 2 minuti ha scambiato dall'ultima volta, e alla fine lo toglie dalla riga normale. `gia_vista` segna
  le righe dopo la prima: i byte si sommano, la connessione riuscita si conta una volta.
- **Limiti**: il tempo fra SYN e
  SYN-ACK non c'è (`ms_minimo`/`ms_mediano` = -1, «non misurato»). S7 e BACnet non li legge. SMB1 e NTLM1 restano
  all'ascolto finché una cattura vera non mostra che Zeek li distingue.
- **Dati di prova**: `tests/dati/zeek/` (cattura del banco, LEGGIMI); la prova di non-fuga è `tests/test_non_fuga.py`.
- **Giornata intera (sorvegliante `banco/giornata-zeek.sh`)**, chiusa su tutti il 25/11 alle 13:39 UTC:

  | Collector | Durata | CPU di Zeek, media e massimo (una vCPU) | RAM massima di Zeek | Disco massimo | Scartati |
  |---|---|---|---|---|---|
  | PX01 | 24 h, chiusa | 1%, 20% | 305 MB | 17% | 0 |
  | PX02 | 24 h, chiusa | 0%, 1% | 287 MB | 15% | 0 |
  | PX04 | 24 h, chiusa | 1%, 3% | 511 MB | 16% | 0 |
  | PX03, primo giro | 19 h 30, interrotto dalla scansione | 2,7%, 10% | 405 MB | 30% | 0 |
  | PX03, secondo giro | 24 h, chiusa | 2%, 6% | 415 MB | 25% | 0 |
  | PX05, primo giro | 18 h 20, interrotto dalla scansione | 0%, 1% | 1.060 MB | 16% | 0 |
  | PX05, secondo giro | 24 h, chiusa | 0%, 0% | 257 MB | 15% | 0 |

- **Coppie, profilo leggero contro avanzato** (22 ore contro 22 ore, 18 sul PX03; 22-23/11 contro 23-24/11): le righe
  calano da 341.869 a 105.920 (PX01), da 349.772 a 86.143 (PX02), da 347.256 a 181.462 (PX04) per due motivi.
  Il primo è voluto: 133.000-203.000 righe del leggero erano coppie viste in una finestra sola (scansioni e porte
  effimere; sul PX03 un milione). Il secondo è un **buco**: coppie stabili (viste in almeno 50 finestre) che con Zeek
  **mancano del tutto o quasi**, perché la connessione non si chiude mai e Zeek la scrive solo alla fine. Assenti 211
  su 699 sul PX01, 102 su 527 sul PX02, 124 su 652 sul PX04 (51 GB su 76 del traffico stabile), 241 su 4.590 sul PX03
  (46 GB su 109). Fra queste: telefoni SIP (17/5060), syslog (6/5140), connessioni 443 di giorni, annunci MikroTik
  (17/5678); gli agenti Wazuh (6/1514) ci sono ma in meno di un quarto delle finestre. Il conto è per eccesso: una
  parte degli assenti ha il verso rovesciato o ha cambiato protocollo (ICMPv6 ora conta come ICMP, IGMP non c'è).
  **Corretto il 24/11** (connessioni vive; PX03 e PX05 il 25/11). Finestre da 5 minuti prima e dopo (19:00 e 19:30 UTC), coppie: PX02 Wazuh
  da 1 a 28, syslog da 2 a 10, MikroTik da 0 a 16; PX01 SIP da 0 a 19, Wazuh da 0 a 4; PX04 Wazuh da 0 a 5, syslog
  da 1 a 3, MikroTik da 0 a 16; PX03 (25/11) Wazuh da 1 a 8, syslog da 1 a 4, MikroTik da 0 a 16, byte per finestra da
  321 MB a 600-2.200 MB; PX05 MikroTik da 0 a 17. Memoria di Zeek e di `collector-traffico` uguale a prima; sul PX03,
  nella prima ora, Zeek fermo a 201 MB e `collector-traffico` a 51.

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

## Chi è un indirizzo (`identita.py`, 23/11/2026)

Lo stesso processo dell'ascolto legge anche come gli apparati si annunciano: ARP, DHCP (nome dell'host, classe del
produttore, opzioni chieste), mDNS, NetBIOS, SSDP, LLDP e CDP. In archivio, tabella `identita`: **una riga per
(MAC, IP, fonte)**, riscritta solo se cambia qualcosa o dopo un'ora, con un numero nuovo perché IPAM la rilegga
(`GET /v1/identita?dopo=`). Per questo `tcpdump` tiene 600 byte a pacchetto invece di 256 (le opzioni DHCP cominciano al
byte 282; `CATTURA` nell'ambiente lo cambia) e il filtro chiede anche ARP, le porte 67, 68, 5353, 1900, LLDP e CDP.
`IDENTITA=0` nell'ambiente lo spegne. Il MAC di chi manda vale solo per i pacchetti a tutti (un router non li inoltra);
per DHCP vale il MAC scritto nel messaggio.

Misura su `DA-COLLECTOR-PX03`, 22/11 notte (tre minuti dopo il riavvio, traffico basso): `collector-ascolto` 0,37% di una
CPU (prima 0,39% di media su 61 ore), 9 MB di RAM, copertura 99,97%; 105 righe di identità (81 ARP, 15 CDP, 4 DHCP,
4 mDNS, 1 LLDP). Da rifare di giorno.

## Verso l'esterno (`piega.esterni`, 23/11/2026)

Le coppie non cambiano: lì tutto ciò che è fuori resta `esterno`. In più, per ogni finestra del mirror, la tabella
`esterno` tiene per ogni host interno i 50 indirizzi esterni più pesanti (`ESTERNI_PER_HOST`; `ESTERNI=0` spegne); gli
altri finiscono in una riga con `ip = altri`, che porta i loro byte e in `flussi` quanti indirizzi sono rimasti fuori.
`collector-ascolto` tiene in `nome_ip` il nome di un indirizzo esterno, uno per tipo: quello chiesto al DNS (dalla
risposta) e quello del saluto TLS. Rotte `GET /v1/esterni?dopo=` e `GET /v1/nomi-ip?dopo=`.

## Connessioni che non vanno (`connessioni.py`, 23/11/2026)

`collector-ascolto` guarda anche i pacchetti che aprono o rifiutano una connessione TCP (SYN, SYN-ACK, RST; solo IPv4).
Per finestra scrive in `connessione` una riga per (client, server, porta) dove qualcosa è andato storto (senza risposta
dopo 10 secondi, rifiutata, SYN ripetuti) e una riga per servizio, con `client` vuoto, con le aperture riuscite e il
tempo fra SYN e SYN-ACK (minimo e mediano, in millisecondi). Rotta `GET /v1/connessioni?dopo=`; `CONNESSIONI=0` spegne.
Sono indizi: se in una finestra non passa nessuna risposta (copia di una sola direzione) i «senza risposta» non si scrivono.

## NetFlow e sFlow

Seconda sorgente, spenta di serie: `FLUSSI=netflow` (UDP 2055, `nfacctd`) oppure `FLUSSI=sflow` (UDP 6343,
`sfacctd`) in `/etc/collector-traffico/collector.env`, poi si rilancia `installa.sh`. Stesso conteggio e
stessa cartella del mirror; il prefisso del file (`netflow-`, `sflow-`, `mirror-`) dice la fonte, che arriva
fino a IPAM nella colonna `fonte`. I flussi campionati non si sommano al mirror dello stesso tratto: IPAM
prende il massimo fra le fonti, come fra due collector.

**Da fare con Riccardo**: i comandi per accendere l'esportazione su uno switch e su un firewall che Domarc
usa davvero, e la prova con un apparato vero. Finora il percorso è provato solo con un file di esempio.

## Su un nodo Proxmox: copia dell'uplink (DA-PX-04, 20/11/2026)

Una VM collector per nodo; la copia la fa `tc` sull'uplink delle VM e la rimette uno hookscript a ogni avvio
della VM (quindi anche dopo un riavvio del nodo). File in `proxmox/`.

| Cosa | Dov'è |
|---|---|
| `DA-COLLECTOR-PX04` | VM 113 su DA-PX-04, Debian 12 (immagine cloud), 2 vCPU, 2 GB (dal 23/11, come gli altri quattro), 8 GB su `zfs`, parte col nodo. `net0` di gestione su `vmbr_int` VLAN 4 in DHCP (il 20/11: 192.168.4.185); `net1` su `vmbr0`, un bridge senza porte, così riceve solo la copia |
| `DA-COLLECTOR-PX03` | VM 114 su DA-PX-03 (il 20/11: 192.168.4.186). Come la 113, ma `net1` sta su `vmbr10GB`: su quel nodo `vmbr0` è il bridge di gestione e non va usato |
| `DA-COLLECTOR-PX02` | VM 115 su DA-PX-02 (il 20/11: 192.168.4.190), `net1` su `vmbr0` |
| `DA-COLLECTOR-PX01` | VM 116 su DA-PX-01 (il 22/11: 192.168.4.192), `net1` su `vmbr0`. Sul nodo gira la 423: non è stata toccata |
| `DA-COLLECTOR-PX05` | VM 102 su DA-PX-05 (il 22/11: 192.168.4.198). Nodo di laboratorio a sé: `bond10` è giù e le VM escono da `bond25` (`vmbr0`). In `/etc/collector-mirror.conf` del nodo: `UPLINK=bond25`, `VLAN_FUORI=` (niente da escludere), `STACCA=1`, perché non c'è un bridge vuoto e `net1` è dichiarata su `vmbr_VM` e staccata all'avvio. `net0` su `vmbr0` con tag 4 |
| `proxmox/collector-mirror.sh` | hookscript, sul nodo in `/var/lib/vz/snippets/`. In `post-start` copia entrata e uscita di `bond10` verso `tap<vmid>i1`; in `pre-stop`/`post-stop` toglie i suoi filtri. Usa solo le priorità 4476 e 4477. Un nodo fatto diversamente lo dice in `/etc/collector-mirror.conf` (`UPLINK`, `VLAN_FUORI`, `STACCA`) |
| `proxmox/collector-vendor.yaml` | cloud-init: installa l'agente QEMU, che serve a leggere l'indirizzo preso in DHCP |

```bash
qm set 113 --hookscript local:snippets/collector-mirror.sh
tc filter show dev bond10 ingress        # si vede la copia
journalctl -t collector-mirror           # cosa ha fatto lo script
```

Cose da sapere:

- **La VLAN 16 (storage: NFS e backup) non si copia**: da sola è l'80% dei byte dell'uplink. Su un altro nodo
  `UPLINK` e `VLAN_FUORI` in testa allo script vanno guardati prima (`/etc/network/interfaces`, `storage.cfg`).
- Sul DA-PX-03 due VM stanno su `vmbr_ext` (`nic3`): quel traffico non passa da `bond10` e non si copia.
- La copia dell'uplink **non vede il traffico fra due VM dello stesso nodo**, che non esce dal bridge.
- Due VM dello stesso nodo su VLAN diverse, instradate dal firewall fuori: il pacchetto esce e rientra, si conta due volte.
- Sul nodo il GRO resta acceso (è in produzione): i byte sono giusti, i pacchetti contati sono meno di quelli veri.
- Per toglierla: `qm set 113 --delete hookscript`, poi `qm stop 113 && qm destroy 113`; il `clsact` vuoto su `bond10` si toglie con `tc qdisc del dev bond10 clsact`.

## Banco su PX-NAS (20/11/2026)

Tutto sul PX-NAS (`192.168.99.1`), rete 99, bridge `vmbr0`. Mai su reti di clienti.

| Cosa | Dov'è |
|---|---|
| `collector-banco` | VM 109, Debian 12 (immagine cloud), 1 vCPU, 512 MB, 8 GB su `zfs`. `eth0` di gestione in DHCP (il 20/11: 192.168.99.89), `ens19` in mirror senza indirizzo |
| `banco-carico` | contenitore 110, Debian 12 (il 20/11: 192.168.99.88): fa il traffico di prova verso `banco-sim` e l'`iperf3` verso il nodo |
| `banco-sim` | contenitore 103, c'era già: Modbus su `192.168.99.221:502`, HTTP su `192.168.99.222:80`. Non è stato toccato |

Il nodo aveva come DNS `192.168.6.254`, un relitto del 15/05 (rete del laboratorio Domarc): il 20/11 è stato
messo `192.168.99.254` con `pvesh` (copia in `/etc/resolv.conf.bak-20261120`). VM e contenitore usano lo stesso.

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

### Misura di Zeek (23/11/2026)

Chiesta da Riccardo per decidere la sonda avanzata. Zeek 9.0.1 LTS (`zeek-lts-core`, dal repository
ufficiale del progetto su `download.opensuse.org`, 53 MB in `/opt/zeek`), da solo, coi servizi del collector
fermi; VM 109 portata a 2 vCPU e 4 GB per la prova. Avvio: `zeek -C -i ens19 local misc/stats
misc/capture-loss LogAscii::use_json=T`. Script: `banco/misura-zeek.sh` (gira sul nodo), 100 secondi per carico.

| Carico | CPU di Zeek | RAM di Zeek | Pacchetti al secondo | Scartati da Zeek | Registri scritti |
|---|---|---|---|---|---|
| fermo | 0% | 259 MB | 160 | 0 | 0,3 MB |
| 50 Mbit/s, un flusso | meno dell'1% | 261 MB | 5.400 | 0 | 1,0 MB |
| 100 Mbit/s, un flusso | 1% | 262 MB | 11.000 | 0 | 1,5 MB |
| 200 Mbit/s, un flusso | 1% | 262 MB | 22.400 | 0 | 1,2 MB |
| 84 pagine HTTP e 84 richieste DNS al secondo | 6% | 269 MB | 2.300 | 0 | 19,4 MB |

- La CPU è la percentuale di **una** vCPU; tutta la VM usava 551 MB.
- **Zeek costa per connessione, non per byte**: un flusso solo a 200 Mbit/s non gli pesa, 170 scambi al
  secondo sì. I registri fanno circa 1,1 KB a scambio: a quel ritmo sono 16 GB al giorno, quindi chi li
  legge li deve anche buttare.
- **Non spiegato**: durante `iperf3` il controllo `capture-loss` di Zeek dice 43-72% di perdita, mentre i
  suoi contatori (`pkts_dropped` 0, byte ricevuti pari ai 200 Mbit/s mandati) e la scheda dicono che è
  arrivato tutto. Nella fase HTTP e DNS dice 0. Sulla scheda il GRO è acceso: è il primo indiziato.
- **Cosa scrive**: `conn` (chi ha aperto, stato della connessione, pacchetti e byte per verso), `http`,
  `dns`, `ssl` (versione e cifrario), `modbus` (funzione), `snmp`, `dhcp`, `software` (versione del
  server vista in rete), `known_hosts`, `known_services`, `files`, `weird`, `notice`.
- **Password**: una richiesta HTTP con accesso Basic di prova non ha lasciato la password in nessun
  registro, né in chiaro né in base64. FTP, posta e LDAP **non provati**.
- **Trappola: `snmp.log` scrive il nome della comunità in chiaro.** Il campo `community` va tolto prima
  che i registri tocchino il disco, non dopo.
- **Non misurato**: traffico vero di un ufficio (migliaia di connessioni aperte insieme fanno crescere la
  RAM), una giornata intera, i parser industriali aggiuntivi.

Dopo la prova la VM 109 è tornata allo snapshot (1 vCPU, 512 MB, senza Zeek) e lo snapshot è stato tolto.

### Zeek sul traffico vero (23/11/2026)

Un'ora (10:34-11:33 UTC) su `DA-COLLECTOR-PX03` (VM 114, DA-PX-03), copia di `bond10` senza la VLAN 16,
accanto al collector acceso. VM portata a 4 GB per la prova, poi riportata allo snapshot (1 GB, senza Zeek).
Stesso avvio del banco più `togli.zeek`, un filtro che toglie il campo `community` da `snmp.log`.

| Misura | Valore |
|---|---|
| Traffico copiato | media 23 Mbit/s e 4.350 pacchetti al secondo; minuto più carico circa 100 Mbit/s |
| CPU di Zeek | media 4,4% di una vCPU, minuto più carico 8,4% |
| RAM di Zeek | 270 MB all'avvio, 379 MB stabile dopo 10 minuti |
| Connessioni | 340.656 in un'ora (circa 95 al secondo), al massimo 2.640 TCP aperte insieme; 435 host che aprono, 3.751 che rispondono |
| Pacchetti persi | Zeek 0 su 15,4 milioni; la scheda 2.530 (0,02%) |
| Registri | 257 MB in un'ora, circa 6 GB al giorno; `conn` 129 MB, `snmp` 46 MB, `http` 32 MB |
| Comunità SNMP | 0 righe col campo: il filtro funziona |

- **Il collector leggero non cambia**: con Zeek accanto ha continuato a girare, e la VM intera è stata
  sotto i 470 MB usati. Una VM con 2 vCPU e 2 GB basta per un nodo come il DA-PX-03.
- **Metà delle connessioni è SNMP** (179.289): sistemi di controllo che interrogano gli apparati
  (`192.168.4.40` 108.750, `192.168.4.15` 56.299, IPAM `192.168.4.8` 12.439). Vanno tra le sonde note anche qui.
- **Cosa ha visto in più del collector**: sessioni TLS 1.0 e 1.1 verso 15 server; 168 certificati non
  validi; NTLM e SMB (186 scambi NTLM); versioni del software di 81 server HTTP e 80 server SSH; 23 prove
  Log4Shell (`${jndi:…}`). Gli avvisi «tentativi di password SSH» e «SQL injection» vengono da IPAM
  (`192.168.4.8`): le sue scansioni. Le prove Log4Shell probabilmente sono le scansioni di Edge (non verificato).
- **Perdita segnalata da `capture-loss`**: quasi sempre sotto l'1%, con picchi fra 8% e 29% in sette
  minuti su sessanta, mentre i contatori di Zeek danno 0 scartati. È la stessa stranezza del banco, non spiegata.

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
