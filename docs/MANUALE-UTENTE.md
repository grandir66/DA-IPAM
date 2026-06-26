# DA-INVENT — Manuale utente

> **Versione di riferimento:** 0.3.116
> **Ultima modifica:** 2026-06-26
> Prodotto open source di [Domarc](https://domarc.it). Per i fork pubblici è richiesta attribuzione (vedi `LICENSE`).

> ℹ️ **Nota nome prodotto:** l'interfaccia mostra **DA-INVENT** (codice progetto interno: *DA-IPAM*). I due nomi indicano lo stesso prodotto; nel manuale usiamo **DA-INVENT** per coerenza con ciò che vedi a schermo.

> 🖼️ **Screenshot:** le immagini di questo manuale provengono da un ambiente dimostrativo con dati oscurati (IP, hostname e nomi cliente sono fittizi/redatti). Le tue schermate reali avranno lo stesso layout ma dati differenti.

---

## Indice

1. [Cos'è DA-INVENT](#1-cosè-da-invent)
2. [Primo avvio e setup](#2-primo-avvio-e-setup)
3. [Login e navigazione](#3-login-e-navigazione)
4. [Dashboard](#4-dashboard)
5. [Gestione Subnet (Reti)](#5-gestione-subnet-reti)
6. [Discovery — vista unificata host](#6-discovery--vista-unificata-host)
7. [Stati host (Online, Unreachable, Lost, …)](#7-stati-host)
8. [Azioni rapide per riga](#8-azioni-rapide-per-riga)
9. [Motore di scan](#9-motore-di-scan)
10. [Dispositivi di Rete (Router, Switch, Firewall, Hypervisor)](#10-dispositivi-di-rete)
11. [Tabella ARP e Sorgenti DHCP](#11-tabella-arp-e-sorgenti-dhcp)
12. [Active Directory](#12-active-directory)
13. [Credenziali](#13-credenziali)
14. [Vulnerabilità (CVE)](#14-vulnerabilità-cve)
15. [Software — inventario installato](#15-software--inventario-installato)
16. [Patch Management](#16-patch-management)
17. [Inventario Asset, Assegnatari, Ubicazioni](#17-inventario-asset-assegnatari-ubicazioni)
18. [Licenze Software](#18-licenze-software)
19. [Servizi NIS2](#19-servizi-nis2)
20. [Network Services (DNS / DHCP / AdBlock)](#20-network-services-dns--dhcp--adblock)
21. [Anomalie (Analytics)](#21-anomalie-analytics)
22. [Launchpad e Integrazioni](#22-launchpad-e-integrazioni)
23. [Agenti remoti (Scanner-Edge)](#23-agenti-remoti-scanner-edge)
24. [Scansioni — storico ed esecuzioni manuali](#24-scansioni--storico-ed-esecuzioni-manuali)
25. [Impostazioni](#25-impostazioni)
26. [Ricerca globale](#26-ricerca-globale)
27. [Export e Backup](#27-export-e-backup)
28. [Multi-tenant e Superadmin](#28-multi-tenant-e-superadmin)
29. [Manuale in-app](#29-manuale-in-app)
30. [Appendice — Classificazioni dispositivi](#30-appendice--classificazioni-dispositivi)

---

## 1. Cos'è DA-INVENT

**DA-INVENT** (codice progetto: DA-IPAM) è un IPAM (IP Address Management) + Inventario di rete con uno strato **security e integrazioni** che lo rende il punto unico di regia dell'infrastruttura del cliente:

- **Discovery attiva** delle reti: ICMP + TCP fallback + ARP/DHCP poll dai router
- **Inventario dispositivi** (host + network device gestibili: router, switch, firewall, hypervisor)
- **Sincronizzazione Active Directory** per arricchire gli host con dati AD
- **Vulnerability management**: CVE correlate agli host, raccolte da **Scanner-Edge** (Greenbone/OpenVAS) e dagli agenti **Wazuh** (§14)
- **Inventario software** realmente installato sugli host (§15) e **Patch Management** Windows CVE-driven (§16)
- **Network Services** gestiti: DNS, DHCP e filtraggio (AdBlock) tramite una VM dedicata (§20)
- **Launchpad**: cruscotto unico dello stato di tutti i moduli e integrazioni (§22)
- **Agenti remoti**: appliance **Scanner-Edge** installate presso i clienti, registrate e monitorate dall'hub (§23)
- **Multi-tenant** (un'installazione → più clienti separati, §28)

Differenze chiave rispetto ad altri IPAM:

- **Lo stato online di un host è basato su probe attivi reali**, non sulla presenza in tabella ARP/DHCP. ARP e DHCP arricchiscono solo MAC/vendor/hostname (vedi §7 e §9).
- Stati granulari (Offline, Unreachable, Transient, Lost) per distinguere il transitorio dal dismesso.
- Entry point unico: la pagina **Discovery** (§6) mostra ogni host di ogni subnet con filtri rapidi, badge CVE, e collegamento alle integrazioni (Wazuh, LibreNMS).

**Architettura** (per i curiosi): Next.js 16 + TypeScript strict + SQLite (better-sqlite3, un DB per tenant) + NextAuth v5, architettura **hub + spoke**. Gli scanner remoti (Scanner-Edge) e i servizi di rete girano su VM/appliance separate e dialogano via HTTP/Tailscale. Vedi `MANUALE-SVILUPPATORE.md` per i dettagli.

---

## 2. Primo avvio e setup

Al **primo accesso** (DB vuoto) l'app reindirizza a `/setup`.

Campi richiesti:
- Username (min 3 caratteri)
- Password (min 8 caratteri)
- Conferma password

L'account creato ha ruolo `admin` (oppure `superadmin` se è il primo utente del cluster multi-tenant). Dopo la creazione si viene reindirizzati al login.

`/setup` non è più raggiungibile una volta esistente almeno un utente.

---

## 3. Login e navigazione

### Login

URL: `https://<indirizzo-server>/login` (o `http://...:3001` in dev).

Inserire username e password. Dopo **5 tentativi errati in 15 minuti** per lo stesso username scatta il rate-limit (HTTP 429).

### Struttura sidebar (tenant attivo)

![Sidebar di navigazione DA-INVENT con i gruppi Network, Inventario e Network Services](/manual/img/sidebar.png)
*La sidebar reale (v0.3.116): voci di primo livello + tre gruppi collassabili (Network, Inventario, Network Services).*

```
─────────────────────────
[ Logo / DA-INVENT ]
─────────────────────────
(solo superadmin)
🏢 Clienti
🖥️ Agenti remoti
─── Tenant switcher ───
─── Dati cliente ───

📊 Dashboard

▾ Network
   Subnet
   Discovery               ← entry point principale
   Vulnerabilità           ← CVE aggregate (§14)
   Software                ← inventario installato (§15)
   Active Directory
   Credenziali
   ─── Diagnostica ───
   Tabella ARP
   Sorgenti DHCP
   Scansioni
   IP esclusi

▾ Inventario
   Asset
   Software
   Assegnatari
   Ubicazioni
   Licenze
   Servizi NIS2

▾ Network Services
   Panoramica
   DNS
   DHCP

🔑 Launchpad               ← stato moduli + integrazioni (§22)
⚠️  Anomalie  (badge rosso se non gestite)
🛡️ Patch Management        ← solo se il modulo è attivo per il tenant (§16)
📖 Manuale

──── Sistema ────
⚙️  Impostazioni
```

Solo per **superadmin** appaiono in alto:
- **Clienti** — gestione tenant (§28)
- **Agenti remoti** — appliance Scanner-Edge installate presso i clienti (§23)

> Le voci **Patch Management** è condizionale: compare solo se la relativa *feature* è installata per il tenant attivo (Impostazioni → Moduli). La voce **Config Cliente** è presente ma disabilitata ("In arrivo").

### Tenant switcher

Sotto il blocco superadmin, un selettore tenant ti permette di passare velocemente da un cliente all'altro o vedere "Tutti i clienti". L'etichetta del tenant attivo appare prima del separatore "Dati cliente".

### Mobile

Su mobile la sidebar è collassata; aprila con il bottone hamburger in alto a sinistra. Tap fuori per chiuderla.

### Ricerca globale

In cima alla pagina trovi una **search bar** che cerca in IP, MAC, hostname, network device name, classificazione, su tutti i tenant a cui hai accesso. Vedi §26.

---

## 4. Dashboard

`/` è la home con widget di sintesi.

![Dashboard con card statistiche e grafici](/manual/img/dashboard.png)

### Card statistiche principali

| Card | Significato |
|---|---|
| **Subnet** | Numero di reti gestite |
| **Host totali** | Host noti nel DB del tenant |
| **Online** | Host con `status=online` derivato (vedi §7) |
| **Offline** | Host non più raggiungibili (somma di Offline+Unreachable+Transient+Lost) |
| **Sconosciuti** | Host mai probati attivamente |

### Grafici

- **Online nel tempo**: trend online/offline ultime 24h o 7g
- **Latency anomalies**: pulsazioni RTT anomale rilevate
- **Top subnet per cambi**: subnet con maggior turnover di host

### Monitoraggio Host conosciuti

Lista degli host con flag `known_host=1` (monitor critico): online/offline con latenza media e ultimo down. Cliccabile per andare al dettaglio.

### Anomalie recenti

Ultimi alert generati: MAC flip, port change, latency anomaly, nuovi host non riconosciuti, uptime drop. Apri l'elenco completo dalla voce **Anomalie** (§21).

---

## 5. Gestione Subnet (Reti)

### Elenco reti — `Network → Subnet`

Tabella con: CIDR, Nome, VLAN, Sede, Host totali, Online/Offline/Sconosciuti, Ultima scansione, azioni.

![Elenco subnet](/manual/img/subnet-list.png)

### Aggiungere una rete

Pulsante **"+ Aggiungi Subnet"** in alto a destra.

| Campo | Obbligatorio | Descrizione |
|---|:---:|---|
| **CIDR** | ✓ | `192.168.1.0/24` (validazione anti-overlap con reti esistenti) |
| **Nome** | ✓ | Etichetta umana |
| **Descrizione** | — | Note libere |
| **Gateway** | — | IP gateway (es. `192.168.1.1`) |
| **VLAN ID** | — | 1-4094 |
| **Sede / Ubicazione** | — | Filiale, edificio, rack |
| **DNS Server** | — | Override DNS per le reverse lookup |
| **SNMP Community** | — | Community SNMP di default per questa subnet |
| **Router ARP** | — | Network device da cui leggere la tabella ARP/lease DHCP |

**Aggiungi router al volo:** dal dropdown "Router ARP" puoi cliccare **"+ Aggiungi router"** per registrare un nuovo network_device senza chiudere il form rete.

### Catene credenziali per subnet

Il blocco **Rilevamento avanzato** del dialog rete raggruppa le catene credenziali in ordine di priorità:

- **WinRM (Windows)** — usata da scan Windows
- **Account Linux (OS)** — usata da scan SSH
- **SSH dispositivi** — per network_device tipo router/switch
- **SNMP** — community v2c e profili v3

Per ciascuna lista puoi:
- **Prelevare dall'archivio** una credenziale già registrata (menu Credenziali)
- **Creare credenziale esplicita** "al volo" con form (nome + dati)

L'**ordine** è l'ordine di tentativo — un solo tentativo per credenziale per host. **Best practice**: almeno 3 credenziali per tipo in produzione.

Fallback SSH: catena rete → catena Linux rete → "host Linux" globale in Impostazioni. Fallback SNMP: community in catena → campo "Community SNMP" della rete → `public` / `private`.

### Dettaglio rete — `Network → Subnet → [subnet]`

![Dettaglio subnet con toolbar di scan e griglia IP](/manual/img/subnet-detail.png)

**Toolbar** con i pulsanti scan:

| Pulsante | Azione |
|---|---|
| **Scoperta rete** | Lancia `network_discovery` (ICMP + second-pass TCP + Nmap quick + SNMP sysObj + DNS) |
| **Nmap** (con dropdown profilo) | Port scan completo TCP+UDP — richiede selezione host |
| **ARP** | Solo ARP poll dal router associato (no upsert status) |
| **Rilevamento avanzato** | WinRM + SSH sugli host selezionati per OS/hostname/inventario |
| **Aggiorna periodicamente** | Toggle: avvia `network_discovery` ogni N minuti (config in Impostazioni) |

**Vista** alternabile tra:
- 📊 **Griglia IP** — ogni IP della subnet come cella colorata (verde online, rosso offline, grigio sconosciuto). Click → scheda host.
- 📋 **Lista** — tabella con tutti gli host, checkbox per selezione multipla.

In lista puoi selezionare host e usare i pulsanti toolbar (Nmap manuale, SNMP, DNS, Rilevamento avanzato — applicano solo agli IP selezionati).

### Eliminare una subnet

Pulsante 🗑️ nella riga. **Irreversibile**: elimina anche tutti gli host associati. Conferma richiesta.

---

## 6. Discovery — vista unificata host

`Network → Discovery` è la pagina più usata: una **tabella unica** con tutti gli host di tutte le subnet del tenant.

![Vista Discovery con filtri, chip preset e tabella host](/manual/img/discovery.png)

### Cosa vedi per ogni host

Colonne configurabili dal menu **Colonne** (icona 3 colonne). Sono raggruppate in tab (Base / Rete / Rilevamento / Dettaglio):

- IP, MAC, hostname (custom o rilevato)
- **Stato** (vedi §7) con timestamp relativo
- Profilo device + classificazione + confidenza fingerprint
- Vendor, produttore, OS, modello, seriale, firmware
- Subnet di appartenenza, VLAN, sede, porta switch
- Credenziali validate (badge verde per protocollo OK)
- Conteggi CVE (Critical/High/Medium) da Scanner-Edge / Wazuh
- Badge **Wazuh** (stato agente) e link **LibreNMS** (se integrazioni attive)
- DHCP/statico, AD sì/no, multihomed
- Porte TCP/UDP aperte, RTT
- Asset tag, app scansionate
- Ultimo/primo visto

### Legenda icone Discovery

![Legenda icone della tabella Discovery: profilo, credenziali, CVE, Wazuh, azioni](/manual/img/discovery-icons.png)

| Icona | Significato |
|---|---|
| 🛡️ **ShieldAlert** (rosso/arancio) | Host con CVE critiche/high rilevate |
| 🔑 / 🔒 | Credenziali presenti / mancanti per l'host |
| ✅ **ShieldCheck** | Credenziale validata con successo |
| 📡 badge Wazuh | Agente Wazuh attivo / disconnesso / non installato |
| 🔗 **ExternalLink** | Apri il device in LibreNMS |
| ⋮ **MoreVertical** (kebab) | Apre il menu azioni di riga (§8) |
| ▲ / ▼ | Direzione di ordinamento sulla colonna |

### Toolbar (in alto)

| Elemento | Funzione |
|---|---|
| 🔎 **Cerca** | Full-text su IP, MAC, hostname, vendor, network, note, OS, manufacturer |
| **Stato** | Filtro base (Online / Offline / Sconosciuto) |
| **Classificazione** | Dropdown con tutte le classificazioni presenti |
| **Subnet** | Filtro per network |
| **CVE** | "Critici/High", "Solo critici", "Con findings" |
| 🎛️ **Colonne** | Picker per mostrare/nascondere colonne (preferenza salvata lato server) |
| ⬇️ **Esporta CSV** | Scarica la vista filtrata corrente |
| 🔄 **Aggiorna** | Ricarica i dati |

### Chip preset rapidi (sotto la toolbar)

Filtro one-click per macro-categoria. I preset sono **personalizzabili**: puoi crearne di nuovi (con icona ed elenco classificazioni) dall'editor preset.

| Chip | Filtra `classification` IN | Note |
|---|---|---|
| **Tutti** | (nessuno) | Reset |
| 🖥️ **Server** | `server`, `server_linux`, `server_windows` | Tutti i server insieme |
| 💻 **Client** | `workstation`, `notebook` | Postazioni utente |
| 💾 **Hypervisor** | `hypervisor` | Proxmox / VMware |
| 🔀 **Router** | `router` | — |
| 🔌 **Switch** | `switch` | — |
| 🛡️ **Firewall** | `firewall` | — |
| 📶 **AP / NET / UPS / TEL / PRINT / CAM / IOT / …** | varie | Preset estesi e custom |

Ogni chip mostra il conteggio fra parentesi. Click per attivare, click di nuovo per disattivare. Si combinano in AND con gli altri filtri.

### Operazioni bulk (con selezione checkbox)

Spuntando le checkbox a sinistra appare la barra **operazioni bulk** in basso:

- **Aggiorna selezionati** — esegue scan + inventario software per ogni IP (dialog progresso e log per-host)
- **Aggiungi a dispositivi** — promuove host → `network_device` in bulk (classificazione + vendor + protocollo + credenziali comuni)
- **Crea asset NIS2** — promuove gli host selezionati come asset NIS2
- **Modifica** — dialog per editare campi comuni (classificazione, vendor, sede, note, credenziali) su N host
- **Esporta selezionati** — CSV dei soli host selezionati

---

## 7. Stati host

Lo stato di un host visualizzato nel badge è **derivato a display time** dal campo base `status` (online/offline/unknown nel DB) combinato con `last_seen` e l'**intervallo del cron scan** della sua subnet.

Questo modello permette di distinguere a colpo d'occhio un down transitorio da un device fantasma dimenticato.

![Legenda dei 7 badge di stato host](/manual/img/host-states.png)

### I 7 stati visualizzati

| Badge | Etichetta | Condizione | Significato operativo |
|---|---|---|---|
| 🟢 verde pulsante | **Online** | `status=online`, ultima risposta recente | Risponde ora ai probe. Tutto OK. |
| 🟡 ambra | **Online (stale)** | `status=online`, `last_seen > 24h` | Marcato online ma nessun probe da >24h. Indica scan rotto: investiga. |
| 🔴 rosso | **Offline** | `status=offline`, down da < 4 cicli | Probabile down transitorio (riavvio, link flap). |
| 🟠 arancio | **Unreachable** | `status=offline`, down da ≥ 4 × scan interval | Persistente. Verifica alimentazione/cavo/firewall/rete. |
| 🟡 giallo scuro | **Transient** | `status=offline`, `last_seen ≥ 24h` | Down da ore/giorni. Spegnimento programmato, manutenzione. |
| ⚫ grigio scuro | **Lost** | `status=offline`, `last_seen ≥ 7 giorni` | Probabilmente dismesso. Candidato a cleanup dall'inventario. |
| ⚪ grigio chiaro | **Sconosciuto** | `status=unknown` o nessun `last_seen` | Mai probato attivamente. Visto solo via ARP/DHCP/AD. |

### Soglia "Unreachable" calcolata per subnet

La soglia è **4 × scan_interval_minutes** del job attivo sulla subnet:

| Interval cron | Soglia Unreachable |
|---|---|
| 15 min | **1 ora** (default in produzione Domarc) |
| 30 min | 2 ore |
| 60 min | 4 ore |
| 120 min | 8 ore |

Subnet senza job scan attivo → default 30 min → soglia 2h.

### Tooltip sul badge

Al passaggio mouse appare:
- Nome stato + spiegazione operativa
- Timestamp assoluto dell'ultimo contatto
- Soglia unreachable calcolata per quella subnet

### Anti-host-fantasma: cosa NON cambia lo stato

**Le sorgenti passive** (ARP table del router, DHCP lease, sync AD) NON forzano `status=online`. Una entry ARP può restare nel router per 4+ ore anche dopo lo spegnimento del device, un lease DHCP può durare giorni: non sono prove di reachability.

Solo i **probe attivi** decidono lo stato:
- `network_discovery` — cron + manuale (Network → Subnet → Scoperta rete)
- `fast_scan` — cron (lo scan periodico per subnet)
- `ping` — manuale

ARP / DHCP / AD aggiornano solo metadata (MAC, hostname, vendor, classificazione), mai status.

> **Bug fix v0.2.495 (rilevante):** prima di questa release, `arp_poll` e `dhcp` forzavano `status=online` per ogni entry presente nel router. Risultato: host spenti da settimane apparivano online. Dopo la fix, solo probe ICMP/TCP determinano lo stato.

Approfondimento: [Stati host e Discovery](STATI-HOST-E-DISCOVERY.md).

---

## 8. Azioni rapide per riga

Ogni riga di Discovery ha un menu **Azioni** (icona ⋮). Cambia in base al tipo:

![Menu azioni di riga in Discovery](/manual/img/row-actions.png)

### Host puro (rilevato passivamente)

| Icona | Nome | Funzione | Endpoint |
|---|---|---|---|
| ✏️ | **Modifica host** | Apre `/hosts/[id]` per editare hostname custom, classificazione manuale, note, asset tag, IP assignment, ecc. | — |
| 🔑 | **Test cred host** | Apre dialog "Test credenziali" e prova le credenziali compatibili dal pool tenant contro l'IP grezzo. | `POST /api/hosts/[id]/test-creds` (interno) |
| ✨ | **Crea regola fingerprint** | Genera una regola di fingerprinting dal detection snapshot dell'host. | — |
| 🗑️ | **Elimina host** | Rimuove la riga dal DB (conferma richiesta). Ricreato al prossimo scan se ancora rilevato. | `DELETE /api/hosts/[id]` |

### Host promosso a `network_device` (colonna "Dispositivo" valorizzata)

| Icona | Nome | Funzione | Endpoint |
|---|---|---|---|
| ✏️ | **Modifica device** | Apre `/devices/[device_id]` per gestire credenziali binding, vendor, scan target, protocollo, ecc. | — |
| 🛡️ | **Test credenziali device** | Verifica live le credenziali del binding (SSH/WinRM/SNMP/API). Toast con risultato. | `GET /api/devices/[id]/test` |
| 🔄 | **Riscansiona device** | Esegue query completa (port, sysinfo, ARP, DHCP se router). Aggiorna la riga. | `POST /api/devices/[id]/query` |
| 🔗 | **Apri in LibreNMS** | Apre il device nella console LibreNMS (se integrazione attiva). | — |
| 🗑️ | **Elimina device** | Rimuove il `network_device` ma lascia l'host nel DB (conferma). | `DELETE /api/devices/[id]` |

### Selezione multipla

Spuntando le checkbox a sinistra appaiono le **operazioni bulk** (vedi §6).

---

## 9. Motore di scan

### Tipi di scan e quando partono

| Scan type | Trigger | Cosa fa | Modifica `status`? |
|---|---|---|---|
| **`fast_scan`** | Cron periodico per subnet (default 15 min in produzione), oppure manuale dalla pagina subnet | nmap -sn (o pingSweep) + second-pass TCP + ARP/DHCP poll dal router | ✅ Sì (P1 strict) |
| **`network_discovery`** | Manuale (UI o cron `ping_sweep`) | ICMP + second-pass TCP + Nmap quick TCP + SNMP sysObjectID + DNS | ✅ Sì (P1 strict) |
| **`arp_poll`** | Cron periodico o interno a fast_scan | Legge ARP table dei router, aggiorna MAC/vendor | ❌ No |
| **`dhcp`** | Cron, o interno a fast_scan | Legge lease DHCP, aggiorna hostname/MAC | ❌ No |
| **`nmap`** (profilo) | Manuale, host selezionati | Port scan completo TCP+UDP + OS fingerprint | ➕ Additivo |
| **`snmp`** | Manuale, host selezionati | Walk SNMP per sysName/sysDescr/sysObjectID + arricchimento | ❌ No |
| **`windows`** / **`ssh`** | Manuale (Rilevamento avanzato) | Inventory software via WinRM/SSH (richiede credenziali) | ❌ No |
| **`credential_validate`** | Manuale | Solo test credenziali, no scan | ❌ No |
| **`vuln_sync`** | Cron 30 min | Tira findings CVE da Scanner-Edge | ❌ No |
| **`ad_sync`** | Cron | Sync LDAP/AD computer objects | ❌ No |
| **`librenms_sync`** | Cron | Sync host con LibreNMS | ❌ No |

### Algoritmo `network_discovery` e `fast_scan`

1. **ICMP sweep parallelo** su tutti gli IP del CIDR (timeout 2s, 50-128 concorrenti)
2. **Second-pass TCP**: per ogni host **già `status=online`** nel DB che NON ha risposto a ICMP, prova TCP su porte fallback `[22, 80, 443, 3389, 8080, 8443]` con timeout 2s. Se almeno una risponde → considerato online. Questo recupera device che bloccano ICMP (Windows con firewall default, stampanti di rete, IoT, server hardened).
3. **ARP/DHCP poll** dal router della subnet (se configurato) — solo per arricchire MAC/vendor/hostname, **non** per cambiare status.
4. **Phase 4 — offline marking (P1 strict)**: tutti gli IP del CIDR che NON sono in `onlineIps` (ICMP + TCP combinati) vengono marcati `status=offline`. Aggiunge anche una nota diagnostica.

Per `network_discovery` viene aggiunto anche:
- Nmap quick TCP sugli host online (porte comuni) → arricchimento porte
- SNMP sysObjectID probe → identifica vendor/prodotto da OID
- DNS reverse + forward lookup
- Match Active Directory (collega host a computer AD esistenti)

### Schedulazione cron

Da **Network → Scansioni** vedi i job attivi e lo storico esecuzioni.

**Best practice produzione (Domarc):**
- `fast_scan` a 15 min su tutte le subnet → stato Offline reale in <15 min, Unreachable in 1h
- `vuln_sync` a 30 min se hai uno Scanner-Edge collegato
- Niente `ping_sweep` separato (il fast_scan è sufficiente)

---

## 10. Dispositivi di Rete

Network device = host promosso a "risorsa gestita" con credenziali, vendor, protocollo, scan target.

### Pagine classificate

`/devices/router`, `/devices/switch`, `/devices/firewall`, `/devices/hypervisor`, `/devices/server`, ecc. mostrano la lista filtrata per `device_type`.

> Le **azioni semplici per-riga** (Modifica, Test cred, Riscansiona, Elimina) sono **equivalenti a quelle in Discovery** (§8) — usa quello che preferisci. Le pagine classificate restano per workflow specialistici:

### Workflow specifici per tipo

**Router / Switch / Firewall:**
- Aggiungi dispositivo da zero (dialog con picker credenziali + protocollo)
- Aggiungi in bulk da host esistenti (promuovi più host insieme)
- DHCP sync per MikroTik (importa lease nelle subnet)
- Bulk test credenziali / bulk scan

**Hypervisor:**
- **Scan Proxmox** dedicato: legge VM, container, storage, subscription
- **Visualizza dati** dell'ultimo scan Proxmox
- **Abbina inventario** (match automatico VM ↔ asset)
- **"Imposta come Proxmox"** per device hypervisor generici che vuoi gestire via API/SSH Proxmox

### Aggiungere un device

Pulsante **"+ Aggiungi"** in cima alla lista classificata, oppure da Discovery → operazioni bulk → "Aggiungi a dispositivi".

Campi obbligatori: Nome, IP/host, Device type, Vendor, Protocollo, almeno una Credenziale (per protocolli che la richiedono).

### Detail page — `/devices/[id]`

- Tab **Generale**: editare tutti i campi
- Tab **Credenziali**: binding multipli (es. un device con SSH + SNMP entrambi)
- Tab **Porte switch** (solo switch): elenco porte con stato, VLAN, PoE, descrizione, MAC visti
- Tab **Software** (linux/windows/proxmox): inventory app installate (§15)
- Tab **Vulnerabilità**: CVE findings (§14)

---

## 11. Tabella ARP e Sorgenti DHCP

`Network → Tabella ARP` mostra l'aggregato di tutte le mappature MAC ↔ IP raccolte da:
- Polling ARP dai router/switch L3
- DHCP lease attivi
- Switch port table (CAM)
- Host (campo MAC del record host)

Colonne: MAC, IP, Network, Vendor (OUI), Hostname, Sorgente (`arp`/`dhcp`/`host`/`switch`), Source device, First/Last seen. Filtri per network, sorgente, ricerca testuale.

`Network → Sorgenti DHCP` (`/dhcp/sources`) elenca i **server DHCP esterni** da cui leggere i lease (tipicamente MikroTik via API/SSH, o Windows DHCP). I lease raccolti popolano sia la mappa MAC↔IP sia, dove disponibile, la freschezza (`last_seen`) per filtrare i relitti.

> Per la **gestione attiva** di DNS/DHCP tramite la VM Network Services dedicata (zone, scope Kea, AdBlock) vedi §20. La voce "Sorgenti DHCP" qui è solo *lettura* dei lease da server di terze parti.

> **Importante:** la presenza di una entry in ARP o un lease DHCP **NON significa che l'host sia attualmente online**. Vedi §7 (anti-host-fantasma).

---

## 12. Active Directory

`Network → Active Directory` gestisce la sincronizzazione con uno o più domini AD.

### Configurazione integrazione

Da **Impostazioni → Integrazioni → Active Directory**:
- URL LDAP (es. `ldap://dc.cliente.local:389` o `ldaps://...:636`)
- Bind DN + password (con account che può leggere `Computer` objects)
- Base DN per la ricerca
- Filtri opzionali

### Sync periodica

Job `ad_sync` configurabile. Importa i computer object con: hostname, OS, ultima logon, OU.

### Match con host esistenti

Dopo ogni `network_discovery`, lo scanner tenta di **collegare** i computer AD agli host scoperti basandosi su DNS forward/reverse e hostname. Crea host nuovi se l'AD ne riporta uno non visto via ARP. Colonna **AD** in Discovery: badge verde se l'host è collegato a un computer object AD.

### LDAPS su DC con signing forzato

Se il tuo DC impone LDAP signing senza certificato installato, l'integrazione fallisce con `OPERATIONS_ERROR`. **Il fix è sul DC, non su DA-INVENT**: installa un certificato self-signed (o aziendale) nei store `My` + `Trusted Root` del DC e riavvia il servizio `NTDS`. Vedi `playbooks/ad-ldaps-windows.md`.

Dettagli completi: [Manuale Active Directory](MANUALE-ACTIVE-DIRECTORY.md).

---

## 13. Credenziali

`Network → Credenziali` è l'archivio centralizzato.

### Tipi supportati

| Tipo | Usato per |
|---|---|
| `linux` / `ssh` | Login SSH (router MikroTik/Cisco/Linux, server) |
| `windows` / `winrm` | WinRM (server Windows, AD member) — vedi [Manuale WinRM](MANUALE-WINRM.md) |
| `snmp_v2` | Community string SNMP v2c |
| `snmp_v3` | User/auth/priv SNMP v3 |
| `api` | Token API (Proxmox, MikroTik REST) |
| `proxmox` | User + token Proxmox API |

### Crittografia at-rest

Tutte le password e token sono **cifrati AES-GCM** con `ENCRYPTION_KEY` configurata in `.env.local`. **Non perdere quella chiave**: la sua perdita rende tutte le credenziali inaccessibili (recovery: reinserimento manuale).

### Catene per subnet

Una credenziale può essere:
- Globale (visibile a tutti i tenant) — solo superadmin
- Per-tenant (visibile solo dentro un tenant)

E può essere **inserita in catene** sulle subnet (vedi §5) per essere provata in ordine durante gli scan.

---

## 14. Vulnerabilità (CVE)

`Network → Vulnerabilità` (`/vulnerabilities`, icona 🛡️ **ShieldAlert**) è la vista aggregata delle **CVE** che interessano gli host del tenant. I dati provengono da due sorgenti:

- **Scanner-Edge** (Greenbone/OpenVAS) — appliance di scansione installata presso il cliente (§23)
- **Wazuh** — gli agenti endpoint riportano le vulnerabilità note dei pacchetti installati

![Vista Vulnerabilità con rollup severità, filtri e tabella CVE](/manual/img/vulnerabilities.png)

### Cosa vedi

- **Rollup severità** in cima: conteggi **Critical / High / Medium / Low**
- **Tabella CVE** ordinabile: CVE ID, severità, **CVSS score**, pacchetto/package, sorgenti, n. host affetti, ultima scansione
- **Espansione riga** (chevron) → anteprima inline degli host affetti (max 5)
- Pulsante **"Vedi tutti"** → modale **Host affetti** con la tabella completa (IP, network, severità, CVSS, sorgente, data rilevamento)

### Filtri

| Filtro | Valori |
|---|---|
| 🔎 **Cerca** | testo libero su CVE / package (debounce 300ms) |
| **Severità** | Critical / High / Medium / Low |
| **Sorgente** | Edge / Wazuh |
| **OS** | Windows / Linux / Apple / Sconosciuto |
| **Solo con CVE** | toggle |
| **Reset** | azzera i filtri |

### Legenda icone

| Icona | Significato |
|---|---|
| 🛡️ **ShieldAlert** (arancio) | titolo pagina / severità vulnerabilità |
| 🔎 **Search** | campo di ricerca |
| ⏳ **Loader2** (spinner) | caricamento in corso |
| ▸ / ▾ **Chevron** | espandi / comprimi gli host affetti |

> La pagina è popolata solo se almeno una sorgente (Scanner-Edge o Wazuh) è configurata e ha completato una sincronizzazione. Lo stato delle integrazioni si vede nel **Launchpad** (§22).

---

## 15. Software — inventario installato

`Network → Software` (o `Inventario → Software`, `/software`, icona 📦 **Package**) è l'inventario del **software realmente installato** sugli host, aggregato e deduplicato per nome+versione.

> ⚠️ Da non confondere con **Licenze Software** (§18): qui c'è ciò che è *installato e rilevato*; lì la gestione *contrattuale* delle licenze.

![Inventario software con filtri e tabella](/manual/img/software.png)

### Cosa vedi

Tabella ordinabile: **Nome software**, publisher, versione, n. host su cui è installato, **n. CVE** associate (badge), **match Chocolatey** (OK / N.D.), **patchable** (Sì / No).

Click su una riga → dettaglio in **Patch Management** (`/patch-management/software/[chiave]`, §16).

### Filtri

- 🔎 **Cerca** (debounce 300ms)
- **OS** (Windows / Linux / Apple)
- **Sorgente**: Wazuh / Probe (Scanner-Edge) / Agent

I dati provengono dagli agenti **Wazuh** e dalle probe di inventario (WinRM/SSH) eseguite dallo Scanner-Edge o dal "Rilevamento avanzato" (§9).

---

## 16. Patch Management

`Patch Management` (`/patch-management`, icona 🛡️ **ShieldCheck**) è il modulo di **compliance patch Windows** CVE-driven. È una **feature opzionale per tenant**: la voce in sidebar compare solo se il modulo è installato (Impostazioni → Moduli).

![Patch Management — tab Device con conteggi CVE e azioni bulk](/manual/img/patch-management.png)

### Tab "Device"

Elenco degli host Windows con: host, IP, OS, n. software, **breakdown CVE** (C / H / M / L), stato **WinRM** (OK / N.D.), ultima probe + esito.

- **Filtri**: ricerca, severità (Tutte / Critical / Critical+High / +Medium)
- **Selezione bulk** (max 50 host) → barra azioni in basso:
  - 🚀 **Bootstrap Choco** — installa Chocolatey sugli host selezionati (via WinRM)
  - 🪄 **Installa Wazuh** — distribuisce l'agente Wazuh (manager preconfigurato)
- I risultati delle operazioni asincrone si seguono in un modale con polling.

### Tab "Software"

Software deduplicato con conteggio CVE e patchability. Filtri **"Solo con CVE"** e **"Solo patchable"**. Click riga → dettaglio software.

### Azioni in alto

| Pulsante | Icona | Funzione |
|---|---|---|
| **Calcola matching** | ✨ Sparkles | Riconcilia CVE ↔ software ↔ pacchetto Chocolatey |
| **Filtra per CVE** | 🔎 Filter | Vista per singola CVE (`/patch-management/cve`) |
| **Storico operazioni** | 🕘 History | Log delle operazioni di patch (`/patch-management/history`) |

### Legenda icone

| Icona | Significato |
|---|---|
| 🔎 **PackageSearch** | titolo modulo |
| 🚀 **Rocket** | bootstrap Chocolatey |
| 🪄 **Wand2** | installazione agente Wazuh |
| ✅ **ShieldCheck** | WinRM/Choco validato |
| ⚠️ **AlertCircle** | errore operazione |
| ❔ **ShieldQuestion** | nessun dato / empty state |

> Prerequisiti: credenziali **WinRM** valide sugli host Windows e integrazione **Wazuh** configurata per il dato CVE↔software. Vedi [Manuale WinRM](MANUALE-WINRM.md).

---

## 17. Inventario Asset, Assegnatari, Ubicazioni

`Inventario → Asset` è il vero inventario fisico (oltre al discovery di rete).

### Asset

Ogni asset ha: codice, descrizione, categoria, marca, modello, seriale, asset tag, data acquisto, valore, garanzia, fornitore, assegnatario, ubicazione, host collegato (opzionale).

### Link Asset ↔ Host

Un asset può essere collegato a un host scoperto. Da Discovery puoi "Crea asset NIS2" che genera asset partendo dall'host con classificazione corretta.

### Assegnatari

Persone o dipartimenti a cui sono assegnati gli asset. Campi: nome, email, ufficio, ruolo. Filtri per dipartimento.

### Ubicazioni

Sedi, edifici, locali, rack. Struttura ad albero (`Sede A > Building 1 > Floor 2 > Rack 12`). Filtro asset per ubicazione.

---

## 18. Licenze Software

`Inventario → Licenze` traccia le licenze software (gestione contrattuale, distinta dall'inventario installato di §15):
- Software (Microsoft Office, Adobe Creative Cloud, ecc.)
- Tipo licenza (perpetua, abbonamento, OEM, volume)
- Quantità acquisite, assegnate, disponibili
- Scadenza (con alert)
- Costo, fornitore, ordine d'acquisto

Assegnazione licenza → asset.

---

## 19. Servizi NIS2

`Inventario → Servizi NIS2` permette di censire i **servizi critici** richiesti dalla compliance NIS2:
- Nome servizio, descrizione, criticità (low/medium/high/critical)
- Asset coinvolti
- Responsabile tecnico, owner di business
- Dipendenze tra servizi

---

## 20. Network Services (DNS / DHCP / AdBlock)

Il gruppo **Network Services** gestisce in modo *attivo* DNS, DHCP e filtraggio tramite una **VM dedicata** (bridge che astrae Unbound, PowerDNS, AdGuard Home e Kea DHCP). È il modulo "service provider" della rete, distinto dalla sola lettura dei lease di §11.

> Se la VM Network Services non è installata, le pagine mostrano uno stato vuoto con il rimando a **Impostazioni → Moduli** per attivarla.

### Panoramica — `/network-services`

![Panoramica Network Services con stato dei servizi](/manual/img/network-services.png)

Stato di salute dei quattro sotto-servizi (Resolver, AdBlock, DNS autoritativo, DHCP) con pallini colorati (verde = ok, rosso = errore) e refresh automatico ogni 30s. Icone: 🌐 Globe (resolver), 🛡️ Shield (AdBlock), 🖥️ Server (DNS auth), 📶 Wifi (DHCP), 🔄 RefreshCw (aggiorna).

### DNS — `/dns`

Gestione DNS avanzata, a tab:
- **Panorama** — metriche (query/s, cache hit %, latenza percentili) e top domini interrogati
- **Zone** — zone forward/reverse (PowerDNS): elenco ed editor
- **Filtro** — regole di filtraggio AdGuard
- **Resolver** — configurazione upstream e cache (Unbound)

### DHCP — `/dhcp`

Gestione **Kea DHCP4**: scope, lease attivi, assegnazioni statiche (reservation), storico client.

---

## 21. Anomalie (Analytics)

La voce **Anomalie** in sidebar (icona ⚠️, badge rosso con il numero di anomalie *non gestite*) apre la pagina `/analytics`.

![Pagina Anomalie con filtri e tabella eventi](/manual/img/analytics.png)

### Tipi di anomalia rilevati automaticamente

| Tipo | Trigger |
|---|---|
| **MAC flip** | Stesso MAC visto su 2+ IP diversi (DHCP rotation o spoofing) |
| **Port change** | Stesso MAC migrato da una porta switch ad un'altra |
| **Latency anomaly** | RTT anomalo rispetto alla baseline (z-score) |
| **New unknown host** | Host nuovo non assegnato con classificazione `unknown` |
| **Uptime anomaly** | Calo improvviso di availability su un host/subnet |

### Cosa puoi fare

- **Filtri**: stato (Tutti / Non gestiti / Gestiti) e tipo
- 🔄 **Aggiorna** e ▶️ **Esegui check** (lancia subito il controllo anomalie)
- **Click su una riga** → dettaglio con i dati specifici del tipo (IP, MAC vecchio/nuovo, porte aggiunte/rimosse, latenza vs baseline, ecc.)
- **Segna come gestito** (acknowledge) → toglie l'anomalia dal badge

Job `anomaly_check` configurabile (default 15 min).

---

## 22. Launchpad e Integrazioni

Il **Launchpad** (`/launchpad`, icona 🔑) è il **punto unico** da cui vedi lo stato di tutti i moduli/integrazioni e li apri o configuri. Ha assorbito le vecchie viste "Integrazioni" e "Catalogo appliance": le route `/integrations` e `/appliance` ora **reindirizzano** qui.

![Launchpad con le tile dei moduli e lo stato di salute](/manual/img/launchpad.png)

### Tile moduli

Per ciascun modulo (es. **Wazuh**, **Vulnerabilità**, **Patch Management**, **Agenti remoti**, **Network Services**, **Graylog**) una tile mostra:
- Icona + nome del modulo
- **Stato di salute** (pallino): Attivo / Attenzione / Errore / Non configurato
- Tempo relativo dell'ultimo health check (es. "1h fa")
- Pulsanti **Apri** (URL esterno o route in-app) e **Configura** (deep-link a Impostazioni → Moduli)
- **Verdict** L7 quando disponibile (ok / degradato / fail)

L'health è in polling (≈60s). Le icone: 🛡️ ShieldAlert (Vulnerabilità), 📦 PackageCheck (Patch), 🖥️ ServerCog (Agenti), 📈 Activity (Monitoring), 📜 ScrollText (Graylog), 📡 Radar (Network Services), 🔧 Wrench (azione di ripristino).

### Dove si configurano le integrazioni

La configurazione vera e propria vive in **Impostazioni → Moduli/Integrazioni**: LibreNMS, Wazuh, Scanner-Edge, Network Services, Active Directory, Graylog. Il Launchpad è il cruscotto; le impostazioni sono il pannello di controllo.

---

## 23. Agenti remoti (Scanner-Edge)

`Agenti remoti` (`/agents`, **solo superadmin**, icona 🖥️ **ServerCog**) gestisce le appliance **Scanner-Edge** installate presso i clienti. Lo Scanner-Edge esegue le scansioni Greenbone/OpenVAS in loco e invia i findings all'hub (CVE → §14), raggiungibile via URL pubblico o **Tailscale**.

![Agenti remoti — tabella agenti e wizard di registrazione](/manual/img/agents.png)

### Tabella agenti

Colonne: Cliente, Sede/Label, Hostname:Porta, Versione, **Heartbeat**, Stato (badge verde con latenza / rosso con codice errore / outline se non testato). Azioni di riga: **Test** (PlugZap), **Configura** (Settings2), **Elimina** (Trash2). In alto: **Ricarica**, **Test All**, **Nuovo agente**.

### Wizard "Nuovo agente" (3 step)

1. **Tenant** — cliente esistente o nuovo (codice + ragione sociale)
2. **Agent** — label, hostname (nome breve Tailscale), porta, `subnet_match`
3. **Token** — il token è mostrato **una sola volta** (⚠️ ShieldAlert): copialo subito. Opzionale auth-key Tailscale; viene generato il **comando di installazione** (curl one-liner) da incollare sul nodo edge.

### Hub URL

Pannello di configurazione dell'**URL effettivo** dell'hub che gli agenti contattano: `public_hub_url` (URL pubblico) con fallback `hub_tailnet_hostname` (Tailscale). Se non configurato, il wizard avvisa che gli agenti non potranno fare heartbeat.

---

## 24. Scansioni — storico ed esecuzioni manuali

`Network → Scansioni` (`/scans`) mostra lo **storico delle scansioni** eseguite: tipo (badge), esito/stato, porte aperte, durata, data. È una vista di sola lettura delle ultime esecuzioni.

La gestione dei **job schedulati** (abilita/disabilita, interval, prossima esecuzione) e i log dettagliati sono gestiti dallo scheduler (`server.ts` + node-cron); per gli admin il dettaglio è in `MANUALE-SVILUPPATORE.md`.

---

## 25. Impostazioni

`Impostazioni` (in basso sidebar) è la pagina globale per:

### Utenti e ruoli
- Crea/modifica utenti (admin only)
- Ruoli: `superadmin`, `admin`, `user`
- Reset password, cambio username
- Multi-tenant access (quali tenant può vedere)

### Profilo Nmap
- Elenco porte TCP (obbligatorio)
- Elenco porte UDP (opzionale, richiede root)
- Community SNMP del profilo

### Credenziali globali fallback
- "Host Linux" globale per fallback SSH non-router

### Moduli / Integrazioni
- Attivazione e configurazione di **LibreNMS, Wazuh, Scanner-Edge, Network Services, Active Directory, Graylog, Patch Management**
- Lo stato runtime di questi moduli si vede nel **Launchpad** (§22)

### Scansione periodica
- Toggle global "Auto-scan subnet"
- Interval default per nuovi job

### Backup
- Trigger backup manuale (hub.db + tenant DB)
- Configurazione backup nightly (cron)
- Lista backup esistenti

### TLS / HTTPS
- Gestione certificato (self-signed via UI o upload custom)
- Install fisico via sudoers entry
- Vedi `MANUALE-SVILUPPATORE.md` per setup nginx reverse proxy

---

## 26. Ricerca globale

La **search bar in cima** cerca cross-tenant (su tutti i tenant a cui hai accesso) in:
- IP, MAC, hostname custom o rilevato
- Network device name, vendor, sysname
- Classificazione, OS, modello
- Asset tag, codice asset

Mostra fino a 50 risultati raggruppati per tipo (host / device / asset). Click → vai al dettaglio.

---

## 27. Export e Backup

### Export CSV

Discovery → pulsante ⬇️ esporta la **vista filtrata corrente** (rispetta filtri attivi e selezione bulk). Altre liste (Asset, Licenze, AD, Vulnerabilità, Software, ecc.) hanno il proprio pulsante Export con le colonne pertinenti.

### Backup

**Cron nightly** (default 03:00) crea uno snapshot di:
- `hub.db` (utenti, tenant, anagrafica)
- Tutti i DB tenant `tenants/[codice].db`

Conservazione: ultimi 7 backup. **Restore**: manuale via script `scripts/restore-from-backup.sh [data]`. **Backup manuale** da Impostazioni → Backup → "Esegui backup ora".

> **IMPORTANTE**: il backup NON include `.env.local` (per sicurezza). In disaster recovery serve ripristinare separatamente `ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, ecc.

---

## 28. Multi-tenant e Superadmin

DA-INVENT è single-server ma multi-tenant: una sola installazione gestisce N clienti separati.

### Modello tenant

Ogni tenant ha:
- Codice (es. `70791`)
- Nome, descrizione
- DB SQLite dedicato (`data/tenants/[codice].db`)
- Utenti con accesso definito in `user_tenant_access`

### Tenant switcher

In sidebar, sotto il blocco superadmin, dropdown per cambiare tenant attivo. "Tutti i clienti" mostra dati aggregati (solo superadmin).

### Voci solo per superadmin

- **Clienti** — CRUD tenant
- **Agenti remoti** — appliance Scanner-Edge installate presso i clienti (§23)

### Isolamento dati

I tenant non si vedono fra loro. Anche un admin di tenant A non può accedere a dati di tenant B. Solo il superadmin ha vista globale.

---

## 29. Manuale in-app

Voce sidebar **📖 Manuale** apre questo documento direttamente in-app, con renderer markdown integrato. Da lì puoi navigare:
- Questo manuale utente
- [Stati host e Discovery](STATI-HOST-E-DISCOVERY.md) (deep dive)
- [Manuale Active Directory](MANUALE-ACTIVE-DIRECTORY.md) e [Manuale WinRM](MANUALE-WINRM.md)
- ADR architetturali (`docs/adr/`)
- Playbook operativi (`docs/playbooks/`)

Il viewer mostra l'indice in sidebar laterale e il contenuto formattato a destra.

---

## 30. Appendice — Classificazioni dispositivi

Lista delle classificazioni supportate (ordine alfabetico):

| Codice | Etichetta UI | Tipo |
|---|---|---|
| `access_point` | Access Point | rete |
| `backup_server` | Backup Server | server |
| `bridge` | Bridge | rete |
| `controller` | Controller | OT |
| `database_server` | Database Server | server |
| `decoder` | Decoder | media |
| `dhcp_server` | DHCP Server | server |
| `dns_server` | DNS Server | server |
| `firewall` | Firewall | rete |
| `fotocopiatrice` | Fotocopiatrice | periferica |
| `hmi` | HMI | OT |
| `hypervisor` | Hypervisor | server |
| `iot` | IoT | endpoint |
| `load_balancer` | Load Balancer | rete |
| `mail_server` | Mail Server | server |
| `media_player` | Media Player | media |
| `modem` | Modem | rete |
| `multifunzione` | Multifunzione | periferica |
| `nas` / `nas_synology` / `nas_qnap` | NAS / Synology / QNAP | storage |
| `nfs_server` | NFS Server | server |
| `notebook` | Notebook | client |
| `ont` | ONT | rete |
| `plc` | PLC | OT |
| `proxy` | Proxy | rete |
| `repeater` | Repeater | rete |
| `rete_ot` | OT generica | OT |
| `router` | Router | rete |
| `scanner` | Scanner | periferica |
| `sensore` | Sensore | OT |
| `server` | Server (generico) | server |
| `server_linux` | Server Linux | server |
| `server_windows` | Server Windows | server |
| `smart_tv` | Smart TV | media |
| `smartphone` | Smartphone | mobile |
| `stampante` | Stampante | periferica |
| `storage` | Storage | storage |
| `switch` | Switch | rete |
| `tablet` | Tablet | mobile |
| `telecamera` | Telecamera | sicurezza |
| `unknown` | Sconosciuto | — |
| `ups` | UPS | infrastruttura |
| `vm` | VM | server |
| `voip` | Telefono VOIP | client |
| `vpn_gateway` | VPN Gateway | rete |
| `web_server` | Web Server | server |
| `workstation` | PC (workstation) | client |

Classificazione **manuale** (impostata dall'utente dalla scheda host) prevale sulla classificazione automatica del fingerprinting.

---

## Risorse correlate

- [Stati host e Discovery — deep dive](STATI-HOST-E-DISCOVERY.md)
- [Manuale Active Directory](MANUALE-ACTIVE-DIRECTORY.md)
- [Manuale WinRM](MANUALE-WINRM.md)
- [Manuale sviluppatore](MANUALE-SVILUPPATORE.md)
- [ADR architetturali](adr/)
- [Playbook operativi](playbooks/)
- [Changelog](../CHANGELOG.md)
