# Compito

Ti colleghi a **uno switch o un router** e produci **un file JSON** con tutto ciò che riesci a leggere, nel formato qui sotto.
Il file verrà importato in DA-IPAM, l'inventario di rete di Domarc. I protocolli sono tre: SSH (CLI), SNMP (v2c o v3) e
web/API (HTTPS).

Ti dirò l'indirizzo dell'apparato, e il vendor e il modello se li so. Il resto lo scopri tu, in cinque fasi, nell'ordine.
Ti fermi solo dove la fase lo dice.

**Fase 1 — Riconoscere l'apparato e capire come si accede (internet).**
- Se non so il vendor o il modello, ricavali prima senza credenziali:
  - quali porte rispondono fra 22, 23, 80, 443, 161/udp e 8443, con `nc -z` o `nmap -sT -p` su quel solo indirizzo, mai su
    una rete intera;
  - il banner SSH;
  - il titolo della pagina web.
- Cerca su internet la documentazione **ufficiale** del vendor per quel modello e firmware, e le pagine pubbliche affidabili
  (manuali, riferimenti della CLI, MIB, riferimenti delle API). Ti servono quattro cose:
  - quali protocolli di gestione ha;
  - quale profilo o utente in sola lettura esiste;
  - con quali comandi, OID o endpoint si legge ciascuna sezione del §3;
  - come si toglie la paginazione nella sola sessione.
- **Nelle ricerche metti solo vendor, modello, firmware e nomi di comandi.** Mai l'IP, l'hostname, il seriale, il nome del
  cliente o pezzi di output dell'apparato.
- Dimmi in breve cosa hai trovato: il protocollo che consigli, il tipo di utente da usare e i link principali.

**Fase 2 — Chiedere le credenziali (senza che passino da te).**
- Scrivi lo script `imposta_credenziali.py` (§2). Poi chiedimi di lanciarlo **nel mio terminale**, non nel tuo, indicandomi
  il comando esatto. Mi chiede le credenziali a input nascosto e le salva in un file che tu non leggi.
- Chiedi credenziali **di sola lettura**, se l'apparato le prevede. Dimmi quale profilo creare sull'apparato, se non c'è,
  per esempio `network-operator`, `read-only` o SNMPv3 senza vista di scrittura.
- Aspetti che ti dica «fatto».

**Fase 3 — Provare l'accesso.**
- **Un login solo**, con un solo comando innocuo:
  - SSH: `show version`, o l'equivalente trovato nella fase 1;
  - SNMP: GET di `sysDescr.0` e `sysObjectID.0`;
  - API: il `GET` della versione o dello stato.
- Se riesce, mi dici vendor, modello e firmware letti. Se non tornano con la fase 1, ricontrolli la documentazione per quella
  versione.
- Se fallisce, **ti fermi**: niente secondo tentativo, niente varianti di utente, porta o protocollo. Molti apparati bloccano
  l'utente dopo pochi errori. Mi dici l'errore esatto (rifiutato, timeout, chiave host, cifrario) e cosa propone la
  documentazione.

**Fase 4 — Piano di lettura, poi lettura.**
- Fai una tabella: per ogni sezione del §3, il comando, l'OID o l'endpoint che la legge, preso dalla documentazione, e il link.
  Le sezioni senza un modo di leggerle restano `unsupported` o `skipped`.
- Ogni voce deve stare fra quelli ammessi del §1. Una voce che non ci sta **non si lancia**: me la segnali e prosegui con le
  altre.
- Scrivi lo script `<collector>.py` (Python 3, libreria standard più `paramiko`, `pysnmp` o `requests` se sono già installati).
  Lo script:
  - carica le credenziali dal file della fase 2;
  - lancia i comandi del piano uno alla volta;
  - salva gli output grezzi;
  - costruisce il JSON.
- Se un comando ha un formato diverso da quello della documentazione, guarda l'output grezzo salvato e adatta il parser.
  Non rilanciare comandi a caso.

**Fase 5 — Controllo e consegna.** Controllo del §5, nome e cartella del §4, resoconto del §6.

Se un dato si legge solo con un comando che non è fra quelli ammessi, **non lanciarlo**: scrivimelo.

# 1. Solo lettura: comandi ammessi e vietati

**Ammessi.**

| Protocollo | Comandi |
| --- | --- |
| SSH, CLI | `show …` (Cisco, Aruba, ProCurve, Zyxel, Juniper con `\| display json`), `display …` (HPE Comware, Huawei), `get system …` e `get router info …` (FortiOS), `/… print terse without-paging` (MikroTik RouterOS) |
| Paginazione della sola sessione | `terminal length 0`, `screen-length disable` (in vista utente, non in `system-view`), `no page`, `terminal pager 0`, `set cli screen-length 0` (Junos, modalità operativa) |
| SNMP | solo GET, GETNEXT, GETBULK (walk). Preferisci le MIB standard: IF-MIB, ENTITY-MIB, BRIDGE-MIB, Q-BRIDGE-MIB, LLDP-MIB, IP-MIB, IP-FORWARD-MIB, POWER-ETHERNET-MIB |
| Web/API | solo `GET`. `POST` solo per ottenere il token di login |

**Vietati sempre**, anche dentro un altro comando, anche «solo per provare»:
- **modifica della configurazione:** `configure`, `conf t`, `system-view`, `edit`, `set` (fuori dalla paginazione Junos), `unset`, `delete`, `commit`, `write`, `save`, `copy`;
- **riavvio, spegnimento, cancellazione:** `erase`, `format`, `reload`, `reboot`, `shutdown`;
- **azioni sull'apparato o sulla rete:** `clear`, `debug`, `undebug`, `execute`, `diagnose`, `request`, `test`, `ping`, `traceroute`, `terminal monitor`;
- **cambio di privilegi:** `enable`, `su`, `sudo`;
- **reset ed esportazione della configurazione:** `/system reset`, `/export`, `show running-config`, `show startup-config`, `show configuration`;
- **SNMP SET**, sempre;
- **HTTP:** `PUT`, `PATCH`, `DELETE`, ogni `POST` che non sia il login, gli endpoint di backup, export o upload.

Un comando alla volta, con un timeout di 10 secondi. **Un solo tentativo di login**: se fallisce, ti fermi e me lo dici.
Diversi apparati bloccano l'utente dopo pochi errori.

Se due comandi di fila falliscono e la causa non è chiara, fermati e chiedimi.

# 2. Credenziali: mai nel file, mai a schermo

- Le credenziali si chiedono con lo script `imposta_credenziali.py`, che scrivi tu e lancio io nel **mio** terminale (non
  nel tuo, non col prefisso `!` di Claude Code: finirebbero nella conversazione). Lo script:
  - chiede ogni valore con `getpass`, a input nascosto;
  - scrive `~/DA-IPAM-estrazioni/.credenziali/<host>.env` nella forma `CHIAVE=valore`, con la cartella a `700` e il file a
    `600`;
  - stampa solo «salvato: <percorso>».
- **Tu quel file non lo leggi mai**: niente `cat`, `grep`, `head` o lettura con lo strumento dei file. Lo carica solo lo
  script di lettura. Le chiavi sono queste:
  - `DEV_HOST`, `DEV_PROTO` (`ssh`, `snmp` o `api`);
  - per SSH: `SSH_USER`, `SSH_PASSWORD` o `SSH_KEY_FILE`;
  - per SNMP v2c: `SNMP_COMMUNITY`;
  - per SNMP v3: `SNMP_V3_USER`, `SNMP_V3_AUTH_PROTO`, `SNMP_V3_AUTH_KEY`, `SNMP_V3_PRIV_PROTO`, `SNMP_V3_PRIV_KEY`;
  - per l'API: `API_USER` e `API_PASSWORD`, oppure `API_TOKEN`.
- Lo script di lettura le legge solo da lì. **Non stamparle mai, non scriverle nei log, nel JSON o nei nomi dei file**, e
  non passarle come argomento sulla riga di comando: si vedrebbero in `ps`.
- Non chiedermele in chat. Se te le scrivo lo stesso, non ripeterle e non usarle: dimmi di cambiarle, perché ormai sono nella
  conversazione, e di rifare la fase 2. Non cercarle in altri file, portachiavi o database.
- Prima di consegnare, il controllo del punto 5 cerca nel JSON ogni credenziale del file: se ne trova una, il file non si
  consegna.
- **Non salvare mai la configurazione dell'apparato**: contiene password, hash, community e chiavi.

# 3. Il formato JSON

Un file = un apparato = un oggetto con la **busta** e lo **snapshot**. Regole che valgono ovunque:

- **`null` vuol dire «non lo so».** Mai 0, `false`, `""` o una lista vuota al posto di un dato non letto. Zero e `false`
  sono dati veri.
- Le **date** sono ISO 8601 in UTC con la `Z` finale, per esempio `2026-11-09T10:14:51Z`. Niente `+01:00`.
- **Velocità** in bit al secondo. **Contatori** di byte e pacchetti come stringhe di sole cifre, per esempio `"18446744073709551615"`.
- **MAC** in minuscolo con i due punti: `aa:bb:cc:dd:ee:ff`.
- `if_index` (SNMP), bridge port e nome di porta della CLI sono identificatori diversi: non ricavarne uno dall'altro senza una
  lettura che li colleghi.
- Ogni sezione ha uno `status`:
  - `ok`: letta;
  - `partial`: letta in parte, con il motivo in `warnings`;
  - `unsupported`: l'apparato ha rifiutato il comando o l'OID. Un walk vuoto non lo dimostra;
  - `error`: la lettura si è guastata;
  - `skipped`: non l'hai letta.

  **Tutte le sezioni obbligatorie ci sono sempre**, anche quando non sono state lette. In quel caso hanno lo `status` giusto
  e `data` vuoto nella forma prevista.
- `sources` contiene i comandi, gli OID o gli endpoint che hanno prodotto la sezione. `warnings` contiene codici brevi in
  maiuscolo, per esempio `CMD_UNSUPPORTED`, `TIMEOUT`, `PARSE_PARTIAL`, `NOT_IMPLEMENTED`, `TRUNCATED`.

## 3.1 La busta

| Campo | Tipo | Obbl. | Note |
| --- | --- | --- | --- |
| `formato` | `"da-ipam-estrazione"` | sì | fisso |
| `versione` | `"1.0"` | sì | fisso |
| `origine` | `"tecnico"` | sì | fisso |
| `provenienza.generato_il` | data ISO | sì | |
| `provenienza.strumento` | stringa | sì | es. `"claude-code"` più il nome dello script |
| `provenienza.parser` | `{ id, versione }` | sì | `id` = `<vendor>-<famiglia>` in minuscolo col trattino, es. `"zyxel-switch"`; `versione` semver, es. `"0.1.0"` |
| `provenienza.apparato` | `{ host }` | sì | indirizzo usato per collegarti |
| `provenienza.profilo` | stringa \| null | no | codice del profilo cliente in DA-IPAM, se te lo dico |
| `comandi[]` | array | sì | uno per comando lanciato, **senza l'output** |
| `comandi[].id` | stringa | sì | `c1`, `c2`, … |
| `comandi[].protocollo` | `"ssh"` \| `"snmp"` \| `"api"` | sì | |
| `comandi[].comando` | stringa | sì | il comando, l'OID (`walk 1.3.6.1.2.1.2.2`) o il metodo con il percorso (`GET /api/v1/interfaces`) |
| `comandi[].esito` | `"ok"` \| `"unsupported"` \| `"error"` \| `"timeout"` | sì | |
| `comandi[].letto_il` | data ISO | sì | |
| `comandi[].byte` | intero ≥ 0 | sì | lunghezza dell'output |
| `snapshot` | oggetto | sì | §3.2 |

## 3.2 Lo snapshot (formato 1.0 dei collector di DA-IPAM)

**Intestazione**, tutti campi obbligatori:

| Campo | Tipo | Note |
| --- | --- | --- |
| `schema_version` | `"1.0"` | fisso |
| `collector` | stringa | uguale a `provenienza.parser.id` |
| `collector_version` | stringa `N.N.N` | uguale a `provenienza.parser.versione` |
| `target` | stringa | l'host |
| `collected_at` | data ISO | inizio della lettura |
| `duration_ms` | numero ≥ 0 | |
| `status` | `"ok"` \| `"partial"` \| `"error"` | `partial` se almeno una sezione non è `ok` |

**Ogni sezione** ha questa forma: `{ "status", "collected_at", "sources": [], "warnings": [], "data": … }`.

**Sezioni obbligatorie** e forma di `data`. «s\|n» = stringa o `null`, «n\|n» = numero o `null`, «i\|n» = intero o `null`.

| Sezione | `data` | Campi di ogni elemento |
| --- | --- | --- |
| `identity` | oggetto o `null` | `manufacturer` s\|n, `model` s\|n, `firmware` s\|n, `serial_number` s\|n, `hostname` s\|n, `mac` s\|n, `sys_object_id` s\|n, `uptime_seconds` n\|n. Facoltativi: `part_number` s\|n, `boot_rom` s\|n |
| `interfaces` | array | `name` stringa, `if_index` i\|n, `description` s\|n, `kind` `"physical"`\|`"aggregate"`\|`"other"`, `admin_status` s\|n (`up`/`down`), `oper_status` s\|n (`up`/`down`), `speed_bps` n\|n (`null` a link giù), `reported_speed_bps` n\|n, `duplex` s\|n (`full`/`half`), `mtu` n\|n, `mac` s\|n, `counters` oggetto `{ nome: "cifre" }` (anche `{}`), `pvid` i\|n (solo se letto davvero, non dedotto dalle VLAN untagged). Facoltativi: `slot` s\|n, `module_observed` booleano\|null |
| `vlans` | array | `id` intero 1-4094, `name` s\|n, `tagged_ports` [stringhe], `untagged_ports` [stringhe], `forbidden_ports` [stringhe]. Facoltativo: `description` s\|n. I nomi di porta sono gli stessi di `interfaces[].name` |
| `forwarding` (tabella MAC/FDB) | array | `mac` stringa, `vlan_id` i\|n, `fdb_id` i\|n, `bridge_port` i\|n, `if_index` i\|n, `port` s\|n (nome come in `interfaces`), `status` s\|n (`learned`, `static`, …) |
| `neighbors` (LLDP/CDP) | array | `local_port` stringa, `remote_chassis` stringa, `remote_port` stringa, `system_name` s\|n, `system_description` s\|n, `management_addresses` [stringhe], `capabilities` [stringhe], `ttl_seconds` n\|n |
| `network` | oggetto | `ipv4_addresses`: [`{ address` stringa, `netmask` s\|n, `if_index` i\|n `}`]; `arp`: [`{ address` stringa, `mac` s\|n, `if_index` i\|n, `type` s\|n `}`] |
| `spanning_tree` | oggetto | `enabled` booleano\|null, `protocol` s\|n (`stp`/`rstp`/`mstp`), `ports`: [`{ port` stringa, `instance` s\|n, `state` s\|n, `role` s\|n `}`] |
| `aggregation` (LAG) | array | `name` stringa, `protocol` s\|n (`lacp`/`static`), `admin_status` s\|n, `oper_status` s\|n, `members` [stringhe]. Facoltativo: `member_states` [`{ port, selection, flags: [] }`] |
| `poe` | array | `port` stringa, `enabled` booleano\|null, `status` s\|n (`delivering`, `searching`, `disabled`, `fault`), `power_watts` n\|n. La sezione può avere anche `enabled` booleano\|null accanto a `status` |
| `sensors` | array | `name` stringa, `kind` `"temperature"`\|`"fan"`\|`"optical_rx"`\|`"optical_tx"`\|`"voltage"`\|`"current"`, `value` numero, `unit` `"celsius"`\|`"rpm"`\|`"dBm"`\|`"milliwatt"`\|`"volt"`\|`"ampere"`, `note` s\|n |

**Sezioni facoltative.** Le metti solo se le leggi.

| Sezione | `data` | Campi |
| --- | --- | --- |
| `routes` | array | `destination` stringa, `prefix_len` intero 0-32 (0-128 per IPv6), `gateway` s\|n, `interface` s\|n, `protocol` s\|n (`connected`, `static`, `ospf`, `bgp`, …), `metric` n\|n, `distance` n\|n, `active` booleano\|null, `vrf` s\|n |
| `resources` | oggetto | `cpu_percent` n\|n, `memory_total_bytes` n\|n, `memory_free_bytes` n\|n |
| `modules` | array | `slot` stringa, `description` s\|n, `model` s\|n, `serial_number` s\|n, `status` s\|n |

## 3.3 Esempio

Dati inventati. Negli esempi si usano solo questi valori, mai dati veri:
- IP di documentazione: `192.0.2.x`, `198.51.100.x`, `203.0.113.x`;
- MAC che cominciano con `02:00:00`.

```json
{
  "formato": "da-ipam-estrazione",
  "versione": "1.0",
  "origine": "tecnico",
  "provenienza": {
    "generato_il": "2026-11-09T10:15:02Z",
    "strumento": "claude-code estrai.py",
    "parser": { "id": "zyxel-switch", "versione": "0.1.0" },
    "apparato": { "host": "192.0.2.10" },
    "profilo": null
  },
  "comandi": [
    { "id": "c1", "protocollo": "ssh", "comando": "show version", "esito": "ok", "letto_il": "2026-11-09T10:14:51Z", "byte": 812 },
    { "id": "c2", "protocollo": "ssh", "comando": "show mac address-table", "esito": "ok", "letto_il": "2026-11-09T10:14:53Z", "byte": 20431 },
    { "id": "c3", "protocollo": "ssh", "comando": "show spanning-tree", "esito": "unsupported", "letto_il": "2026-11-09T10:14:57Z", "byte": 41 }
  ],
  "snapshot": {
    "schema_version": "1.0",
    "collector": "zyxel-switch",
    "collector_version": "0.1.0",
    "target": "192.0.2.10",
    "collected_at": "2026-11-09T10:14:50Z",
    "duration_ms": 11800,
    "status": "partial",
    "identity": { "status": "ok", "collected_at": "2026-11-09T10:14:51Z", "sources": ["show version"], "warnings": [],
      "data": { "manufacturer": "Zyxel", "model": "XGS2220-30HP", "firmware": "V4.80", "serial_number": "S000000000001",
                "hostname": "SW-01", "mac": "02:00:00:00:00:01", "sys_object_id": null, "uptime_seconds": 864000 } },
    "interfaces": { "status": "ok", "collected_at": "2026-11-09T10:14:52Z", "sources": ["show interfaces status"], "warnings": [],
      "data": [
        { "name": "1", "if_index": null, "description": null, "kind": "physical", "admin_status": "up", "oper_status": "up",
          "speed_bps": 1000000000, "reported_speed_bps": 1000000000, "duplex": "full", "mtu": null, "mac": null, "counters": {}, "pvid": 10 },
        { "name": "25", "if_index": null, "description": "uplink", "kind": "physical", "admin_status": "up", "oper_status": "up",
          "speed_bps": 10000000000, "reported_speed_bps": 10000000000, "duplex": "full", "mtu": null, "mac": null, "counters": {}, "pvid": 1 }
      ] },
    "vlans": { "status": "ok", "collected_at": "2026-11-09T10:14:52Z", "sources": ["show vlan"], "warnings": [],
      "data": [ { "id": 10, "name": "UFFICI", "tagged_ports": ["25"], "untagged_ports": ["1"], "forbidden_ports": [] } ] },
    "forwarding": { "status": "ok", "collected_at": "2026-11-09T10:14:53Z", "sources": ["show mac address-table"], "warnings": [],
      "data": [ { "mac": "02:00:00:00:10:01", "vlan_id": 10, "fdb_id": null, "bridge_port": null, "if_index": null, "port": "1", "status": "learned" } ] },
    "neighbors": { "status": "ok", "collected_at": "2026-11-09T10:14:54Z", "sources": ["show lldp info remote"], "warnings": [],
      "data": [ { "local_port": "25", "remote_chassis": "02:00:00:00:00:02", "remote_port": "Gi1/0/48", "system_name": "CORE-01",
                  "system_description": null, "management_addresses": ["192.0.2.1"], "capabilities": ["bridge"], "ttl_seconds": 120 } ] },
    "network": { "status": "ok", "collected_at": "2026-11-09T10:14:55Z", "sources": ["show ip", "show ip arp"], "warnings": [],
      "data": { "ipv4_addresses": [ { "address": "192.0.2.10", "netmask": "255.255.255.0", "if_index": null } ],
                "arp": [ { "address": "192.0.2.1", "mac": "02:00:00:00:00:02", "if_index": null, "type": "dynamic" } ] } },
    "spanning_tree": { "status": "unsupported", "collected_at": "2026-11-09T10:14:57Z", "sources": ["show spanning-tree"], "warnings": ["CMD_UNSUPPORTED"],
      "data": { "enabled": null, "protocol": null, "ports": [] } },
    "aggregation": { "status": "ok", "collected_at": "2026-11-09T10:14:57Z", "sources": ["show lacp"], "warnings": [], "data": [] },
    "poe": { "status": "ok", "collected_at": "2026-11-09T10:14:57Z", "sources": ["show poe status"], "warnings": [],
      "data": [ { "port": "1", "enabled": true, "status": "delivering", "power_watts": 4.2 } ] },
    "sensors": { "status": "skipped", "collected_at": "2026-11-09T10:14:58Z", "sources": [], "warnings": ["NOT_IMPLEMENTED"], "data": [] },
    "routes": { "status": "ok", "collected_at": "2026-11-09T10:14:56Z", "sources": ["show ip route"], "warnings": [],
      "data": [ { "destination": "0.0.0.0", "prefix_len": 0, "gateway": "192.0.2.1", "interface": "vlan10", "protocol": "static",
                  "metric": null, "distance": 1, "active": true, "vrf": null } ] }
  }
}
```

In questo esempio `aggregation` è `ok` con `[]`: il comando ha risposto e non c'è nessun LAG. È un dato. `sensors` invece è
`skipped`, perché non l'abbiamo letta.

# 4. Nome e posto del file

- **Cartella:** `~/DA-IPAM-estrazioni/` più una sottocartella per profilo cliente, se te lo indico. Su Debian e Mac è già sul
  disco cifrato. **Mai dentro un repository git.**
- **Nome:** `AAAAMMGG-HHMM_<collector>_<host>.json`, con l'host scritto coi trattini al posto dei punti. Per esempio
  `20261109-1015_zyxel-switch_192-0-2-10.json`.
- **Output grezzi:** in `~/DA-IPAM-estrazioni/grezzo/<stesso nome senza .json>/`, un file per comando (`c1.txt`, `c2.txt`, …).
  Servono a rifare il parser senza ricollegarsi. Restano sul PC: non si allegano e non si mandano a nessuno.
- **Lo script** lo salvi accanto, come `<collector>.py`: la prossima volta su un apparato della stessa famiglia si riusa.
- File e cartelle con permessi `600` e `700`.

# 5. Controllo prima di consegnare

Lancia questo controllo, che usa solo la libreria standard di Python e riceve il file delle credenziali della fase 2. Deve finire con `OK` ed esito 0, altrimenti correggi e
rilancia:

```python
#!/usr/bin/env python3
"""Uso: python3 controlla_estrazione.py <file.json> ~/DA-IPAM-estrazioni/.credenziali/<host>.env  (il file credenziali non si stampa mai)"""
import json, os, re, sys
ISO = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$")
STATI = {"ok", "partial", "unsupported", "error", "skipped"}
OBBL = {"identity": (dict, type(None)), "interfaces": list, "vlans": list, "forwarding": list, "neighbors": list,
        "network": dict, "spanning_tree": dict, "aggregation": list, "poe": list, "sensors": list}
VIETATI = re.compile(r"\b(configure|conf\s+t|system-view|edit|unset|delete|commit|write|save|copy|erase|format|reload|reboot|"
                     r"shutdown|clear|debug|execute|diagnose|request|test|ping|traceroute|enable|su|sudo|export|"
                     r"running-config|startup-config|terminal\s+monitor)\b|^set\b(?!\s+cli\s+screen-length)|^(PUT|PATCH|DELETE)\b", re.I)
err = []
def e(m): err.append(m)
p = sys.argv[1]
testo = open(p, encoding="utf-8").read()
d = json.loads(testo)
if (d.get("formato"), d.get("versione"), d.get("origine")) != ("da-ipam-estrazione", "1.0", "tecnico"): e("busta: formato/versione/origine")
pv = d.get("provenienza") or {}
if not ISO.match(str(pv.get("generato_il", ""))): e("provenienza.generato_il non ISO UTC con Z")
par = pv.get("parser") or {}
if not re.match(r"^[a-z0-9-]{3,40}$", str(par.get("id", ""))): e("provenienza.parser.id")
if not re.match(r"^\d+\.\d+\.\d+$", str(par.get("versione", ""))): e("provenienza.parser.versione")
for c in d.get("comandi", []):
    if c.get("esito") not in {"ok", "unsupported", "error", "timeout"}: e(f"comando {c.get('id')}: esito")
    if VIETATI.search(str(c.get("comando", ""))): e(f"comando {c.get('id')}: VIETATO -> {c.get('comando')}")
s = d.get("snapshot") or {}
if s.get("schema_version") != "1.0": e("snapshot.schema_version")
if s.get("collector") != par.get("id") or s.get("collector_version") != par.get("versione"): e("collector/versione diversi dalla busta")
if s.get("status") not in {"ok", "partial", "error"}: e("snapshot.status")
if not ISO.match(str(s.get("collected_at", ""))): e("snapshot.collected_at")
for nome, tipo in OBBL.items():
    sez = s.get(nome)
    if not isinstance(sez, dict): e(f"manca la sezione {nome}"); continue
    if sez.get("status") not in STATI: e(f"{nome}.status")
    if not ISO.match(str(sez.get("collected_at", ""))): e(f"{nome}.collected_at")
    if not isinstance(sez.get("sources"), list) or not isinstance(sez.get("warnings"), list): e(f"{nome}: sources/warnings")
    if not isinstance(sez.get("data"), tipo): e(f"{nome}.data: tipo sbagliato")
    if sez.get("status") in {"partial", "unsupported", "error", "skipped"} and not sez.get("warnings"): e(f"{nome}: stato {sez['status']} senza warnings")
for i in (s.get("interfaces") or {}).get("data") or []:
    if i.get("kind") not in {"physical", "aggregate", "other"}: e(f"interfaccia {i.get('name')}: kind")
    if any(not re.match(r"^\d+$", str(v)) for v in (i.get("counters") or {}).values()): e(f"interfaccia {i.get('name')}: contatori non stringhe di cifre")
for v in (s.get("vlans") or {}).get("data") or []:
    if not (isinstance(v.get("id"), int) and 1 <= v["id"] <= 4094): e(f"vlan {v.get('id')}: id fuori 1-4094")
cred = {}
if len(sys.argv) > 2:
    for r in open(os.path.expanduser(sys.argv[2]), encoding="utf-8"):
        if "=" in r: k, v = r.rstrip("\n").split("=", 1); cred[k.strip()] = v.strip().strip('"').strip("'")
else: e("manca il file credenziali: senza, il controllo dei segreti non si fa")
segreti = [v for k, v in cred.items() if re.match(r"^(SSH_PASSWORD|SNMP_COMMUNITY|SNMP_V3_\w*KEY|API_PASSWORD|API_TOKEN)$", k) and len(v) >= 3]
if any(x in testo for x in segreti): e("NEL FILE C'E' UNA CREDENZIALE: non consegnare")
if re.search(r"(password|secret|community|psk|private.key)\s*[:=]", testo, re.I): e("possibile segreto nel testo (password/secret/community/psk)")
print("\n".join(err) if err else "OK"); sys.exit(1 if err else 0)
```

Poi controlla a mano, in breve:

- `interfaces[].name` è lo stesso nome usato in `vlans`, `forwarding.port`, `neighbors.local_port`, `poe.port` e
  `aggregation.members`;
- nessuna sezione è `ok` con una lista vuota solo perché il comando non ha funzionato;
- i numeri tornano grosso modo con quello che vedi sull'apparato, per esempio il numero di porte.

Se c'è un clone di DA-IPAM sul PC, lo schema ufficiale dello snapshot si genera con
`node --import tsx scripts/acquire-device.ts --schema`. Vale quello, se diverge da questo testo.

# 6. Cosa mi dici alla fine

- Il percorso del file JSON.
- Le sezioni lette, con il numero di righe, e quelle non lette, con il motivo.
- I comandi lanciati: l'elenco di `comandi[]`.
- Cosa non hai potuto provare.

Non incollarmi il JSON intero né gli output grezzi in chat.

