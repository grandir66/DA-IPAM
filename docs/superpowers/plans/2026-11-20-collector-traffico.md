# Collector di traffico — piano di esecuzione

> Si esegue con la skill `subagent-driven-development` oppure in linea
> (una sessione che esegue i task in ordine). Le caselle `- [ ]` tengono il conto.

**Obiettivo:** una VM leggera che conta dal mirror chi parla con chi, e IPAM che la legge e segnala le anomalie fra gli host.
**Architettura:** sulla VM `pmacct` conta, un servizio Python senza dipendenze tiene le righe in SQLite e le espone su un'API HTTPS col cursore. IPAM legge ogni 5 minuti (schema di `src/lib/trunk/sensore-trunk.ts`), tiene coppie e abitudini nel database del tenant e calcola le anomalie. I controlli sul contenuto sono un secondo processo sulla VM che guarda solo l'inizio delle connessioni.
**Spec:** `docs/superpowers/specs/2026-11-20-collector-traffico-design.md`
**Livello di controllo:** leggero (proposto nella spec, approvata da Riccardo il 20/11/2026).
**Stato:** approvato · **Ultimo aggiornamento:** 2026-11-20

## Vincoli globali

- **Separato, distribuito e alternativo alla sonda pesante (Riccardo, 20/11).** Il collector è un servizio a sé: nessun codice in comune con Edge o con l'NDR di Codex (ramo `codex/edge-va-gemella` di DA-Vul-can, che non si tocca), nessuna dipendenza da loro, si installa e si aggiorna da solo. In un punto di ascolto va o lui o la sonda pesante. Più collector per cliente sono il caso normale.

- Repo DA-IPAM, ramo `dev`. **Mai push su `main`.** Rilascio a fine tappa con `npm run version:release -- --staged-only`, poi `git push origin dev`.
- Il collector vive in `collector-traffico/` nella radice di DA-IPAM. Python 3.11, **solo libreria standard** (niente FastAPI: deve stare in 512 MB).
- Obiettivo della VM: 1 vCPU, 512 MB di RAM, 8 GB di disco, 200 Mbit/s di mirror. Si misura al Task 2 e il numero vero si scrive nella spec.
- La scheda in mirror non ha indirizzo e non trasmette. Il collector non manda mai niente sulla rete ascoltata.
- Mai salvati: contenuto dei pacchetti, URL, credenziali, nomi di comunità SNMP. Mai nei log: IP, nomi, gettoni.
- Date in SQLite sempre `AAAA-MM-GG HH:MM:SS` in UTC, mai `isoformat()` (la `T` rompe i confronti con `datetime('now')`).
- Finestra di conteggio: 300 secondi. Sul collector si tengono 7 giorni, in IPAM 90 giorni di totali per giorno.
- Apprendimento: 14 giorni per rete dalla prima coppia vista. Le anomalie conclamate (Task 6) non lo aspettano.
- In IPAM: ogni rotta apre con la guardia d'accesso e passa da `withTenantFromSession`; tabelle nuove solo con `CREATE TABLE IF NOT EXISTS` dentro una funzione `assicura…` come in `src/lib/db-tenant-schema.ts`; nessun CHECK, nessuna chiave esterna verso `hosts`.
- Interfaccia: prima di scriverla si propone a Riccardo oggetto per oggetto. Gravità distinta per forma e luminosità (Riccardo è daltonico). Testi in italiano, scala `--text-*`.
- Verifiche entro 2 minuti: `python3 -m pytest collector-traffico/tests`, `node --import tsx --test "src/lib/traffico/**/*.test.ts"`, `npx tsc --noEmit`. Il cancello completo una volta sola, prima del live.
- **Fuori da questo piano**: installazione dentro Deploy-Appliance e prima sede di un cliente (tappa 6 della spec). Si pianificano quando i Task 1-7 sono chiusi.

## Casi da non dimenticare

1. **Il mirror di un trunk porta il tag VLAN.** Un filtro senza `vlan` non vede i pacchetti con tag: sia `pmacct` sia `tcpdump` vanno provati con traffico taggato. Task 2 e Task 6.
2. **Il mirror vede ogni pacchetto due volte** se lo switch copia entrata e uscita. Il conteggio raddoppia: Task 2 lo misura e, se serve, il collector dimezza con `mirror_doppio=1`.
3. **IPAM fermo per più di 7 giorni**: il collector ha buttato le finestre vecchie. `GET /v1/coppie` risponde `buco: true` e IPAM lo scrive in `traffico_collector.ultimo_buco`. Task 1 e Task 3.
4. **Lo stesso flusso visto da due collector** (due punti di ascolto sulla stessa strada): i totali si sommano due volte. La chiave di `traffico_coppie` contiene `collector_id` e la lettura per host prende il massimo fra i collector, non la somma. Task 3.
5. **Un IP che cambia padrone** (DHCP): la coppia si aggancia all'host che aveva quell'IP nella finestra, con la mappa MAC-IP. Se non si sa, resta l'IP nudo. Task 3.

---

### [x] Task 1 — Il collector: conteggio, SQLite, API

Verifica: `python3 -m unittest discover -s collector-traffico/tests -t collector-traffico` → 21 prove, OK (20/11; sul Mac pytest non c'è, le prove sono `unittest` e girano anche sotto pytest).

**File** (tutti nuovi, in `collector-traffico/`):
- `collector/piega.py`, `collector/archivio.py`, `collector/api.py`, `collector/__main__.py`
- `pmacctd.conf`, `collector-traffico.service`, `pmacctd-collector.service`, `installa.sh`, `README.md`
- `tests/test_piega.py`, `tests/test_archivio.py`, `tests/test_api.py`

**Cosa fare**

`pmacctd.conf`: interfaccia in mirror da `/etc/collector-traffico/collector.env` (`MIRROR_IF`), `aggregate: src_host,dst_host,proto,src_port,dst_port`, plugin `print` con uscita JSON ogni 300 secondi in `/var/lib/collector-traffico/in/`. I nomi esatti delle chiavi si verificano con `man pmacctd` sulla VM del Task 2 prima di fissarli.

`piega.py`, funzione pura, **prova prima del codice**:

```python
def piega(righe: list[dict], reti_interne: list[str]) -> list[dict]:
    """Da righe pmacct (src, dst, proto, sport, dport, byte, pacchetti) a coppie.
    porta = min(sport, dport) se < 32768, altrimenti 0 («porte alte»).
    server = il lato che ha quella porta; client = l'altro. Con porta 0: server = dst.
    Le due direzioni dello stesso scambio finiscono nella stessa coppia (byte sommati).
    Un lato fuori da reti_interne diventa "esterno" e la riga porta esterni = numero di
    indirizzi esterni diversi. ICMP e protocolli senza porta: porta 0.
    Ritorna: client, server, proto, porta, byte, pacchetti, flussi, esterni."""
```

`reti_interne` di serie: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`; si allunga da `RETI_INTERNE` nell'env.

`archivio.py`: SQLite in `/var/lib/collector-traffico/collector.db`, WAL.

```sql
CREATE TABLE IF NOT EXISTS coppia (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, inizio TEXT NOT NULL, durata_s INTEGER NOT NULL,
  client TEXT NOT NULL, server TEXT NOT NULL, proto INTEGER NOT NULL, porta INTEGER NOT NULL,
  byte INTEGER NOT NULL, pacchetti INTEGER NOT NULL, flussi INTEGER NOT NULL, esterni INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS stato (chiave TEXT PRIMARY KEY, valore TEXT NOT NULL);
```

Funzioni: `scrivi_finestra(inizio, coppie)`, `leggi_coppie(dopo: int, limite: int) -> (righe, ultimo_seq, altri, buco)`, `sfoltisci(giorni=7)`. `buco` è vero se `dopo` è più piccolo del `seq` più vecchio rimasto meno uno e `dopo > 0`.

`__main__.py`: ogni 30 secondi prende i file nuovi da `in/`, li piega, li scrive, li cancella; una volta l'ora `sfoltisci`. Legge da `/proc/net/dev` i pacchetti visti e scartati su `MIRROR_IF` e li tiene in `stato`.

`api.py`: `http.server` su HTTPS, porta `8477`, certificato autofirmato creato da `installa.sh`. Ogni richiesta chiede `Authorization: Bearer <gettone>` (file `/etc/collector-traffico/gettone`, 600); senza: 401.
- `GET /v1/stato` → `{versione, nome, avviato, ultimo_seq, pacchetti_visti, pacchetti_persi, copertura}` con `copertura = 1 - persi/(visti+persi)`.
- `GET /v1/coppie?dopo=<seq>&limite=<1..1000>` → `{righe: [...], ultimo_seq, altri, buco}`.

`installa.sh`: Debian 12; `apt-get install -y pmacct tcpdump python3`; utente `collector`; cartelle; gettone casuale; certificato; i due servizi systemd. Stampa l'impronta SHA-256 del certificato e **non** il gettone (dice solo dove sta).

**Interfacce prodotte:** le due rotte qui sopra, la porta `8477`, il formato delle righe.

**Verifica:** `python3 -m pytest collector-traffico/tests` → verde. Le prove coprono: le due direzioni nella stessa coppia, la porta alta che diventa 0, l'esterno contato, il cursore, il buco, il 401 senza gettone.

**Commit:** `Collector di traffico: conteggio, archivio e API`

---

### [ ] Task 2 — Il banco su PX-NAS e la misura

**Dipende da:** Task 1.

**Cosa fare**

- Su PX-NAS una VM Debian 12 nuova (`pvesh get /cluster/nextid` per il numero), nome `collector-banco`, 1 vCPU, 512 MB, 8 GB, due schede su `vmbr99`: la prima con indirizzo sulla rete 99, la seconda senza. **Mai sul 72729 né su reti di clienti.**
- Mirror dentro Proxmox: sull'host, `tc qdisc add dev <veth di banco-sim> clsact` e due filtri `mirred egress mirror` verso la `tap` della seconda scheda del collector, uno per `ingress` e uno per `egress`. I comandi veri si scrivono in `collector-traffico/README.md`, con quelli per toglierli.
- `scp` della cartella e `bash /opt/collector-traffico/installa.sh` sulla VM.
- Traffico di prova da `banco-sim` (CT 103): Modbus verso `192.168.99.221:502` e HTTP verso `192.168.99.222:80`.
- Misura con `iperf3` fra due contenitori sulla rete 99 a 50, 100 e 200 Mbit/s per 5 minuti l'uno: CPU e RAM del collector (`pidstat`), pacchetti persi da `/v1/stato`. Una prova con traffico taggato (caso 1) e il controllo del raddoppio (caso 2).

**Verifica:** `curl -sk -K <file col gettone> https://<ip collector>:8477/v1/coppie?dopo=0` restituisce le coppie `…221:502` e `…222:80`. La tabella della misura sta in `collector-traffico/README.md` e i numeri veri sostituiscono gli obiettivi nella spec. Se a 200 Mbit/s la copertura è sotto il 95%, si scrive il tetto vero e ci si ferma a dirlo a Riccardo: è la decisione fra `pmacct` e il contatore nel kernel.

**Commit:** `Collector di traffico: banco su PX-NAS e misura`

---

### [ ] Task 3 — IPAM legge il collector

**Dipende da:** Task 1 (formato dell'API).

**File**
- Crea: `src/lib/traffico/schema.ts`, `src/lib/traffico/collector-client.ts`, `src/lib/traffico/lettura.ts`, `src/lib/traffico/job.ts`, `src/lib/traffico/__tests__/lettura.test.ts`
- Crea: `src/app/api/traffico/collector/route.ts`, `src/app/api/traffico/collector/[id]/route.ts`, `src/app/api/traffico/host/[ip]/route.ts`
- Modifica: `server.ts` (avvio del job, accanto a quello del trunk)

**Cosa fare**

`schema.ts`, `export function assicuraTabelleTraffico(db: Database.Database): void`:

```sql
CREATE TABLE IF NOT EXISTS traffico_collector (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, sede TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL, gettone_enc TEXT NOT NULL, impronta TEXT NOT NULL, attivo INTEGER NOT NULL DEFAULT 1,
  cursore_coppie INTEGER NOT NULL DEFAULT 0, cursore_fatti INTEGER NOT NULL DEFAULT 0,
  ultimo_contatto TEXT, ultimo_errore TEXT, ultimo_buco TEXT, copertura REAL, creato TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS traffico_coppie (
  giorno TEXT NOT NULL, collector_id INTEGER NOT NULL, client TEXT NOT NULL, server TEXT NOT NULL,
  proto INTEGER NOT NULL, porta INTEGER NOT NULL, byte INTEGER NOT NULL, pacchetti INTEGER NOT NULL,
  flussi INTEGER NOT NULL, esterni INTEGER NOT NULL DEFAULT 0, prima_vista TEXT NOT NULL, ultima_vista TEXT NOT NULL,
  PRIMARY KEY (giorno, collector_id, client, server, proto, porta));
CREATE INDEX IF NOT EXISTS idx_traffico_coppie_client ON traffico_coppie (client, giorno);
CREATE INDEX IF NOT EXISTS idx_traffico_coppie_server ON traffico_coppie (server, giorno);
```

Il gettone si cifra con la stessa funzione che DA-IPAM usa per le credenziali di sistema (`rg -n "export function (encrypt|safeDecrypt)" src/lib`), mai in chiaro e mai restituito da una rotta.

`collector-client.ts`: `collectorGet<T>(c: {url, gettone, impronta}, percorso: string): Promise<T>` con `node:https`, `rejectUnauthorized: false` e controllo a mano che l'impronta SHA-256 del certificato sia quella salvata; diversa → errore `ImprontaCambiata`, mai un ripiego. Tempo massimo 15 secondi.

`lettura.ts`: `sincronizzaTraffico(): Promise<{collector: number; righe: number; errori: number}>`. Per ogni collector attivo: `/v1/stato`, poi `/v1/coppie?dopo=<cursore>` a pagine da 1000, al più 20 pagine per giro. Ogni riga entra in `traffico_coppie` con `INSERT … ON CONFLICT DO UPDATE` che somma byte, pacchetti e flussi e aggiorna `ultima_vista`. Cursore e righe nella stessa transazione. Un errore di rete scrive `ultimo_errore` e **non** tocca il cursore. `buco: true` scrive `ultimo_buco`. Una volta al giorno si cancellano i giorni più vecchi di 90.

`coppieDiHost(ip: string, giorni = 7)`: per ogni coppia il massimo fra i collector (caso 4), divise in «parla con» e «gli parlano».

`job.ts`: `export const CRON_TRAFFICO = "*/5 * * * *"`, stesso schema di `src/lib/trunk/job.ts` (stato su `globalThis`, un giro alla volta, `withTenant` per ogni cliente attivo). Parte solo se il tenant ha almeno un collector.

Rotte: `GET/POST /api/traffico/collector` e `PATCH/DELETE /api/traffico/collector/[id]` con `requireAdmin`; il `POST` prende nome, sede, url, gettone e impronta, chiama `/v1/stato` e salva solo se risponde. `GET /api/traffico/host/[ip]` con `requireAuth`.

**Verifica:** `node --import tsx --test "src/lib/traffico/**/*.test.ts"` (somma sul conflitto, cursore fermo su errore, massimo fra collector) e `npx tsc --noEmit` → verdi. Sul dev: registrato `collector-banco`, dopo un giro `GET /api/traffico/host/192.168.99.221` mostra la coppia sulla 502.

**Commit:** `Traffico: IPAM legge il collector col cursore`

---

### [ ] Task 4 — Abitudini e anomalie

**Dipende da:** Task 3.

**File**
- Crea: `src/lib/traffico/anomalie.ts`, `src/lib/traffico/__tests__/anomalie.test.ts`
- Crea: `src/app/api/traffico/anomalie/route.ts`, `src/app/api/traffico/anomalie/[id]/route.ts`
- Modifica: `src/lib/traffico/schema.ts`, `src/lib/traffico/lettura.ts`

**Cosa fare**

```sql
CREATE TABLE IF NOT EXISTS traffico_abitudini (
  client TEXT NOT NULL, server TEXT NOT NULL, proto INTEGER NOT NULL, porta INTEGER NOT NULL,
  prima_vista TEXT NOT NULL, confermata INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client, server, proto, porta));
CREATE TABLE IF NOT EXISTS traffico_reti (network_id INTEGER PRIMARY KEY, prima_vista TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS traffico_anomalie (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT NOT NULL, gravita INTEGER NOT NULL,
  client TEXT NOT NULL, server TEXT NOT NULL DEFAULT '', proto INTEGER NOT NULL DEFAULT 0, porta INTEGER NOT NULL DEFAULT 0,
  dettaglio TEXT NOT NULL DEFAULT '{}', prima_vista TEXT NOT NULL, ultima_vista TEXT NOT NULL,
  conteggio INTEGER NOT NULL DEFAULT 1, stato TEXT NOT NULL DEFAULT 'nuova',
  UNIQUE (tipo, client, server, proto, porta));
```

`anomalie.ts`, **prove prima del codice**, funzione pura:

```ts
export type TipoAnomalia = "coppia_nuova" | "porta_nuova" | "molti_contatti" | "impianto"
  | "vlan_chiuse" | "volume" | "non_censito";
export function valutaFinestra(ingresso: {
  coppie: CoppiaFinestra[];              // le righe di una finestra di 5 minuti
  abitudini: Set<string>;                // chiave `${client}|${server}|${proto}|${porta}`
  serverNoti: Map<string, Set<number>>;  // server → porte già viste
  retiInApprendimento: Set<number>;      // network_id ancora nei 14 giorni
  reteDi: (ip: string) => number | null;
  impianti: Set<string>;                 // IP con eImpianto
  censiti: Set<string>;
  chiuse: Set<string>;                   // `${reteA}|${reteB}` dalla matrice di segmentazione
}): AnomaliaNuova[];
```

Regole, con i valori:
- `coppia_nuova` (gravità 1): chiave non nelle abitudini, tutti e due interni.
- `porta_nuova` (2): server noto, porta mai vista su di lui, porta diversa da 0.
- `molti_contatti` (3): un client con **30 o più** server interni diversi nella stessa finestra.
- `impianto` (3): un impianto è client o server di una coppia nuova, oppure parla con `esterno`.
- `vlan_chiuse` (3): le reti dei due lati sono nella matrice come chiuse. Non aspetta l'apprendimento.
- `non_censito` (2): un IP interno che non è in `censiti`. Non aspetta l'apprendimento.
- `volume` (2), calcolata una volta al giorno e non nella finestra: byte del giorno di un host **più di 5 volte** la mediana dei 14 giorni prima **e** più di 500 MB.
- Se la rete del client è in apprendimento, `coppia_nuova`, `porta_nuova`, `molti_contatti` e `impianto` non escono: la coppia entra solo nelle abitudini.

`lettura.ts`: dopo ogni finestra scritta chiama `valutaFinestra`, inserisce le anomalie (sul conflitto: `conteggio + 1`, `ultima_vista`), poi aggiunge le coppie alle abitudini. Un'anomalia in stato `normale` non torna `nuova`.

Rotte: `GET /api/traffico/anomalie?stato=&tipo=&pagina=` (`requireAuth`); `PATCH /api/traffico/anomalie/[id]` con `{stato: "vista" | "normale"}` (`requireOperator` o la guardia equivalente che DA-IPAM usa per le azioni operative): `normale` mette anche `confermata = 1` sull'abitudine.

**Verifica:** `node --import tsx --test "src/lib/traffico/**/*.test.ts"` → verde, una prova per regola più: apprendimento che tace, `normale` che non torna. Sul banco: un contenitore nuovo che apre la 502 di `sim-impianto` genera `impianto`.

**Commit:** `Traffico: abitudini e anomalie`

---

### [ ] Task 5 — Interfaccia

**Dipende da:** Task 4.

**Cosa fare**

1. **Prima di scrivere**: proporre a Riccardo in chat, oggetto per oggetto, (a) la pagina `/traffico` con l'elenco delle anomalie, i filtri e il pulsante «È normale», (b) la scheda «Con chi parla» dentro l'host, (c) la riga di stato dei collector con copertura e ultimo contatto, (d) la riga «in apprendimento fino al …» per rete. Si scrive dopo il suo sì.
2. Pagina `src/app/(dashboard)/traffico/page.tsx` (la cartella vera si legge da dove sta `/segmentazione`: `rg -l "segmentazione" src/app --glob "page.tsx"`), voce di menù accanto a «Segmentazione», scheda nell'host, gestione dei collector in Opzioni.
3. Gravità: tre livelli con forma diversa (cerchio vuoto, triangolo, triangolo pieno) e luminosità diversa, col testo accanto.

**Verifica:** `npx tsc --noEmit` e `npm run lint` verdi; **una** schermata a 1920 della pagina `/traffico` coi dati del banco.

**Commit:** `Traffico: pagina delle anomalie e scheda dell'host`, poi rilascio (vedi vincoli).

---

### [ ] Task 6 — Nomi e controlli sul contenuto

**Dipende da:** Task 2 (banco) e Task 4.

**File**
- Crea: `collector-traffico/collector/ascolto.py`, `collector-traffico/collector/controlli.py`, `collector-traffico/tests/test_controlli.py`, `collector-traffico/collector-ascolto.service`
- Modifica: `collector-traffico/collector/archivio.py`, `collector-traffico/collector/api.py`, `src/lib/traffico/schema.ts`, `src/lib/traffico/lettura.ts`, `src/lib/traffico/anomalie.ts`

**Cosa fare**

`ascolto.py` lancia `tcpdump -i $MIRROR_IF -U -s 256 -w - '<filtro>'` e legge il flusso pcap dallo stdout con `struct` (niente scapy). Il filtro lo applica il kernel:

```
port 21 or port 23 or port 25 or port 110 or port 143 or port 389 or port 80 or port 445
or port 502 or port 102 or udp port 53 or udp port 161 or udp port 5355 or udp port 137
or (tcp[((tcp[12:1] & 0xf0) >> 2):1] = 0x16)
```

più la stessa espressione dietro `vlan` (caso 1). Se sul banco le porte 80 e 445 portano troppo carico, si restringono ai pacchetti con dati dei primi scambi (`tcp[13] & 8 != 0`) e lo si scrive nel README.

`controlli.py`, funzioni pure su `(proto, porta, carico: bytes)`, **prove prima del codice** con pacchetti veri catturati sul banco:

| `tipo` | Scatta quando |
|---|---|
| `chiaro_telnet` | dati sulla 23 |
| `chiaro_ftp` | riga `PASS ` sulla 21 |
| `chiaro_posta` | `USER `/`PASS ` sulla 110, `LOGIN ` sulla 143, `AUTH PLAIN`/`AUTH LOGIN` sulla 25 |
| `chiaro_http_basic` | intestazione `Authorization: Basic` sulla 80 |
| `chiaro_ldap` | bind semplice (scelta 0 dell'autenticazione) sulla 389 con password non vuota |
| `snmp_vecchio` | versione 0 o 1; `dettaglio.comunita_nota = true` se è `public` o `private`, il valore non si salva |
| `smb1` | negoziazione con firma `\xffSMB` |
| `tls_vecchio` | saluto del client con versione massima 1.0 o meno |
| `ntlm1` | risposta NTLM lunga 24 byte |
| `nome_conteso` | risposta LLMNR o NetBIOS da un IP diverso da chi ha già risposto per quel nome |
| `impianto_scrittura` | Modbus con funzione 5, 6, 15 o 16; S7 con funzione di scrittura |
| `dns_anomalo` | nome più lungo di 100 caratteri, o più di 1000 richieste in 300 secondi dallo stesso host |

Dal DNS e dal saluto TLS si tengono anche i nomi: tabella `nome(seq, visto, client, tipo 'dns'|'sni', nome, conteggio)`, al più 200 nomi diversi per host al giorno.

Tabella `fatto(seq, visto, tipo, client, server, porta, dettaglio)` e rotte `GET /v1/fatti?dopo=&limite=` e `GET /v1/nomi?dopo=&limite=`, stessa forma di `/v1/coppie`. Lo stesso fatto fra gli stessi due host si scrive una volta l'ora.

IPAM: `traffico_controlli(network_id, tipo, acceso)` (assente = acceso), lettura dei fatti con `cursore_fatti`, un'anomalia per fatto con `tipo` uguale e gravità 3 (2 per `tls_vecchio` e `snmp_vecchio`), senza apprendimento. `impianto_scrittura` scatta solo se la coppia non è un'abitudine confermata. I nomi si mostrano nel dettaglio dell'anomalia e nella scheda dell'host.

Secondo gruppo (protocollo riconosciuto su qualunque porta): **solo la misura**. Si aggiunge al filtro il primo pacchetto con dati di ogni connessione, si rifà la prova a 200 Mbit/s e si scrive il costo nel README. Non si accende senza il sì di Riccardo.

**Verifica:** `python3 -m pytest collector-traffico/tests` verde. Sul banco: un accesso FTP in chiaro verso `sim-server` genera l'anomalia `chiaro_ftp` in IPAM, e `grep -r <password di prova> /var/lib/collector-traffico /var/log` sulla VM non trova niente.

**Commit:** `Traffico: nomi DNS e TLS, controlli sul contenuto`, poi rilascio.

---

### [ ] Task 7 — NetFlow e sFlow

**Dipende da:** Task 1.

**Cosa fare:** `nfacctd.conf` (UDP 2055) e `sfacctd.conf` (UDP 6343) con lo stesso `aggregate` e la stessa cartella `in/`, due servizi systemd spenti di serie, `FLUSSI=netflow|sflow|no` nell'env. `piega.py` non cambia. Le righe portano `fonte` (`mirror`, `netflow`, `sflow`): colonna nuova in `coppia` e in `traffico_coppie`, perché i flussi campionati non si sommano al mirror dello stesso tratto (stessa regola del caso 4). Nel README: come accendere l'esportazione su uno switch e su un firewall che Domarc usa davvero, chiesti a Riccardo.

**Verifica:** `python3 -m pytest collector-traffico/tests` verde con un file di esempio di `nfacctd`. Un apparato vero della rete Domarc esporta verso `collector-banco` e le sue coppie compaiono in IPAM con `fonte = netflow` o `sflow`.

**Commit:** `Traffico: NetFlow e sFlow come seconda sorgente`

---

## Registro

- **20/11, Task 1 fatto.** Scostamenti: (a) le prove sono `unittest` della libreria standard, non pytest (sul Mac non è installato; il vincolo «solo libreria standard» resta intero); (b) multicast e broadcast diventano `diffusione` invece di `esterno`, altrimenti ogni host con mDNS o SSDP sembrerebbe uscire verso internet e al Task 4 ogni impianto darebbe l'anomalia; (c) alle reti interne di serie si aggiungono `fc00::/7` e `fe80::/10` (IPv6 locale); (d) `MIRROR_DOPPIO=1` è già nel servizio (caso 2), la misura resta al Task 2; (e) la scheda in mirror parte con ARP e IPv6 spenti, perché Linux su una scheda accesa senza indirizzo manda comunque gli annunci IPv6. **Da verificare sulla VM al Task 2**: i nomi delle chiavi di `pmacctd.conf` (`files_umask`, `print_output_file` con l'ora nel nome) e che l'ora nel nome sia la chiusura della finestra.

## Consuntivo
### Fatto
### Mancante
### Scostamenti dal piano
### Consigli di sviluppo
