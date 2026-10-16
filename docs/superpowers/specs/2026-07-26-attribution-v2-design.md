# Attribution v2 — identificazione unificata vendor / categoria / OS

> Design approvato 2026-07-26. Sostituisce i 3 sistemi di attribuzione attuali con un motore unico
> a evidenze progressive. Stato: spec → piano di implementazione.

## 1. Problema

Oggi DA-IPAM ha **tre** sistemi di attribuzione più due scrittori che li scavalcano:

| Sistema | File | Quando | Scrive |
|---|---|---|---|
| **A** cascade + engine a pesi | `device-classifier.ts`, `classification/*` | scan, on-demand | `hosts.classification`, `classification_json`, `inferred_confidence` |
| **B** auto-classify | `devices/auto-classify.ts` | ogni `upsertHost` + backfill al boot | `hosts.inferred_*`, `inferred_confidence` |
| **C** anagrafica manuale | `vendor-device-profile.ts`, `device-product-profiles.ts` | promozione host→device | `network_devices.*` |
| bypass | `cron/jobs.ts:263,294,602` · `inventory-agent/enrich-host.ts:71` | cron ARP/DHCP, agent GLPI | `classification`, `vendor`, `inferred_os_family` diretti |

Misura in produzione (tenant 70791, 375 host, 2026-07-26): `classification` = `unknown` per 38 host,
`inferred_device_type` valorizzato solo sul **52,5%**, `inferred_confidence` = 0 su 145 host e = 40
su altri 47 (il floor esatto della cascade), `classification_reason` = "Insufficient evidence" su 131.

### Cause radice (verificate nel codice)

1. **`sysobj_lookup.category` non è una classificazione.** 53 righe su 94 contengono slug legacy
   (`networking`, `wireless`, `firewall`, `server`, `storage`) castati a `DeviceClassification` in
   `discovery.ts:2566-2568`. È il caso Ubiquiti: `…41112.1.6` (UniFi AP) → `"wireless"`,
   `…41112.1.4` (UniFi Switch) → `"networking"`; entrambi non renderizzabili → "unknown" in UI,
   **benché il prodotto fosse identificato correttamente**.
2. **L'engine a evidenze è quasi inerte.** In `classification/normalize.ts` le evidenze `mac_oui`,
   `dns`/hostname, `ssh`, `naabu` sono create **senza `votes_for`**, e `engine.ts:29` le salta.
   Il voto SNMP esiste solo per `cascade_method ∈ {oid, text}` su 6 method possibili. TTL e nmap
   votano **solo** `server_linux`/`server_windows` (`normalize.ts:69-77`): nessuna evidenza vota mai
   `switch`, `access_point`, `stampante`, `telecamera`. Da qui il floor di confidence 40 < soglia 56.
3. **Tre tassonomie disgiunte + collisione di colonna.** `access_point` non esiste in B né in
   `network_devices.device_type` (CHECK: router/switch/firewall/hypervisor) — un AP promosso diventa
   `hypervisor` o `switch`. `printer`≠`stampante`, `nas`≠`storage`. `inferred_confidence` è scritta
   da A e B con semantiche diverse e A legge il valore di B come soglia anti-downgrade.
4. **Segnali già in DB e mai usati per attribuire**: `device_neighbors` (LLDP/CDP, 44 righe),
   `ad_computers.operating_system` (57), `wazuh_agent.os_*` (52), `switch_ports` (207),
   `software_inventory`/`inv_agent_runtime` (6.477), `scan_history.raw_output` (1,15 M righe).
5. **Nessuna mappa MAC-prefix → prodotto.** Solo OUI→ragione sociale (`oui-data`, 39k prefissi
   MA-L; niente MA-M/MA-S). Ubiquiti AP vs switch oggi si distingue **solo** dal prefisso hostname
   (`^ap-`, `^sw-`): senza convenzione di naming, tutto diventa `access_point` di default.

## 2. Obiettivi e non-obiettivi

**Obiettivi.** Un unico motore che produce, per ogni host, tre attribuzioni indipendenti e tracciabili
— **vendor**, **categoria** (tassonomia a 2 livelli), **OS** — con confidence e catena di evidenze
visibile; che migliora **monotonicamente** man mano che le fasi di scan portano segnali; che
riconosce la linea di prodotto (Ubiquiti AP vs switch) senza dipendere dai nomi host; che è
governabile da UI (tab Identificazione già esistente) e correggibile a mano senza essere sovrascritto.

**Non-obiettivi.** Non riscriviamo i collettori di scan (icmp/naabu/nmap/snmp/AD/agent restano
quelli). Non introduciamo ML. Non rendiamo obbligatoria alcuna dipendenza cloud. Non tocchiamo
la UI di rete/subnet oltre ai punti dove si mostra l'attribuzione.

## 3. Principio portante: attribuzione progressiva

La scansione è a **fasi successive** e non tutti i segnali esistono da subito:

```
scan_icmp ─→ scan_naabu ─→ scan_nmap_base ─→ scan_snmp_verify ─→ credential_validate (ssh/winrm)
   TTL         porte          OS + servizi        sysObjectID          software, OS esatto
   MAC/OUI     banner         sysDescr            LLDP/CDP             ruolo macchina
                                                                            ↑
                        AD / Wazuh / agent GLPI: presenti solo se il modulo è installato
```

Conseguenze di design, vincolanti:

- L'attribuzione **non è un evento di fine scan**: è una funzione pura `evidenze → attribuzione`
  rieseguita a ogni arrivo di nuove evidenze (fine fase, sync AD, report agent, correzione manuale).
- Ogni evidenza è **immutabile e datata**; nessuna fase cancella le evidenze di un'altra.
- Il risultato deve essere **utile già dopo `scan_icmp`** (vendor da OUI + famiglia da mappa
  MAC→prodotto) e **non peggiorare mai** con l'arrivo di segnali più forti: la fusione è
  deterministica sull'insieme completo delle evidenze, non incrementale sullo stato precedente.
- Ogni attribuzione dichiara la **fase minima** che l'ha resa possibile → la UI può dire
  "per migliorare questo host serve SNMP" invece di mostrare un vuoto.

## 4. Architettura

### 4.1 Tre dimensioni separate

Oggi una sola colonna `classification` mescola vendor, categoria e OS (`server_windows` è due
dimensioni in un valore). Le separiamo:

| Dimensione | Esempio | Tassonomia |
|---|---|---|
| `vendor` | `ubiquiti` | slug normalizzato + `vendor_name` display |
| `category` | `network.access_point` | 2 livelli: famiglia . tipo |
| `os` | `os_family=linux`, `os_name="EdgeOS 2.0.9"` | famiglia + stringa libera |

`category` a due livelli (radici da Fingerbank, foglie pragmatiche da LibreNMS):
`network.{router,switch,access_point,firewall,controller,modem}` ·
`compute.{server,workstation,hypervisor,vm,laptop}` ·
`storage.{nas,san,tape}` · `peripheral.{printer,scanner,mfp}` ·
`av.{camera,nvr,display,speaker}` · `voip.{phone,pbx,gateway}` ·
`power.{ups,pdu}` · `iot.{sensor,thermostat,plug,other}` · `mobile.{phone,tablet,wearable}` ·
`unknown`.

Il livello 1 è sempre attribuibile prima del livello 2: "so che è `network.*` ma non se AP o switch"
è uno stato legittimo e mostrabile, oggi impossibile.

### 4.2 Evidenze

Tabella tenant `attribution_evidence` — append-only, una riga per (host, sorgente, claim):

```
host_id, source, phase, dimension, claim, confidence REAL, weight REAL,
raw_value TEXT, observed_at, expires_at NULL, superseded_by NULL
```

`source` ∈ `oui | mac_product | hostname | dhcp | ttl | ports | http_banner | tls_cert | snmp_sysobj |
snmp_sysdescr | lldp | cdp | mdns | ssdp | wsd | netbios | smb | nmap_os | nmap_service | ad |
wazuh | inv_agent | ssh | winrm | fingerbank | ai | manual`.

Regole: ogni evidenza **deve** dichiarare `dimension` + `claim` (mai più evidenze "mute" come oggi);
le evidenze scadono (`expires_at`) per i segnali volatili (DHCP, TTL); una correzione manuale è
un'evidenza `source=manual` con confidence 1.0 che vince sempre e non viene mai sovrascritta.

### 4.3 Fusione

`attribution/fuse.ts`, funzione pura, per ciascuna delle 3 dimensioni:

1. Raggruppa le evidenze non scadute per `claim`; score = `Σ (weight × confidence)`.
2. **Gerarchia**: un voto per `network.access_point` conta anche per `network.*` (livello 1),
   quindi il livello 1 emerge anche quando le foglie si dividono.
3. Vince il claim più profondo sopra la soglia; se due claim di pari livello distano meno della
   finestra di conflitto → si ripiega al padre comune e si registra il conflitto.
4. **Autorità di sorgente**: alcune evidenze sono *dichiarative*, non probabilistiche, e saltano la
   somma pesata (con motivo tracciato):
   - LLDP/CDP capability bits → categoria certa (bit 2 bridge=switch, 3 wlanAccessPoint=AP,
     4 router, 5 telephone). È lo standard IEEE 802.1AB: non un'euristica.
   - AD `operating_system`, Wazuh `os_name`, agent GLPI → OS autoritativo.
   - WS-Discovery `NetworkVideoTransmitter` → `av.camera`; IPP/`_pdl-datastream` → `peripheral.printer`.
   - `manual` → tutte e tre le dimensioni.
5. Output: claim, confidence 0-100, `min_phase` che l'ha prodotto, evidenze citate, conflitti.

### 4.4 Dataset (offline-first, vendorizzati)

Artefatto SQLite `data/attribution-kb.sqlite` generato da uno script di build e **committato**, così
l'appliance non tocca mai internet. Sorgenti, tutte ridistribuibili con attribuzione:

| Dataset | Uso | Licenza |
|---|---|---|
| maclookup.app JSON (58k prefissi, MA-L/M/S/CID, daily) | OUI→vendor, trie 24/28/36 bit | libero, attribuzione |
| fallback Wireshark `manuf` (settimanale) | idem | GPL-2 |
| `glpi-project/sysobject.ids` (~2.500 voci) | sysObjectID→vendor/tipo/modello | GPL-2 |
| LibreNMS `resources/definitions/os_detection/*.yaml` | sysObjectID/sysDescr→os/type per apparati | GPL-3 |
| HA `generated/dhcp.py` + `generated/zeroconf.py` (~900 + 160 matcher) | seed MAC-prefix/hostname/mDNS→famiglia prodotto | Apache-2.0 |
| Satori XML | fingerprint DHCP/SMB/UA | GPL-2 |
| OUI-Master-Database (17,6% con categoria) | hint categoria a **bassa** confidence | MIT |

⚠️ Non puntare mai a `standards-oui.ieee.org` dall'appliance: risponde 418 ai client automatici.

**Tabella curata Domarc** `mac_product_map` (hub, editabile da UI, seedata dai dataset sopra):
`mac_prefix` (24/28/36 bit) + `hostname_pattern` opzionale → `vendor`, `product_family`, `category`,
`confidence`, `source` (`seed|domarc|feedback`). È qui che si risolve il caso Ubiquiti quando LLDP e
SNMP non sono disponibili, ed è l'asset che cresce nel tempo con le correzioni dal campo.

### 4.5 Collettori: cosa si aggiunge

Riuso di quanto esiste (`probeHttpBanners` c'è già ma è gated e la sua evidenza non vota).
Nuovi probe leggeri, tutti senza credenziali, nella fase `scan_naabu`/`scan_nmap_base`:

- **HTTP/HTTPS GET su porte note** (80/443/8080/8443/9443/7080…): `Server` header, `<title>`,
  redirect di login, **CN/SAN del certificato TLS** — le web UI di NAS, AP, camere e stampanti si
  autodichiarano. Estende `probeHttpBanners` e lo rende votante.
- **mDNS** unicast: `_device-info._tcp` (`model=`), `_ipp._tcp` (`usb_MFG`/`usb_MDL` = modello
  stampante esatto), `_hap._tcp` (`ci=` category identifier HomeKit), `_airplay`, `_googlecast`.
- **SSDP/UPnP** M-SEARCH: `deviceType` (`WLANAccessPointDevice`, `InternetGatewayDevice`) + XML
  `manufacturer`/`modelName`.
- **WS-Discovery** (UDP 3702): `NetworkVideoTransmitter` = camera ONVIF, `PrintDeviceType`.
- **SMB2 negotiate + NTLMSSP** su 445: build Windows esatta senza credenziali.
- **LLDP/CDP**: nessun probe nuovo — si leggono `device_neighbors`, già popolata.

### 4.6 Arricchimento opzionale (per-tenant, default OFF)

- **Fingerbank**: DB SQLite locale scaricato con API key del cliente (offline dopo), oppure API
  cloud (300 req/h free). Non redistribuibile → mai nel repo. Evidenza `source=fingerbank`,
  autorità media, mai sopra `manual`/LLDP.
- **AI**: solo per host che restano ambigui dopo la fusione. Payload **anonimizzato** (mai IP,
  hostname o nome cliente: solo vendor, modello, porte, banner sanificati) coerentemente con la
  regola AI payload di DA-Vul-can. Evidenza `source=ai` con confidence ≤ 0.6, sempre etichettata in
  UI come suggerimento; non può da sola superare la soglia di applicazione.

### 4.7 Migrazione dei tre sistemi

- **A** conserva i suoi collettori (cascade SNMP, fingerprint rules), che diventano **emettitori di
  evidenze**; la decisione passa a `fuse.ts`. `sysobj_lookup.category` viene **rimappata** ai nuovi
  slug con una migrazione dati (le 53 righe legacy: `wireless`→`network.access_point`,
  `networking`→`network.*` livello 1, ecc.) e il cast bugiardo eliminato.
- **B** viene ritirato: `auto-classify` diventa un emettitore di evidenze (OUI/hostname/porte) e non
  scrive più colonne proprie. `inferred_*` restano come **viste di compatibilità** finché la UI non
  è migrata, popolate dal risultato della fusione — fine della collisione su `inferred_confidence`.
- **C** guadagna `access_point` (+ gli altri tipi) nel CHECK di `network_devices.device_type` e
  prende vendor/categoria dalla fusione come default proposto, restando sovrascrivibile a mano.
- **Bypass**: `cron/jobs.ts` e `enrich-host.ts` smettono di scrivere `classification`/`inferred_*`
  e passano a `recordEvidence()`.
- `classification_feedback` (oggi scritta e mai letta) diventa la sorgente di `mac_product_map`
  con `source=feedback`: le correzioni degli operatori migliorano il dataset.

## 5. Dati e API

**Tenant**: nuova `attribution_evidence`; nuove colonne `hosts.attr_vendor`, `attr_vendor_name`,
`attr_category`, `attr_os_family`, `attr_os_name`, `attr_confidence_*` (una per dimensione),
`attr_min_phase`, `attr_at`, `attr_engine_version`; `host_classification_history` estesa alle 3
dimensioni. **Hub**: `mac_product_map`; `sysobj_lookup.category` migrata; KB SQLite read-only.

API: `GET /api/hosts/[id]/attribution` (attribuzione + evidenze + conflitti + "cosa manca"),
`POST /api/hosts/[id]/attribution/override` (correzione manuale), `POST /api/attribution/recompute`
(rifusione bulk per tenant/rete, usata anche dopo l'aggiornamento della KB),
CRUD `mac_product_map` nel tab **Identificazione** esistente.

## 6. UI subnet — separare acquisizione e attribuzione

### 6.1 Stato attuale (verificato in `networks/[id]/network-detail-client.tsx`)

Il pannello **Scan — intera subnet** offre due percorsi iniziali alternativi e non dichiarati come
tali — `Scan completo` (`scan_full`: ICMP → Nmap base → SNMP → Enrich, riga 1042) e `Scan Naabu`
(`scan_naabu`: ICMP → Naabu → Nmap -sV mirato, riga 1053) — più cinque pulsanti granulari
(ICMP, Nmap base, SNMP verify, Enrich, Enrich + AD sync).

Il pannello **Classificazione** (riga 1183) ripropone **gli stessi due scan** accoppiati alla
classificazione: `Naabu + classifica` (1188) e `Scan completo + classifica` (1203) — che sono
letteralmente `runScanJob(...)` seguito da `classifySubnet()` (righe 820-852) — più
`Solo classifica` (1214, ricalcolo sui dati già in IPAM) e `Anteprima proposte` (1232).

Problemi: la stessa acquisizione appare in due pannelli; l'utente deve scegliere *a priori* tra due
percorsi iniziali senza sapere se naabu è installato; se lo scan combo fallisce la classificazione
non parte affatto (righe 828-831, 847-850); e la classificazione appare come coda di uno scan
invece che come operazione indipendente.

### 6.2 Modello target

Con Attribution v2 la fusione è una **funzione pura sulle evidenze già salvate**: rieseguirla non
costa una scansione. Questo permette di separare nettamente le due cose.

**Blocco A — Acquisizione (progressiva).** Un unico ingresso e una catena esplicita:

- **`Scansione iniziale`** — pulsante primario unico. Sostituisce la scelta tra `scan_full` e
  `scan_naabu`: esegue ICMP + port discovery scegliendo **automaticamente** naabu se disponibile
  (capability rilevata dall'hub/agent) e ricadendo su nmap quick altrimenti, più i probe leggeri
  della fase 3 (HTTP/TLS, mDNS, SSDP, WSD). Il percorso effettivo è mostrato a posteriori, non
  scelto a priori.
- **Fasi successive**, ognuna con il proprio pulsante e il proprio **stato per rete** (mai
  eseguita / eseguita il … / obsoleta, con copertura host): `Porte approfondite (Nmap -sV)`,
  `SNMP`, `Enrich (ARP/DHCP/AD)`, `Credenziali (SSH/WinRM)`. Ogni fase dichiara **cosa aggiunge**
  all'attribuzione ("SNMP → sysObjectID, LLDP: distingue AP da switch").
- **`Esegui tutte le fasi`** — l'equivalente dell'attuale `scan_full`, come azione secondaria.

**Blocco B — Attribuzione (indipendente, sempre disponibile).** Un solo pulsante
**`Ricalcola attribuzione`**, attivo in qualunque momento — anche senza aver mai scansionato, anche
mentre una fase è in corso, perché legge solo le evidenze salvate. Due modalità:

- **Anteprima** (default): mostra **solo gli host la cui attribuzione cambierebbe**, con
  `prima → dopo` per ciascuna delle 3 dimensioni, la confidence, **le evidenze che causano il
  cambio** e *perché ora* (quale fase ha portato il segnale nuovo). Selezione per host, poi applica.
  Riusa e sostituisce l'attuale `ClassificationProposalDialog`.
- **Applica diretto**: per chi si fida, stessa operazione senza dialog.

Gli host con override manuale sono mostrati ma **mai** proposti per il cambio (§4.2).

**Ricalcolo automatico.** Al termine di ogni fase di acquisizione la fusione riparte da sola sugli
host toccati: l'attribuzione è sempre allineata alle evidenze. Il pulsante manuale serve per
verificare/riapplicare dopo un aggiornamento della KB, delle regole nel tab Identificazione o della
`mac_product_map` — non per "far partire" la classificazione.

**Conseguenza diretta**: i 4 pulsanti combo del pannello Classificazione spariscono. Restano
1 pulsante di acquisizione iniziale + N di avanzamento fase + 1 di attribuzione con anteprima.

### 6.3 Indicatore di completezza

In testa alla subnet, una riga di stato per rete: quali fasi sono state eseguite e quando, quanti
host hanno attribuzione a livello 2 vs solo livello 1 vs nessuna, e **l'azione suggerita** —
derivata da `attr_min_phase` degli host incerti ("32 host fermi al livello 1: esegui SNMP per
distinguere AP da switch"). La stessa informazione, per singolo host, vive nel pannello evidenze.

## 7. Credenziali — diagnostica, binding e riuso

Il sistema di diagnostica credenziali **resta e diventa un pilastro**: è ciò che trasforma un host
scoperto in un oggetto di inventario completo, ed è al tempo stesso una delle evidenze più forti per
l'attribuzione. Non va sostituito, va **riparato e potenziato**.

### 7.1 Stato attuale (verificato in codice e in produzione)

Nucleo funzionante: `credential_validate` (`scanner/discovery.ts:2084-2241`) itera host × credenziali
della subnet, prova SSH (`sshTryConnect`, timeout 6 s), SNMP v2c (sysName/sysDescr/sysObjectID),
WinRM (`hostname` via bridge), e scrive l'esito in `host_credentials` (`validated`, `validated_at`,
`auto_detected`) e, se l'host è già promosso a device, in `device_credential_bindings`
(`test_status`, `test_message`, `tested_at`). Cifratura AES-256-GCM in `crypto.ts`; vault hub in
`system_credentials` con audit.

Misura in produzione (tenant 70791, 2026-07-26): **59 host su 375 (16%)** hanno una credenziale,
58 validate — SSH 34, WinRM 24, **SNMP 7**. Ultima validazione a livello host: **2026-05-27**.
`software_scans`: 13 error + 4 timeout su 37 (**46% di fallimenti**). E soprattutto: **41 host
rispondono a SNMP** (`snmp_data` popolato) **senza alcuna credenziale SNMP validata**.

**Le due rotture della catena** (causa dei numeri sopra):

1. **L'UI moderna non alimenta i collettori.** `NetworkCredentialsTable` scrive `network_credentials`
   (v2), ma `buildSnmpCommunitiesForHost` (`db.ts:3526`), `getOrderedDetectCredentialIds` (`:3461`) e
   `getOrderedSshLinuxCredentialIds` (`:3475`) leggono le tabelle **legacy**
   `network_host_credentials` / `host_detect_credential`, scrivibili di fatto solo dall'onboarding.
   Una credenziale SNMP aggiunta oggi dall'UI **non entra** nella catena community di
   `scan_snmp_verify`/`snmp deep`: il walk riprova `public`/`private` — ecco i 41 host.
2. **`host_credentials.validated` non è letto da nessun collettore di inventario.** Lo usano patch
   executor, terminale SSH e i badge UI; le acquisizioni profonde passano **solo** da
   `device_credential_bindings`, popolato da `autoBindCredentialToDevice()` che esce subito se non
   esiste già un `network_devices` con quell'IP (`discovery.ts:124`). Host non promosso → nessun
   binding → software scan fallisce con "non ha credenziali linkate".

Altri difetti rilevanti: nessuna rivalidazione automatica (`credential_validate` non è tra i
`job_type` di `scheduled_jobs`), `validated=1` resta vero per sempre anche dopo una rotazione
password; nessun retry né persistenza dei fallimenti (`host_credentials` non ha `last_error`,
`fail_count`, `last_attempt_at`); SNMP v3 mai validato (solo `authNoPriv`, nessun privKey);
il binding `api` viene creato **senza alcun test**; tre vocabolari incoerenti
(`credential_type` = `ssh|snmp|api|windows|linux` mescola protocollo e OS, mentre `protocol_type` =
`ssh|snmp|winrm|api`); `ad-client.ts:106` usa `decrypt()` nudo invece di `safeDecrypt()` (viola la
regola 3 del CLAUDE.md).

### 7.2 Catena unica: valida una volta, riusa ovunque

- **Una sola sorgente di verità**: `host_credentials` per gli host, `device_credential_bindings` per
  i device promossi, con propagazione automatica host↔device (già presente in
  `api/devices/[id]/credentials`, da generalizzare). Le tre tabelle legacy
  (`network_host_credentials`, `host_detect_credential`, colonne inline su `network_devices`)
  vengono migrate e **deprecate**; il componente morto `NetworkCredentialChains` rimosso.
- **Tutti i collettori leggono il binding validato per primo**, con fallback alla catena della
  subnet: SNMP deep, scan `windows`/`ssh`, ARP/DHCP dal router, switch/LLDP, NAS, Proxmox,
  software inventory. Un solo helper `resolveCredentialFor(host|device, protocol)`.
- **Il binding non richiede la promozione a device**: gli host restano acquisibili in profondità
  anche prima di diventare oggetti di inventario.
- **Vocabolario unico** `protocol` (`ssh|snmp|winrm|wmi|smb|api|redfish|ipmi|onvif|netconf`),
  con l'OS che smette di essere un "tipo di credenziale": `windows`→`winrm`, `linux`→`ssh`.

### 7.3 Le credenziali come evidenza di attribuzione

Ogni esito di autenticazione emette evidenza (§4.2) — oggi questa informazione viene buttata:

| Esito | Evidenza | Forza |
|---|---|---|
| WinRM/WMI OK | `os_family=windows` + build esatta → `compute.workstation\|server` | autoritativa |
| SSH OK | banner: OpenSSH/Debian → `compute` + `linux`; RouterOS/IOS/VyOS/EdgeOS → `network.*` + vendor | autoritativa |
| SNMP OK | sysObjectID → vendor+modello+categoria via KB; LLDP capability → AP vs switch | autoritativa |
| API vendor OK | modello e ruolo dichiarati dal controller (UniFi, Proxmox, vSphere, MikroTik) | autoritativa |
| Redfish/IPMI OK | è un **BMC**: `compute.server` + modello/seriale del server ospite | autoritativa |
| ONVIF OK | è una **camera** + modello/firmware | autoritativa |
| Auth rifiutata ma servizio presente | il servizio esiste comunque → segnale debole di categoria/OS | media |

Caso reale dal DB: l'host `ILOSGH942WX1N` (vendor "Hewlett Packard Enterprise") oggi è `unknown` a
confidence 40; con Redfish diventa `compute.server` con modello, seriale e firmware del server.

### 7.4 Estensione dei protocolli

Oltre a SNMP/SSH/API/WinRM già presenti, in ordine di rapporto valore/costo:

| Protocollo | Sblocca | Priorità |
|---|---|---|
| **SNMP v3 completo** (authPriv, privKey) | apparati enterprise dove v2c è disabilitato per policy | alta — oggi v3 non è nemmeno validato |
| **SMB/WMI** come fallback WinRM | Windows con WinRM disabilitato (casistica frequentissima): SMB2+NTLMSSP dà già la build **senza credenziali**, con credenziali dà l'inventario | alta |
| **Redfish / IPMI** | BMC (iLO, iDRAC, XClarity): modello, seriale, firmware, stato hardware del server | alta |
| **API vendor** (MikroTik REST, UniFi/Omada controller, Proxmox, vSphere, firewall Forti/Sophos/Stormshield) | inventario autoritativo; per UniFi risolve AP vs switch senza ambiguità | alta (parte già esiste) |
| **ONVIF** | camere: modello, firmware, stream | media |
| **NETCONF/RESTCONF** | switch/router enterprise dove SSH-CLI è fragile | media |
| **Chiave privata SSH** (oggi solo user/password) | apparati e server che rifiutano l'auth password | media |
| **HTTP/REST generico con token** | appliance web-only | bassa |
| **Telnet** | apparati legacy, opt-in esplicito perché in chiaro | bassa |

Ogni protocollo nuovo deve fornire: un test di validazione, un estrattore di evidenze e un
estrattore di inventario — altrimenti non entra.

### 7.5 Anti-lockout e igiene (vincolante)

Con 316 host senza credenziali, una validazione più aggressiva è un rischio concreto di blocco
account AD. Oggi la protezione `validatedProtos` (`discovery.ts:2138`) agisce **solo dopo un
successo**: se nessuna credenziale Windows funziona, vengono provate tutte su ogni host — 3
credenziali × 200 host = 600 logon falliti in pochi minuti.

Regole obbligatorie:

- **Budget per credenziale e per finestra**: dopo N fallimenti consecutivi della stessa credenziale
  su una subnet, si smette di provarla (stato persistito, non solo in-memory).
- **Persistenza dei fallimenti**: `last_error`, `fail_count`, `last_attempt_at` su
  `host_credentials`, con backoff esponenziale per host+credenziale.
- **Mai provare credenziali di dominio su host palesemente non-Windows**; salta i **multihomed
  secondary** (già fatto da `/api/devices/[id]/test`, non da `credential_validate`).
- **Invalidazione al fallimento**: un binding `validated=1` che fallisce torna a `0` con motivo,
  invece di restare vero per sempre.
- **Rivalidazione schedulata**: `credential_validate` entra nei `job_type` di `scheduled_jobs`
  (default settimanale, per subnet), così le rotazioni password emergono da sole.
- Timeout SSH allineato agli altri percorsi (15 s, non 6) per evitare falsi negativi su link lenti.

### 7.6 Copertura come metrica

Nuova vista trasversale (e metrica di accettazione): **quali host non hanno una credenziale valida
per il protocollo che servirebbe loro**, derivata dall'attribuzione — se un host è `network.switch`
gli serve SNMP, se è `compute.workstation` gli serve WinRM/SMB. Target: dal 16% attuale a **≥ 70%**
degli host con almeno una credenziale valida per il protocollo pertinente, e software scan falliti
< 15%.

## 8. Verifica

- **Unit** su `fuse.ts`: casi tabellari con evidenze sintetiche (AP Ubiquiti via LLDP; stesso AP
  senza LLDP ma con mDNS; switch Ubiquiti con hostname fuorviante `ap-piano2`; conflitto tra nmap e
  AD; sola fase ICMP; evidenza scaduta).
- **Golden set**: snapshot delle evidenze di ~50 host reali del tenant 70791 con l'attribuzione
  attesa verificata a mano; il test fallisce se una release peggiora un host già corretto.
- **Metrica di accettazione** (stesso tenant, oggi → target): categoria valorizzata 52,5% → **≥ 90%**;
  livello 2 corretto sul golden set ≥ 85%; host a confidence 0 145 → **< 20**; zero slug non
  renderizzabili.
- **Progressività**: test che per ogni host golden l'attribuzione dopo la fase N non contraddica
  quella dopo la fase N+1 (può solo affinarsi o restare).

## 9. Fasi di implementazione

| Fase | Contenuto | Valore |
|---|---|---|
| **0** ✅ | Quick-fix: rimappa `sysobj_lookup.category`, elimina il cast, `votes_for` su tutte le evidenze, `access_point` nel CHECK `network_devices` | **Completata 2026-07-26** — v0.3.202, impl. Cursor, verifica Claude. Vedi esito sotto. |

### Esito Fase 0 misurato in produzione (tenant 70791, 2026-07-26)

Confronto contro backup pre-deploy `/var/tmp/70791.pre-attrv2.db`, dopo la prima
riclassificazione automatica (170 decisioni):

| Metrica | Prima | Dopo |
|---|---|---|
| Confidence media | 37,5 | **45,0** |
| Host a confidence ≥ 56 (soglia di applicazione) | 73 | **150** |
| Host bloccati al floor 40 della cascade | 183 | **81** |
| Slug non renderizzabili (`networking`/`wireless`) | 0 | **0** |
| Host con `classification_manual` modificati | — | **0** |
| Degradi da slug valido a `unknown` | — | **0** |
| Integrità dati (device / host) | 32 / 375 | **32 / 375** |

Le **etichette** di classificazione non cambiano (0 host): i 9 MikroTik che il mapper porta
da `networking` a `router` erano già `router` per via di un livello più alto della cascade.
Il guadagno reale della fase è sul **punteggio**: le evidenze prima mute ora votano, e più del
doppio degli host supera la soglia di applicazione. `host_classification_history` registra le
decisioni *valutate* (71 su host manuali, 1 `unknown`) ma **nessuna è stata applicata**: il lock
manuale e la policy anti-downgrade hanno retto.

Limite noto: i 4 AP UniFi in produzione riportano il sysObjectID **generico**
`1.3.6.1.4.1.41112`, assente dalla lookup table (che mappa solo `.1.6` e `.1.4`). Il caso Ubiquiti
si risolve quindi in **Fase 1** (modello dal `sysDescr`: `U6-Pro`, `U7-Pro`, `USW`) e in **Fase 2**
(`mac_product_map`), non qui.
| **1** | Tassonomia 2 livelli + `attribution_evidence` + `fuse.ts` + emettitori dai segnali **già in DB** (LLDP, AD, Wazuh, agent, SNMP, OUI) | il grosso del recupero, zero probe nuovi |
| **1b** | **Credenziali (§7.2)**: catena unica, `resolveCredentialFor()`, tutti i collettori leggono il binding validato, legacy migrate; anti-lockout + `fail_count` + rivalidazione schedulata (§7.5); esiti auth → evidenze (§7.3) | sblocca le acquisizioni profonde: 41 host SNMP e il 46% di software scan falliti |
| **2** | KB SQLite vendorizzata + `mac_product_map` + UI nel tab Identificazione | vendor/famiglia prodotto affidabili |
| **3** | Probe nuovi: HTTP/TLS esteso, mDNS, SSDP, WSD, SMB2 | copre gli endpoint senza SNMP né agent |
| **3b** | **UI subnet (§6)**: `Scansione iniziale` unica, fasi progressive con stato, `Ricalcola attribuzione` con anteprima; via i 4 combo | l'operatore vede e guida la progressione |
| **4** | Ritiro di B, migrazione UI, viste di compatibilità rimosse | un solo sistema |
| **4b** | **Protocolli nuovi (§7.4)**: SNMP v3 completo, SMB/WMI fallback, Redfish/IPMI, API vendor, ONVIF | inventario completo su BMC, camere, Windows senza WinRM |
| **5** | Opzionali: Fingerbank, AI, loop di feedback → `mac_product_map` | coda lunga consumer/IoT |

## 10. Rischi

- **Regressione su host già corretti** → mitigata dal golden set e dalla policy "manual vince sempre".
- **Peso dei probe nuovi su reti grandi** → probe solo su host con almeno una porta aperta, budget di
  tempo per rete, disattivabili per rete dalle impostazioni.
- **Licenze dei dataset** (GPL-2/3 per file di dati) → vendorizzati come **dati** con attribuzione e
  `NOTICE` nel repo, non linkati come codice.
- **Drift della KB** → script di rigenerazione riproducibile + versione della KB mostrata in UI.
