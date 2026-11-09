# Estrazione di apparati dal PC del tecnico — analisi (09/11/2026)

> **Solo riferimento, non blocca niente.** Decisione di Riccardo (09/11/2026): «mi basta un prompt da dare al claude code con le
> modalità con cui scrivere i json, poi verrà inserito nel pacchetto completo di da-ipam». Il prompt autosufficiente è in
> [`2026-11-09-prompt-tecnico-estrazione.md`](2026-11-09-prompt-tecnico-estrazione.md); le domande D1-D11 restano qui come
> appunti per quando il prompt entrerà nel pacchetto.

> **Richiesta di Riccardo (09/11/2026):** «vorrei che venisse preparato un prompt da dare a Claude Code nei PC dei tecnici per
> acquisire un formato di json in grado di essere digerito da DA-IPAM, per consentire di estendere la copertura delle tipologie
> di prodotti con ulteriori analisi. Il sistema dovrebbe prevedere un motore di collegamento ssh, snmp o web/api a device per
> creare un file standard di estrazione delle info, principalmente switch o router. Il lavoro verrà gestito localmente dal
> Claude Code del tecnico.»
>
> Solo analisi: nessun codice. Il prompt per il tecnico è in
> [`2026-11-09-prompt-tecnico-estrazione.md`](2026-11-09-prompt-tecnico-estrazione.md). Le decisioni aperte sono in fondo,
> §7. **Il vincolo dei dati verso il modello (§6) va deciso prima di tutto il resto.**

## In una riga

Il formato standard **c'è già**: è lo snapshot JSON 1.0 dei collector (`src/lib/acquisition/schema.ts`). Lo producono già
undici famiglie e l'app lo digerisce in un percorso solo: archivio, proiezioni sull'apparato e strato «parser» della Mappa
porte. Quindi la proposta non inventa un formato nuovo. Gli aggiunge:
- una busta con la provenienza;
- due sezioni opzionali, `routes` e `config`;
- un ingresso per l'import.

Il parser che il tecnico scrive per un vendor nuovo è un collector come gli altri, su un ramo, e torna nel prodotto con una PR.

## 1. Cosa DA-IPAM sa già leggere oggi per switch e router

### 1.1 Due strade di lettura

| Strada | Dove | Cosa scrive | Nota |
| --- | --- | --- | --- |
| **Giro SNMP «di sempre»** | `src/lib/devices/` (es. `router-client.ts` per ARP e rotte), profili SNMP per vendor, MIB standard (IF-MIB, Q-BRIDGE, BRIDGE, LLDP, ENTITY) | `switch_ports`, `arp_entries`, `routing_table`, `device_neighbors` | `switch_ports` e `arp_entries` **si riscrivono a ogni giro**: l'ultimo lettore cancella gli altri |
| **Collector modulari (parser)** | `src/lib/acquisition/` | lo snapshot JSON 1.0, poi le proiezioni | spenti di serie: interruttore `acquisizione_modulare.attiva` e lettura `mappa_dati` |

### 1.2 Collector che esistono (`src/lib/acquisition/catalogo.ts`, l'unico elenco)

Le famiglie di rete:

- `qnap-switch`: console QSS.
- `hp-procurve`: anche 5406R zl2 modulare.
- `hp-comware`: anche IRF.
- `aruba-cx`.
- `mikrotik-routeros`: `/… print terse`, comprese rotte, bridge, VLAN e bonding.
- `stormshield-sns`: FreeBSD, `ifconfig` e `arp`. **Non collaudato**: sull'hub l'SSH è rifiutato.
- `proxmox-ve`, letto come switch: FDB da `bridge -j fdb show dynamic`, VLAN da `bridge -j -c vlan show`, ARP da `ip -j neigh`.
- `unifi-controller`.
- `ubiquiti-device`.

Il resto non è di rete: NAS, Linux, Windows, ESXi/vSphere, ONTAP, Infoblox. Le allowlist dei comandi stanno in
`src/lib/acquisition/comandi.ts`: **solo letture**, nessuna configurazione, nessun comando che arrivi dall'input.

Come entra una famiglia nuova è già scritto in `docs/modules/acquisition.md` §«Aggiungere una famiglia», in nove passi:
- catalogo, comandi e parser puri;
- il collector, poi `index.ts`;
- la fixture anonima in `__tests__/contratto-fixture.ts`;
- le prove gratis di `contratto.test.ts`;
- il manuale.

**La proposta riusa esattamente questa strada.**

Esempio di switch senza collector: lo Zyxel GS1900 si legge con l'SNMP di sempre (manuale, §«Switch senza collector»).
Mostra il caso che il tecnico coprirebbe: dati che le MIB standard non danno, come il PoE e la radice STP.

### 1.3 Dove finisce lo snapshot

1. **Archivio**: `acquisition_snapshots` (`acquisizione-modulare/archivio.ts`), gzip, validato, senza segreti
   (`contieneSegreto`), con conservazione D5.
2. **Proiezioni sull'apparato** (`acquisition/proiezioni/index.ts` puro, `acquisizione-modulare/applica.ts` in una transazione):
   - identità → `network_devices`;
   - interfacce, PVID, PoE e STP → `switch_ports`, campo per campo;
   - vicini → `device_neighbors` con fonte `collector`;
   - STP e LAG → `topology_port_facts`.

   Ogni modifica finisce in `acquisition_changes`.
3. **Mappa porte, strato «parser»** (`mappa-porte/parser.ts`, `dalloSnapshot`):
   - `forwarding` → MAC per porta;
   - `network.arp` → ARP;
   - `neighbors` → vicini;
   - `vlans` → matrice VLAN;
   - `interfaces` e `poe` → `mappa_porte_fonti` con `fonte = "parser"`.

   Una sezione `unsupported` o `error` vale «non so», non «vuoto».
4. **Registri stabili** (`mappa-porte/calcolo.ts`, `aggiornaRegistri`):
   - `mappa_porte_visti` accumula da `arp_entries`;
   - `mappa_porte_rotte` accumula da `routing_table`.

   Un giro vuoto non cancella, e le righe restano un anno.

**Trappola da rispettare** (CONTEXT §«Mappa porte»): `is_uplink` in `switch_ports` non si tocca. L'import non deve scriverlo.

### 1.4 Fingerprint e classificazione

- `acquisition/riconosci.ts` (puro) sceglie il collector da profilo, sottotipo e sysDescr.
- `device-classifier.ts`, `device-fingerprint-classification.ts` e `device-vendor-infer.ts` danno la classe dell'apparato.

Per l'import conta solo che l'apparato esista nel profilo e abbia una classe con porte (`FAMIGLIE_CON_PORTE` nel catalogo).

### 1.5 Cosa manca allo snapshot per switch e router

- **Rotte**: lo snapshot non ha una sezione `routes`. Oggi le rotte arrivano solo dal giro SNMP del router (`routing_table`)
  e da MikroTik attraverso l'app di sempre.
- **Configurazione grezza**: nessuna sezione, ed è voluto. La config contiene segreti: hash, community, PSK.
- **Provenienza per comando**: `sources` per sezione c'è già (es. `["display mac-address"]`). Mancano l'esito e l'ora del
  singolo comando.
- **Collector ignoto**: `collector` è un enum del catalogo. Uno snapshot nato da un parser che il prodotto non ha ancora non
  passa la validazione.

## 2. Il formato JSON standard d'estrazione

### 2.1 Scelta: busta + snapshot 1.0, non un formato nuovo

```
estrazione (busta, formato "da-ipam-estrazione" 1.0)
├── provenienza: chi, quando, con quale parser, su quale apparato
├── comandi[]: ogni comando lanciato, protocollo, esito, ora, byte (MAI l'output)
└── snapshot: AcquisitionSnapshot 1.0, identico a quello dei collector
    (identity, interfaces, vlans, forwarding, neighbors, network.arp,
     spanning_tree, aggregation, poe, sensors, + routes e config, nuove e opzionali)
```

Perché così:
- l'import riusa `salvaSnapshot`, `applicaSnapshot` e `dalloSnapshot` senza un adattatore per marca;
- un parser nato dal tecnico, quando entra nel prodotto, produce lo stesso snapshot senza la busta.

### 2.2 Aggiunte allo schema, tutte opzionali (`schema_version` resta `1.0`)

| Aggiunta | Forma | Dove va all'import |
| --- | --- | --- |
| `routes` | `section(array({ destination, prefix_len, gateway, interface, protocol, metric, distance, active, vrf }))` | `routing_table` dell'apparato, poi `mappa_porte_rotte` lo accumula. Vedi la domanda D7 |
| `config` | `section({ format: "text"\|"json", redacted: true, sha256, bytes, text })` | solo archivio (`acquisition_snapshots`), mai proiettata. **Spenta di serie**, vedi D5 |
| `collector` libero | nella busta `origine: "tecnico"` lo snapshot si valida con `collector: string` (`^[a-z0-9-]{3,40}$`) invece dell'enum | `acquisition_snapshots.collector` è già `TEXT`. Le funzioni che chiamano `descrittore(collector)` (scheda, fonte) vanno protette per l'id sconosciuto |

### 2.3 Regole che il formato eredita (manuale §«Contratto JSON 1.0»)

- `null` = ignoto: mai 0, `false` o lista vuota al suo posto.
- Ogni sezione ha `status` fra `ok`, `partial`, `unsupported`, `error` e `skipped`, più `collected_at`, `sources` e
  `warnings`, questi ultimi con codici stabili.
- Contatori come stringhe decimali; velocità in bit/s.
- `if_index`, bridge port e nome di console sono identificatori diversi, e non si confondono.
- Una sezione che l'apparato non ha è `unsupported`/`skipped`, non assente.

### 2.4 Esempio (dati inventati: IP di documentazione, MAC `02:00:00:…`)

```json
{
  "formato": "da-ipam-estrazione",
  "versione": "1.0",
  "origine": "tecnico",
  "provenienza": {
    "generato_il": "2026-11-09T10:15:02Z",
    "strumento": "scripts/estrai-apparato.ts",
    "parser": { "id": "zyxel-xgs-cli", "versione": "0.1.0", "ramo": "tecnico/zyxel-xgs", "commit": "abc1234" },
    "apparato": { "device_id": 42, "host": "192.0.2.10" },
    "profilo": "codice-profilo-locale"
  },
  "comandi": [
    { "id": "c1", "protocollo": "ssh", "comando": "show version", "esito": "ok", "letto_il": "2026-11-09T10:14:51Z", "byte": 812 },
    { "id": "c2", "protocollo": "ssh", "comando": "show mac address-table", "esito": "ok", "letto_il": "2026-11-09T10:14:53Z", "byte": 20431 },
    { "id": "c3", "protocollo": "snmp", "comando": "walk 1.3.6.1.2.1.105", "esito": "unsupported", "letto_il": "2026-11-09T10:14:58Z", "byte": 0 }
  ],
  "snapshot": {
    "schema_version": "1.0",
    "collector": "zyxel-xgs-cli",
    "collector_version": "0.1.0",
    "target": "192.0.2.10",
    "collected_at": "2026-11-09T10:14:50Z",
    "duration_ms": 11800,
    "status": "partial",
    "identity": { "status": "ok", "collected_at": "2026-11-09T10:14:51Z", "sources": ["show version"], "warnings": [],
      "data": { "manufacturer": "Zyxel", "model": "XGS2220-30HP", "firmware": "V4.80", "serial_number": "S000000000001",
                "hostname": "SW-01", "mac": "02:00:00:00:00:01", "sys_object_id": null, "uptime_seconds": 864000 } },
    "interfaces": { "status": "ok", "collected_at": "2026-11-09T10:14:52Z", "sources": ["show interfaces status"], "warnings": [],
      "data": [ { "name": "1", "if_index": 1, "description": null, "kind": "physical", "admin_status": "up", "oper_status": "up",
                  "speed_bps": 1000000000, "reported_speed_bps": 1000000000, "duplex": "full", "mtu": 1518,
                  "mac": null, "counters": {}, "pvid": 10 } ] },
    "vlans": { "status": "ok", "collected_at": "2026-11-09T10:14:52Z", "sources": ["show vlan"], "warnings": [],
      "data": [ { "id": 10, "name": "UFFICI", "tagged_ports": ["25"], "untagged_ports": ["1"], "forbidden_ports": [] } ] },
    "forwarding": { "status": "ok", "collected_at": "2026-11-09T10:14:53Z", "sources": ["show mac address-table"], "warnings": [],
      "data": [ { "mac": "02:00:00:00:10:01", "vlan_id": 10, "fdb_id": null, "bridge_port": null, "if_index": 1, "port": "1", "status": "learned" } ] },
    "neighbors": { "status": "ok", "collected_at": "2026-11-09T10:14:54Z", "sources": ["show lldp info remote"], "warnings": [],
      "data": [ { "local_port": "25", "remote_chassis": "02:00:00:00:00:02", "remote_port": "Gi1/0/48", "system_name": "CORE-01",
                  "system_description": null, "management_addresses": ["192.0.2.1"], "capabilities": ["bridge"], "ttl_seconds": 120 } ] },
    "network": { "status": "ok", "collected_at": "2026-11-09T10:14:55Z", "sources": ["show ip arp"], "warnings": [],
      "data": { "ipv4_addresses": [ { "address": "192.0.2.10", "netmask": "255.255.255.0", "if_index": null } ],
                "arp": [ { "address": "192.0.2.1", "mac": "02:00:00:00:00:02", "if_index": null, "type": "dynamic" } ] } },
    "routes": { "status": "ok", "collected_at": "2026-11-09T10:14:56Z", "sources": ["show ip route"], "warnings": [],
      "data": [ { "destination": "0.0.0.0", "prefix_len": 0, "gateway": "192.0.2.1", "interface": "vlan10", "protocol": "static",
                  "metric": null, "distance": 1, "active": true, "vrf": null } ] },
    "spanning_tree": { "status": "unsupported", "collected_at": "2026-11-09T10:14:57Z", "sources": ["show spanning-tree"], "warnings": ["CMD_UNSUPPORTED"],
      "data": { "enabled": null, "protocol": null, "ports": [] } },
    "aggregation": { "status": "ok", "collected_at": "2026-11-09T10:14:57Z", "sources": ["show lacp"], "warnings": [], "data": [] },
    "poe": { "status": "ok", "collected_at": "2026-11-09T10:14:57Z", "sources": ["show poe status"], "warnings": [],
      "data": [ { "port": "1", "enabled": true, "status": "delivering", "power_watts": 4.2 } ] },
    "sensors": { "status": "skipped", "collected_at": "2026-11-09T10:14:58Z", "sources": [], "warnings": ["NOT_IMPLEMENTED"], "data": [] }
  }
}
```

Lo schema JSON completo dello snapshot si genera già con `node --import tsx scripts/acquire-device.ts --schema`. Quello
della busta sarà un `z.object` di poche righe accanto, esportato dallo stesso `--schema`. Il JSON Schema non va ricopiato
in un documento: invecchierebbe.

## 3. Il motore di collegamento sul PC del tecnico

### 3.1 Dove vive

Dentro l'installazione «tecnico» di DA-IPAM (ADR 0037), come **script del repo**, non come programma a parte. I trasporti
ci sono già:
- `acquisition/transports.ts`: SSH in modalità console, `exec` ed `exec_per_comando`;
- `protocols/snmp-sessione.ts`: SNMP v1/v2c/v3;
- i trasporti HTTPS di vSphere, ONTAP e Infoblox, modello per un trasporto HTTP generico.

Due script, perché il modello non deve mai vedere i dati veri (§6):

| Script | Cosa fa | Cosa stampa (cioè cosa vede Claude) |
| --- | --- | --- |
| `scripts/raccogli-grezzo.ts --device <id> --collector <id>` | gira nel contesto del profilo attivo (`withTenant`). Legge le credenziali dell'apparato dal profilo con `credentials/resolve.ts`, nel backend, col budget anti-lockout. Lancia **solo** l'allowlist del collector e salva gli output grezzi nella cartella privata del profilo, sul volume cifrato | solo un resoconto: comando, esito, byte. Mai output, mai credenziali |
| `scripts/anonimizza-grezzo.ts <cartella>` | produce il **campione anonimo**: IP, MAC, nomi, seriali, utenti, descrizioni e community sostituiti in modo coerente. Tiene la tabella delle corrispondenze nella cartella privata | il percorso del campione e il numero di sostituzioni per tipo |
| `scripts/estrai-apparato.ts --device <id> --collector <id>` | rilancia la raccolta, oppure riusa il grezzo, e applica il parser sui **dati veri**. Valida con `snapshotSchema` e scrive la busta JSON nella cartella privata | solo il riepilogo: stato per sezione, righe per sezione, codici d'avviso. Mai valori |

- La cartella privata sta sotto la data dir del profilo (`src/lib/data-dir.ts`), non nel repo. Su Mac sta su FileVault, su
  Debian sotto LUKS: è la cifratura già imposta da `server.ts` con `isTecnico()`.
- Gli script esistono solo con `isTecnico()`. Su un'appliance escono con un messaggio.
- `scripts/acquire-device.ts` resta com'è: è la CLI con le credenziali da file, utile al collaudo.

### 3.2 Come Claude Code lo usa per un vendor nuovo

1. Il tecnico registra l'apparato nel profilo, con la credenziale (SSH, SNMP o API), dall'interfaccia. **Claude non vede le
   credenziali.**
2. Claude crea un ramo `tecnico/<vendor>-<famiglia>` nel clone locale. Aggiunge la voce di catalogo `non_collaudato`, con
   la versione `0.1.0` e un'**allowlist proposta** di comandi di sola lettura (§3.3), presa dalla documentazione pubblica
   del vendor.
3. Il tecnico lancia `raccogli-grezzo` e poi `anonimizza-grezzo`. Oppure li lancia Claude, ma lo stdout non contiene dati.
4. Claude legge **solo il campione anonimo**. Scrive il parser puro `<famiglia>-parsers.ts` e il collector. Mette il
   campione come fixture in `contratto-fixture.ts` e scrive i test del parser.
5. Lancia `node --import tsx --test` sui file toccati: secondi, REGOLA #3.
6. Il tecnico, o Claude, lancia `estrai-apparato`: il parser gira sui dati veri, in locale. Claude vede solo il riepilogo.
   Se una sezione è `error` o `partial`, il codice d'avviso dice dove guardare. Il tecnico rianonimizza un pezzo in più, e
   si ripete dal passo 4.
7. Il tecnico importa la busta in DA-IPAM (§4) e guarda la scheda e la Mappa porte.
8. PR verso `dev` (§4.3).

### 3.3 Comandi ammessi: solo lettura

**Freno nel codice, non nel prompt** (lezione 16 di `~/.claude/AGENTS.md`). Il trasporto rifiuta ciò che non passa due
filtri indipendenti:
- l'allowlist del collector, nel catalogo;
- una lista di verbi vietati, globale, nel trasporto. Una prova fa fallire il catalogo se un'allowlist contiene un verbo
  vietato.

Il freno più forte resta un **utente in sola lettura sull'apparato**:
- Cisco: privilege 1, o un `role` di lettura;
- Comware: `network-operator`;
- RouterOS: gruppo `read`;
- FortiOS: profilo `read-only`;
- SNMP: v3 senza vista di scrittura.

| Protocollo | Ammesso | Vietato, sempre |
| --- | --- | --- |
| SSH, CLI | `show …`, `display …` (Comware, Huawei), `get system …` e `get router info …` (FortiOS), `/… print` (RouterOS), `show … \| display json` (Junos). Per la paginazione della sola sessione: `terminal length 0`, `screen-length disable` in vista utente, `no page`, `terminal pager 0`, `set cli screen-length 0` in modalità operativa Junos | `configure`, `conf t`, `system-view`, `edit`, `set` (fuori dalla paginazione Junos), `unset`, `delete`, `commit`, `write`, `save`, `copy`, `erase`, `format`, `reload`, `reboot`, `shutdown`, `clear`, `debug`, `undebug`, `execute`, `diagnose` (salvo voci di sola lettura messe una per una nell'allowlist), `request`, `test`, `ping`, `traceroute`, `terminal monitor`, `/system reset`, `/export` e `show running-config` (vedi D5), `enable`/`su`/`sudo` |
| SNMP | GET, GETNEXT, GETBULK (walk), v2c o v3 (authPriv consigliato) | SET, sempre. Nessuna community di scrittura nel profilo |
| HTTP/API | `GET` sugli endpoint dell'allowlist. `POST` solo sull'endpoint di login o token, nominato nel catalogo | `PUT`, `PATCH`, `DELETE`, ogni `POST` diverso dal login, l'upload di file, gli endpoint di backup o di export della config |

Limiti di serie dello schema: 4 s per comando, 90 s in tutto, 1 MB di output, 4096 righe. **Un tentativo solo**: un errore o
un parziale non fanno provare altre credenziali (il blocco degli account dopo pochi login è già successo: UniFi 429).

## 4. Import in DA-IPAM

### 4.1 Ingresso

- **API** `POST /api/devices/[id]/acquisizione/importa`, con `requireAdmin()` come prima riga e `withTenantFromSession()`.
  Corpo: la busta JSON, al massimo 4 MB, la stessa soglia dell'output.
- **Interfaccia**: nella scheda dell'apparato, tab Gestione, riquadro «Acquisizione» che esiste già, un pulsante
  «Importa estrazione». Mostra l'esito sezione per sezione con `sezioniPerScheda`, che esiste già. Mattoni di `console.tsx`,
  `docs/STILE-UI.md`. Testo e layout si propongono oggetto per oggetto prima di scriverli.

### 4.2 Cosa fa, in quest'ordine

1. `JSON.parse` in try-catch, poi la busta con Zod, poi lo snapshot con `snapshotSchema` (variante con collector libero se
   `origine: "tecnico"`). Gli errori si mostrano con le `.issues` di Zod.
2. **Controllo d'identità**: il seriale o il MAC della busta devono coincidere con l'apparato `[id]`, se l'apparato li ha.
   Altrimenti si risponde 409 con «l'estrazione è di un altro apparato?».
3. `contieneSegreto` sullo snapshot, con le credenziali dell'apparato: un segreto trovato fa rifiutare tutto, senza dire quale.
4. `salvaSnapshot(deviceId, snapshot, { trigger: "import_tecnico", … })`. La busta senza lo snapshot va in un campo
   accanto, oppure si salva intera: da decidere in fase di piano.
5. `applicaSnapshot` (proiezioni) e strato `parser` della Mappa porte (`dalloSnapshot`). Sono le **stesse funzioni** del
   giro dei parser: nessuna regola per marca, e `is_uplink` resta intatto.
6. `routes`, se `ok` o `partial`: in `routing_table` per quell'apparato, in transazione (DELETE+INSERT, regola 7). Vedi D7.

È un percorso della zona **gialla** (interfaccia hub↔dati, migrazioni additive). L'import scrive dati dei clienti, quindi la
prova del prima e dopo si fa su un DB di prova, non sul profilo vero.

### 4.3 Come un parser nato dal tecnico torna nel prodotto

1. Sul ramo `tecnico/<vendor>-<famiglia>` ci sono:
   - la voce di catalogo con `collaudo: "collaudato"` e `collaudati: [{ modello, firmware }]` presi dall'apparato vero;
   - parser e collector;
   - la fixture anonima e i test del parser;
   - la sezione nel manuale `docs/modules/acquisition.md`.
2. **Controllo del campione prima del push**: `scripts/controlla-campione.ts` cerca nella fixture ogni valore vero della
   tabella delle corrispondenze. Gira in locale, perché la tabella è privata. Se ne trova uno, il push si ferma. È il gemello
   di `topology/__tests__/fixture-anonime.test.ts`.
3. Push del ramo e PR verso `dev`, **mai `main`**. Revisione di Riccardo, poi i passi soliti: `version:release --staged-only`
   e promote dall'interfaccia.
4. Da lì la famiglia è nel catalogo con il suo id: le appliance la leggono col giro dei parser, e la busta del tecnico non
   serve più.

## 5. Costi e lavoro, a grandi linee

| Pezzo | Stima | Nota |
| --- | --- | --- |
| Sezioni `routes` e `config`, collector libero nella busta | piccolo | additivo, `schema_version` resta 1.0 |
| Lista di verbi vietati nel trasporto, più la prova sul catalogo | piccolo | vale anche per i collector di oggi |
| Trasporto HTTP generico in sola lettura | medio | modello: i trasporti di ONTAP e vSphere |
| `raccogli-grezzo` ed `estrai-apparato` | medio | riusano `richiesta.ts` e `esegui.ts` |
| **Anonimizzatore del testo grezzo** | medio-grande | `topology/anonimizza.ts` lavora sul modello della topologia, non su testo libero. Le descrizioni di porta e i nomi di VLAN sono la parte difficile |
| Import (API e riquadro) | medio | tutto il resto c'è già |
| Freno di Claude Code sul PC (`permissions.deny` e hook `PreToolUse` sulla cartella privata) | piccolo | va nell'installer «tecnico» |

## 6. ⚠ Vincolo da decidere: i dati dei clienti verso un modello esterno

**Le regole.**
- `CLAUDE.md` e `AGENTS.md` di DA-IPAM, §Sicurezza: «Nessun payload con IP/hostname/utenti verso servizi AI esterni».
- `~/.claude/AGENTS.md`, regola 16: «dati di clienti solo su modelli interni (freno nel codice, non nel prompt)».

**Il fatto.** Claude Code è un modello esterno. L'output di `show mac address-table`, `show ip arp` o `show lldp neighbors`
è fatto quasi solo di IP, MAC, hostname e descrizioni scritte dal cliente. Se Claude lancia il comando via SSH dal suo Bash,
**l'output entra nel modello**. Il prompt da solo non basta a impedirlo.

La decisione è di Riccardo. Le alternative, con il loro costo:

| | Alternativa | Cosa vede il modello | Costo | Rischio residuo |
| --- | --- | --- | --- | --- |
| **A** | **Due mondi** (proposta di questo documento, §3): il motore locale gira sui dati veri, Claude scrive e prova il parser solo su campioni anonimizzati e vede solo riepiloghi | campioni anonimi, nomi dei comandi, codici d'avviso | anonimizzatore del testo (medio-grande), freno su Claude Code, un passaggio in più per il tecnico a ogni giro | l'anonimizzatore sbaglia su testo libero, per esempio il nome del cliente in una descrizione di porta. Mitigazioni: il tecnico guarda il campione prima di darlo a Claude, e `controlla-campione` prima del push |
| **B** | **L'anonimizzatore che esiste già** (`src/lib/topology/anonimizza.ts`), usato così com'è | il modello della topologia anonimo (IP, MAC e nomi sostituiti) | quasi zero | **non copre il caso**: lavora su dati già parsati, non sull'output grezzo da cui si scrive un parser. Serve solo a controllare il JSON finale. Utile come pezzo di A, non al suo posto |
| **C** | **Modello interno** sul PC o su un server Domarc, al posto di Claude Code o solo per i passi che toccano i dati | tutto, ma resta in casa | hardware o una VM con GPU; integrazione con lo strumento del tecnico; qualità più bassa nello scrivere parser e prove (da misurare in token e in esito, lezione 16) | basso sui dati; alto sulla qualità e quindi sul tempo dei tecnici |
| **D** | **Zero dati**: Claude scrive il parser solo dalla documentazione pubblica del vendor e da esempi pubblici. Il tecnico gira il motore e riporta solo codici d'errore | nessun dato del cliente | molti giri a vuoto sui formati reali (colonne, versioni di firmware) | nullo sui dati; il parser nasce fragile |
| **E** | **Deroga** alla regola: Claude Code col contratto commerciale (i dati non si usano per l'addestramento) e con limiti scritti, per esempio niente config e niente utenti | tutto quello che passa dal Bash | zero lavoro; una decisione contrattuale e di privacy, e il cliente andrebbe informato? | cambia una regola scritta del progetto: vale la lezione 12, la decide chi l'ha scritta |

**Raccomandazione tecnica**, non decisione: **A, con D come primo passo**. Claude parte dalla documentazione pubblica e
chiede il campione anonimo solo per ciò che non torna. Il freno sta nel codice: deny e hook su Claude Code, stdout degli
script senza dati, prova sul campione. Senza quel freno, A è solo una promessa del prompt.

## 7. Domande aperte per Riccardo (tutte insieme)

1. **D1, vincolo dei dati** (§6): A, B, C, D, E, o una combinazione? È la decisione che condiziona tutto il resto.
2. **D2, chi lancia i comandi**: solo il tecnico, con Claude che vede i riepiloghi, oppure anche Claude dal suo Bash,
   sempre attraverso gli script che non stampano dati? Il secondo è più comodo e più rischioso se il freno ha un buco.
3. **D3, permessi di Claude Code sul PC del tecnico**: l'installer «tecnico» può imporre in `~/.claude/settings.json` le
   regole `deny` e l'hook sulla cartella privata, e vietare `bypassPermissions`? O è una scelta del tecnico?
4. **D4, l'installazione «tecnico» gira dal sorgente** (clone git e `tsx`), come le appliance? Se è un pacchetto già
   costruito, Claude non può aggiungere un collector in locale e il flusso del §3.2 cambia.
5. **D5, configurazione grezza**: si estrae mai? Se sì, solo con le righe dei segreti tolte, o solo l'impronta `sha256` per
   accorgersi che è cambiata? La proposta è niente config, e `show running-config` e `/export` vietati.
6. **D6, apparato non registrato**: l'import accetta solo un apparato già nel profilo (proposta), o ne crea uno nuovo dalla
   busta (`crea-apparato.ts`)?
7. **D7, rotte**: un router letto sia dal giro SNMP sia dall'import ha due fonti che si riscrivono `routing_table` a
   vicenda. Si accetta, o le rotte dell'import vanno in uno strato proprio, come `mappa_porte_fonti` per le porte?
8. **D8, dove si importa**: solo sul PC del tecnico (`isTecnico()`), oppure anche sull'appliance del cliente e sul DA-IPAM
   centrale (ADR 0035), portando il JSON a mano?
9. **D9, chi apre la PR**: il Claude del tecnico, con un accesso GitHub suo, oppure il tecnico manda il ramo o un archivio
   e la PR la apre Riccardo? Il repo è pubblico.
10. **D10, utente in sola lettura sull'apparato**: è obbligatorio per usare il motore (proposta), con l'interfaccia che lo
    chiede alla registrazione della credenziale, o basta il freno nel codice?
11. **D11, priorità dei vendor**: quali famiglie per prime? Per esempio Cisco IOS/IOS-XE, FortiGate, Zyxel, Huawei,
    Juniper. Serve a scegliere il primo collaudo.
