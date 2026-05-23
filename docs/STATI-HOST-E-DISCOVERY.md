# DA-INVENT — Stati Host, Discovery e Azioni rapide

> **Versione di riferimento:** 0.2.498
> **Aggiornato:** 2026-05-23
> Aggiunta al [MANUALE-UTENTE](./MANUALE-UTENTE.md) per le aree rivisitate nelle release v0.2.487 → v0.2.498.

Questo documento spiega:
- come è strutturato il menu di navigazione attuale
- la pagina **Discovery** e i suoi filtri rapidi
- il **modello di stati host** granulare (Online, Offline, Unreachable, Transient, Lost, Stale, Sconosciuto)
- i **pulsanti azione** disponibili per ogni riga
- come funziona il **motore di scan** che alimenta lo stato

---

## 1. Struttura del menu (sidebar)

Il menu laterale è organizzato in **gruppi collassabili** che riflettono il flusso operativo: prima si configura la rete, poi si esplora, infine si gestisce.

### Network *(collassabile)*
- **Subnet** — elenco e gestione delle subnet IP/CIDR sotto monitoraggio
- **Discovery** — vista unificata di tutti gli host scoperti su tutte le subnet (entry point principale)
- **Active Directory** — sincronizzazione e mappatura computer AD ↔ host
- **Credenziali** — credenziali centralizzate (SSH, WinRM, SNMP v2/v3, API token)
- *Diagnostica:*
  - **Tabella ARP** — mappature MAC → IP raccolte dai router
  - **Tabella DHCP** — lease attivi raccolti dai DHCP server
  - **Scansioni** — storico esecuzioni dei job di scan

### Inventario *(collassabile)*
- **Asset** — inventario fisico (PC, server, periferiche)
- **Assegnatari** — persone/dipartimenti a cui sono assegnati gli asset
- **Ubicazioni** — sedi e locali
- **Licenze** — licenze software
- **Servizi NIS2** — servizi critici per la compliance NIS2

### Top level
- **Dashboard** — KPI e widget di sintesi
- **Anomalie** — alert generati da analisi su MAC flip, port change, latency anomaly, ecc. (badge rosso con conteggio)
- **Integrazioni** — visibile solo se almeno un'integrazione esterna è configurata (LibreNMS, scanner-edge, ecc.)
- **Impostazioni** — configurazione globale

### Solo superadmin
- **Clienti** — gestione tenant
- **Agenti remoti** — appliance edge installati presso i clienti

> **Nota:** i dispositivi di rete (router, switch, firewall) NON sono più voci di menu separate. L'entry point per loro è **Discovery** con i chip filtro (vedi §3).

---

## 2. Pagina Discovery

`Network → Discovery` è la vista più importante: una **tabella unica** con tutti gli host rilevati in tutte le subnet del tenant corrente.

Per ogni host mostra (colonne configurabili dal menu colonne):
- IP, MAC, hostname, vendor
- Stato (vedi §4)
- Classificazione (server, workstation, printer, ecc.)
- Subnet di appartenenza, VLAN, sede
- Confidenza del fingerprinting
- Credenziali validate (verde = funzionanti)
- Conteggi CVE da scanner-edge
- DHCP/statico, in AD sì/no, multihomed
- Porte TCP/UDP aperte, OS rilevato
- Modello, seriale, firmware, asset tag, app scansionate
- Ultimo/primo visto

---

## 3. Filtri rapidi (chip preset)

Sopra la tabella Discovery c'è una **riga di chip** per filtrare per macro-categoria di device:

| Chip | Filtra `classification` IN | Contesto |
|---|---|---|
| **Tutti** | (nessun filtro) | reset |
| 🖥️ **Server** | `server`, `server_linux`, `server_windows` | tutti i server, indipendente dall'OS |
| 💻 **Client** | `workstation`, `notebook` | postazioni utente |
| 💾 **Hypervisor** | `hypervisor` | Proxmox/VMware/Hyper-V |
| 🔀 **Router** | `router` | router di livello L3 |
| 🔌 **Switch** | `switch` | switch L2 |
| 🛡️ **Firewall** | `firewall` | UTM, NGFW |

Ogni chip mostra il **conteggio** della categoria fra parentesi. Clic per attivare, clic di nuovo (o "Tutti") per disattivare.

I chip si combinano con gli altri filtri (Stato, Subnet, ricerca testuale) — sono tutti AND logici.

### Filtri secondari
- 🔎 **Ricerca testuale**: cerca in IP, MAC, hostname, vendor, network name, note, OS, manufacturer
- **Stato**: Online / Offline / Sconosciuto (filtra sul valore base, non sui sotto-stati derivati)
- **Subnet**: filtra per network
- **Classificazione**: dropdown con tutte le classificazioni presenti (più fine dei chip)
- **CVE**: critici/high, solo critici, qualunque finding

---

## 4. Stati Host (modello granulare)

Lo stato di un host è **derivato a display time** dal campo base `status` (online/offline/unknown nel DB) combinato con `last_seen` e l'intervallo del cron scan della sua subnet. Permette di distinguere a colpo d'occhio un down transitorio da uno fantasma.

### 7 stati visualizzati

| Badge | Etichetta | Condizione | Significato operativo |
|---|---|---|---|
| 🟢 verde pulsante | **Online** | `status=online`, ultima risposta recente | Risponde ora ai probe ICMP o TCP. Tutto OK. |
| 🟡 ambra | **Online (stale)** | `status=online`, `last_seen > 24h` | Risulta online ma da troppo tempo senza nuovi probe. Indica scan rotto o config incoerente. Da verificare. |
| 🔴 rosso | **Offline** | `status=offline`, down da < 4 cicli | Non ha risposto all'ultimo scan. Probabile down transitorio (riavvio, link flap). |
| 🟠 arancio | **Unreachable** | `status=offline`, down da ≥ 4 × scan interval | Persistente. Verifica alimentazione/cavo/firewall/rete. |
| 🟡 giallo scuro | **Transient** | `status=offline`, `last_seen ≥ 24h` | Down da ore/giorni. Spegnimento programmato, manutenzione, vacanze. |
| ⚫ grigio scuro | **Lost** | `status=offline`, `last_seen ≥ 7 giorni` | Probabilmente dismesso. Candidato a cleanup dall'inventario. |
| ⚪ grigio chiaro | **Sconosciuto** | `status=unknown` o nessun `last_seen` | Mai probato attivamente. Visto solo via ARP/DHCP/AD ma mai testato. |

### Calcolo soglia "Unreachable" per subnet

La soglia è **4 × interval_minutes** del job scan attivo sulla subnet:

| Interval cron | Soglia Unreachable |
|---|---|
| 15 min | **1 ora** (default attuale in produzione) |
| 30 min | 2 ore |
| 60 min | 4 ore |
| 120 min | 8 ore |

Se la subnet non ha job scan attivo, default = 30 min → soglia 2h.

### Tooltip

Al passaggio mouse sul badge appare un tooltip con:
- nome stato + spiegazione
- timestamp assoluto dell'ultimo contatto
- soglia unreachable calcolata per quella subnet

### Cosa NON cambia lo stato

Per evitare host fantasma "online", **le sorgenti passive** (ARP table del router, DHCP lease, sync AD) NON forzano lo stato a `online`. Le entry ARP/DHCP possono restare nel router per ore/giorni anche dopo che il device è spento, quindi non sono testimoni di reachability attuale.

Solo i **probe attivi** decidono lo stato:
- `network_discovery` (cron, manuale)
- `fast_scan` (cron, manuale)
- `ping` (manuale)

ARP/DHCP/AD aggiornano solo metadata (MAC, hostname, vendor, classification), non lo status.

---

## 5. Azioni per riga (colonna "Azioni")

Ogni riga di Discovery ha una colonna **Azioni** sempre visibile. I pulsanti cambiano in base a:
- se l'host è un host "puro" (rilevato passivamente)
- se l'host è stato **promosso a `network_device`** (cioè configurato come risorsa gestibile con credenziali) — colonna "Dispositivo" valorizzata

### Per un host puro (no device)

| Icona | Funzione | Endpoint |
|---|---|---|
| ✏️ **Modifica host** | Apre `/hosts/[id]` per editare hostname, classificazione manuale, note, asset tag | — |
| 🔑 **Test cred host** | Lancia un test credenziali sull'IP (probe diretto, sceglie credenziali compatibili) | `POST /api/hosts/[id]/...` |
| 🗑️ **Elimina host** | Rimuove la riga dal DB. Verrà ricreata al prossimo scan se ancora rilevata. | `DELETE /api/hosts/[id]` |

### Per un host promosso a device

| Icona | Funzione | Endpoint |
|---|---|---|
| ✏️ **Modifica device** | Apre `/devices/[device_id]` per gestire credenziali, vendor, scan target, ecc. | — |
| 🛡️ **Test credenziali device** | Verifica live le credenziali (SSH/WinRM/SNMP/API). Toast con risultato. Icona pulsa durante il test. | `GET /api/devices/[id]/test` |
| 🔄 **Riscansiona device** | Esegue una query completa (ARP, DHCP, port, sysinfo). Icona ruota durante l'operazione. Aggiorna la riga al termine. | `POST /api/devices/[id]/query` |
| 🔑 **Test cred host** | Test diretto sull'IP del device (per validare credenziali alternative) | — |
| 🗑️ **Elimina device** | Rimuove il `network_device` ma lascia l'host nel DB (chiede conferma). | `DELETE /api/devices/[id]` |

### Selezione multipla (bulk)

Spuntando le checkbox a sinistra appare la barra **Operazioni bulk** in alto con:
- **Modifica** — apre dialog per editare campi comuni (classificazione, vendor, sede, note, IP assignment) su N host insieme
- **Aggiorna selezionati** — esegue scan per ogni IP selezionato in serie (con dialog di progresso)
- **Crea asset NIS2** — promuove gli host selezionati come asset NIS2 con classificazione di servizio
- **Aggiungi a dispositivi** — promuove host → `network_device` in massa, con credenziali e protocollo comuni
- **Esporta CSV** — esporta la vista filtrata corrente

---

## 6. Motore di scan

### Tipi di scan e quando partono

| Scan type | Trigger | Cosa fa | Marca offline? |
|---|---|---|---|
| `fast_scan` | **Cron periodico** (15 min default), oppure manuale dalla pagina subnet | nmap -sn (o pingSweep) + second-pass TCP + ARP/DHCP poll dal router | ✅ |
| `network_discovery` | Manuale (UI o cron `ping_sweep`) | ICMP + second-pass TCP + Nmap quick TCP + SNMP sysObjectID + DNS | ✅ |
| `arp_poll` | Cron periodico, oppure interno a fast_scan | Legge ARP table dei router; aggiorna MAC/vendor; **non tocca status** | ❌ |
| `dhcp` | Cron, o interno a fast_scan | Legge lease DHCP; aggiorna hostname/MAC; **non tocca status** | ❌ |
| `nmap` | Manuale, host selezionati | Port scan completo TCP + UDP + OS fingerprint | additivo |
| `snmp` | Manuale, host selezionati | Walk SNMP per arricchimento sysName/sysDescr | ❌ |
| `windows`/`ssh` | Manuale, host selezionati | Inventory software via WinRM/SSH (richiede credenziali) | ❌ |
| `credential_validate` | Manuale | Solo test credenziali, no scan | ❌ |
| `vuln_sync` | Cron 30 min | Tira findings da scanner-edge | ❌ |
| `ad_sync` | Cron | Sync LDAP/AD computer objects | ❌ |
| `librenms_sync` | Cron | Sync con LibreNMS | ❌ |

### Algoritmo `network_discovery` / `fast_scan` (lo cuore del bug-fix v0.2.495)

1. **ICMP sweep** parallelo su tutti gli IP del CIDR
2. **Second-pass TCP**: per ogni host *già* `status=online` nel DB che NON ha risposto a ICMP, prova TCP su porte fallback `[22, 80, 443, 3389, 8080, 8443]` (timeout 2s). Se almeno una risponde → considerato online. Recupera device che bloccano ICMP (Windows con firewall default, stampanti, IoT).
3. **ARP/DHCP poll** dal router della subnet (se configurato) — solo per arricchire MAC/vendor, non per cambiare status
4. **Phase 4 offline marking (P1 strict)**: tutti gli IP del CIDR che non sono in `onlineIps` (ICMP + TCP fallback combinati) vengono marcati `status=offline`. Aggiunge anche una nota diagnostica.

### Configurazione schedulazione

Da **Scansioni** in sidebar puoi vedere lo storico e abilitare/disabilitare job. Per modificare l'intervallo o aggiungere job per subnet nuove, **Network → Subnet → [subnet] → Schedulazione** (oppure SQL diretto su `scheduled_jobs` se non c'è ancora UI dedicata).

> **Best practice attuale (produzione Domarc):** tutti i `fast_scan` a 15 min su tutte le subnet. Questo dà:
> - Stato "Offline" reale entro 15 min dal down
> - Stato "Unreachable" entro 1h
> - Carico contenuto (uno scan /24 prende 1-3 min)

---

## 7. Dispositivi di rete (`/devices/router`, `/devices/switch`, `/devices/firewall`)

Le pagine classificate **esistono ancora** per workflow specialistici che non sono inline in Discovery:
- Aggiungi dispositivo da zero (dialog con picker credenziali + protocollo)
- Aggiungi in bulk da host esistenti (promuovi più host → device insieme)
- Workflow Proxmox dedicato: scan Proxmox, visualizza risultati VM, abbina inventario, "Imposta come Proxmox"
- DHCP sync per MikroTik
- Bulk test credenziali su molti device insieme
- Bulk scan/query

Per le **azioni semplici per-riga** (modifica, test, riscan, elimina) è equivalente passare da Discovery — è più rapido perché ha tutti gli host insieme.

---

## 8. FAQ rapide

**Q: Vedo un host che ho spento ieri ancora con badge verde Online. Perché?**
A: Probabilmente è nella ARP table del router (che la tiene 4h-24h) e il cron `fast_scan` di quella subnet ha intervallo lungo (es. 60+ min). Aspetta 4 cicli e diventerà Unreachable, poi Transient.

**Q: Cosa significa "Online (stale)"?**
A: Lo stato base è `online` ma `last_seen` è > 24h. Indica che la subnet non viene scansionata da troppo tempo (job disabilitato, cron rotto, network unreachable). Da investigare.

**Q: Ho un host "Lost" da settimane. Lo elimino?**
A: Sì, il badge "Lost" è esattamente il candidato cleanup. Clicca 🗑️ Elimina host. Se per qualche motivo l'host torna online in futuro, sarà ricreato al prossimo scan con `first_seen` nuovo.

**Q: Posso forzare uno scan ora invece di aspettare il cron?**
A: Sì:
- Per una singola subnet: **Network → Subnet → [subnet] → Scansiona**
- Per host selezionati: spunta i checkbox in Discovery → **Aggiorna selezionati**

**Q: Perché lo stato Online ha il pulse verde, mentre Unreachable no?**
A: Il pulse indica "vivo, sta rispondendo ora". Tutti gli stati offline (Offline/Unreachable/Transient/Lost) sono "statici" — non lampeggiano per non disturbare visivamente in dashboard con molti device offline.

**Q: I chip filtro contano solo gli host visibili o tutti?**
A: Contano tutti gli host del tenant corrente, indipendentemente dagli altri filtri attivi. Permettono di vedere la distribuzione reale per categoria.

**Q: Cosa fa il pulsante "Modifica" sulla riga?**
A: Apre `/hosts/[id]` per host puri o `/devices/[id]` per host promossi a network_device. Da lì puoi editare tutti i campi (nome, classificazione, sede, note, credenziali, vendor, ecc.).

**Q: Test credenziali host vs Test credenziali device?**
A: **Host**: prova credenziali compatibili dal pool tenant contro l'IP grezzo. **Device**: usa specificamente le credenziali legate a quel `network_device` (binding già fatto). Per device promossi, preferisci il test device.

---

## 9. Riferimenti tecnici

- Codice motore scan: [src/lib/scanner/discovery.ts](../src/lib/scanner/discovery.ts)
- Definizione stati derivati: [src/components/shared/status-badge.tsx](../src/components/shared/status-badge.tsx)
- Cron jobs: [src/lib/cron/jobs.ts](../src/lib/cron/jobs.ts), [src/lib/cron/scheduler.ts](../src/lib/cron/scheduler.ts)
- API host per Discovery: [src/app/api/hosts/discovery/route.ts](../src/app/api/hosts/discovery/route.ts)
- Pagina Discovery: [src/app/(dashboard)/discovery/page.tsx](../src/app/(dashboard)/discovery/page.tsx)
- Schema DB tenant: [src/lib/db-tenant-schema.ts](../src/lib/db-tenant-schema.ts)
