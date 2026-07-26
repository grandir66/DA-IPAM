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

## 7. Verifica

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

## 8. Fasi di implementazione

| Fase | Contenuto | Valore |
|---|---|---|
| **0** | Quick-fix: rimappa `sysobj_lookup.category`, elimina il cast, `votes_for` su tutte le evidenze, `access_point` nel CHECK `network_devices` | sblocca subito il caso Ubiquiti, nessuna nuova architettura |
| **1** | Tassonomia 2 livelli + `attribution_evidence` + `fuse.ts` + emettitori dai segnali **già in DB** (LLDP, AD, Wazuh, agent, SNMP, OUI) | il grosso del recupero, zero probe nuovi |
| **2** | KB SQLite vendorizzata + `mac_product_map` + UI nel tab Identificazione | vendor/famiglia prodotto affidabili |
| **3** | Probe nuovi: HTTP/TLS esteso, mDNS, SSDP, WSD, SMB2 | copre gli endpoint senza SNMP né agent |
| **3b** | **UI subnet (§6)**: `Scansione iniziale` unica, fasi progressive con stato, `Ricalcola attribuzione` con anteprima; via i 4 combo | l'operatore vede e guida la progressione |
| **4** | Ritiro di B, migrazione UI, viste di compatibilità rimosse | un solo sistema |
| **5** | Opzionali: Fingerbank, AI, loop di feedback → `mac_product_map` | coda lunga consumer/IoT |

## 9. Rischi

- **Regressione su host già corretti** → mitigata dal golden set e dalla policy "manual vince sempre".
- **Peso dei probe nuovi su reti grandi** → probe solo su host con almeno una porta aperta, budget di
  tempo per rete, disattivabili per rete dalle impostazioni.
- **Licenze dei dataset** (GPL-2/3 per file di dati) → vendorizzati come **dati** con attribuzione e
  `NOTICE` nel repo, non linkati come codice.
- **Drift della KB** → script di rigenerazione riproducibile + versione della KB mostrata in UI.
