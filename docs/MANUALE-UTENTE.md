# DA-INVENT — Manuale utente

> **Versione di riferimento:** 0.2.x  
> **Ultima modifica:** Marzo 2026  
> Prodotto open source di [Domarc](https://domarc.it). Per i fork pubblici è richiesta attribuzione (vedi `LICENSE`).

---

## Indice

1. [Primo avvio e setup](#1-primo-avvio-e-setup)
2. [Login e navigazione](#2-login-e-navigazione)
3. [Dashboard](#3-dashboard)
4. [Gestione Subnet (Reti)](#4-gestione-subnet-reti)
5. [Scansioni e Discovery](#5-scansioni-e-discovery)
6. [Host e Indirizzi IP](#6-host-e-indirizzi-ip)
7. [Dispositivi di Rete (Router, Switch, Hypervisor)](#7-dispositivi-di-rete-router-switch-hypervisor)
8. [Tabella ARP e Mappatura MAC-IP](#8-tabella-arp-e-mappatura-mac-ip)
9. [Credenziali](#9-credenziali)
10. [Inventario Asset](#10-inventario-asset)
11. [Licenze Software](#11-licenze-software)
12. [Job Schedulati](#12-job-schedulati)
13. [Impostazioni](#13-impostazioni)
14. [Ricerca Globale](#14-ricerca-globale)
15. [Export e Backup](#15-export-e-backup)

---

## 1. Primo avvio e setup

Al **primo accesso** (nessun utente nel database) l'app mostra la pagina `/setup`.

**Campi richiesti:**
- Username (min 3 caratteri)
- Password (min 8 caratteri)
- Conferma password

Dopo la creazione del primo account (ruolo `admin`), si viene reindirizzati al login.

> **Nota:** la pagina `/setup` è accessibile solo se non esistono utenti. Una volta completato il setup non è più raggiungibile.

---

## 2. Login e navigazione

### Login

URL: `http://<indirizzo-server>:3001/login`

Inserire username e password. In caso di **5 tentativi errati** in 15 minuti per lo stesso username, il sistema blocca temporaneamente i tentativi (rate limiting).

### Struttura navigazione (sidebar sinistra)

| Voce | Sotto-voci |
|------|-----------|
| **Dashboard** | — |
| **Network** | Subnet, Router, Switch, Tabella ARP, Credenziali, Scansioni |
| **Dispositivi** | PC, Notebook, VM, Server, Access Point, Switch, Router, Firewall, Storage, Hypervisor, IoT, Stampanti, Telecamere, Telefoni |
| **Inventario** | Asset, Assegnatari, Licenze |
| **Impostazioni** | — |

Su **mobile** la sidebar è nascosta: aprirla con l'icona hamburger in alto a sinistra.

---

## 3. Dashboard

La dashboard è la schermata principale con una panoramica dello stato della rete.

### Card statistiche

| Card | Significato |
|------|------------|
| **Subnet** | Numero di reti gestite |
| **Host Totali** | Host rilevati in tutte le reti |
| **Online** | Host raggiungibili nell'ultimo ping |
| **Offline** | Host noti ma non raggiungibili |
| **Sconosciuti** | Host senza uno stato definito (mai scansionati) |

### Grafico Online nel Tempo

Mostra l'andamento del numero di host online nelle ultime ore/giorni. Aggiornato automaticamente.

### Monitoraggio Attivo

Mostra gli **host conosciuti** (con flag "Host conosciuto" attivo):
- Quanti sono online/offline
- Latenza media di risposta
- Lista host offline in allerta (con link diretto alla scheda)

### Griglia Subnet

Per ogni rete: barra proporzionale online/offline/unknown, totale host, link al dettaglio.

### Attività Recente

Ultime 10 scansioni eseguite con tipo e data.

---

## 4. Gestione Subnet (Reti)

### Elenco reti (`/networks`)

Tabella con: CIDR, Nome, VLAN, Posizione, Host totali, Online/Offline, Ultima scansione.

### Aggiungere una rete

Cliccare **"Aggiungi Subnet"** (pulsante in alto a destra).

**Campi disponibili:**

| Campo | Obbligatorio | Descrizione |
|-------|:---:|---------|
| CIDR | ✓ | Indirizzo di rete in formato CIDR (es. `192.168.1.0/24`) |
| Nome | ✓ | Nome identificativo della subnet |
| Descrizione | — | Descrizione estesa |
| Gateway | — | IP del gateway principale (es. `192.168.1.1`) |
| VLAN ID | — | ID VLAN (1-4094) |
| Posizione | — | Sede/edificio/stanza |
| DNS Server | — | Server DNS personalizzato per questa rete |
| SNMP Community | — | Community SNMP per scan su questa rete |
| Router ARP | — | Router che fornisce la tabella ARP per questa subnet |

> **Overlap CIDR:** Il sistema impedisce di creare reti con CIDR sovrapposto a reti già esistenti.

**Aggiungere un router al volo:** Nel campo "Router ARP" è disponibile il pulsante **"Aggiungi router"** che apre un modale per registrare il dispositivo prima ancora di chiudere il form rete.

### Modifica rete

Dal dettaglio rete (`/networks/[id]`), pulsante **matita** → dialog di modifica con gli stessi campi della creazione.

### Eliminazione rete

Pulsante cestino nella lista reti. **Operazione irreversibile**: elimina anche tutti gli host associati.

### Dettaglio rete (`/networks/[id]`)

**Griglia IP:** ogni IP della subnet è visualizzato come cella colorata:
- 🟢 Verde: online
- 🔴 Rosso: offline  
- ⬜ Grigio chiaro: sconosciuto
- ⬜ Grigio scuro: non in database

Cliccando una cella si apre la scheda host.

**Lista host:** tabella completa con IP, stato, MAC, vendor, hostname, classificazione, porte aperte, dispositivo collegato.

---

## 5. Scansioni e Discovery

### Tipi di scansione

| Tipo | Cosa fa |
|------|---------|
| **ping** | Sweep ICMP su tutti gli IP della subnet. Aggiorna stato online/offline e rileva nuovi host |
| **snmp** | Query SNMP (community della rete) sugli host in DB. Rileva sysName, sysDescr, model, serial |
| **nmap** | Port scan TCP/UDP. Richiede `nmap` installato sul server. Rileva porte aperte e OS. La parte **UDP** (`-sU`) richiede in genere **privilegi root** sul processo (nel container il servizio systemd è configurato di conseguenza) |
| **arp_poll** | Acquisisce la tabella ARP dal router assegnato alla rete. Aggiorna MAC e associazioni IP-MAC |
| **dns** | Risoluzione reverse (PTR) e forward (A) per tutti gli host della rete |
| **windows** | Connessione WinRM agli host Windows (porte 445/5985/5986) per raccogliere hostname |
| **ssh** | Connessione SSH agli host Linux per raccogliere hostname e info OS |

### Avviare una scansione

Dal dettaglio rete:
1. Selezionare il **tipo di scansione** dal menu a tendina
2. (Solo per nmap) Selezionare il **profilo nmap** (Quick, Standard, Completo, Personalizzato)
3. Cliccare **"Avvia Scansione"**

La barra di progresso mostra in tempo reale: fase, IP elaborati/totale, host trovati, log live.

### Profili Nmap

Configurabili in **Impostazioni → Profili Nmap**:

| Profilo | Argomenti |
|---------|-----------|
| Quick | `-sn` (solo discovery, nessun port scan) |
| Standard | Top 100 porte TCP |
| Completo | Top 1000 porte TCP + versione servizi |
| Personalizzato | Definibile dall'utente |

---

## 6. Host e Indirizzi IP

### Scheda host (`/hosts/[id]`)

Accessibile cliccando l'IP in qualsiasi tabella, o la cella nella griglia IP.

#### Informazioni di rete (automatiche)
- Indirizzo IP, MAC address, vendor OUI, hostname
- DNS forward e reverse
- Sistema operativo, modello
- Primo rilevamento e ultimo contatto
- Stato corrente (Online/Offline/Sconosciuto)

#### Campi personalizzati (editabili manualmente)

| Campo | Descrizione |
|-------|------------|
| **Host conosciuto** | Toggle per attivare il monitoraggio attivo (ping periodico, allerta in dashboard) |
| **Nome personalizzato** | Alias leggibile (es. "Server web principale") |
| **Classificazione** | Tipo dispositivo: PC, Notebook, Server, Switch, Router, Firewall, ecc. |
| **Codice inventario** | Riferimento all'inventario fisico (es. "INV-2024-001") |
| **Note** | Note libere |
| **Porte di monitoraggio** | Porte TCP da controllare nel monitoring attivo (es. `22, 80, 443`). Se non configurate, il sistema usa porte note (80, 22, 443, 3389) |

#### Sezioni dati

**Porte aperte:** badge con numero porta (UDP in blu).

**Dispositivo gestito:** se l'IP coincide con un network device registrato, mostra il link.

**Connessione di rete:** 
- Quale router ha fornito il MAC via ARP
- A quale porta dello switch è collegato (da MAC table)
- VLAN di appartenenza

**Grafico latenza:** andamento latenza ping nell'ultimo periodo.

**Timeline Uptime:** visualizzazione grafica online/offline per slot temporali (ultime 24h o 7gg).

**Storico scansioni:** ultime scansioni con tipo, risultato, porte trovate, durata.

---

## 7. Dispositivi di Rete (Router, Switch, Hypervisor)

I dispositivi di rete sono apparati gestiti attivamente dal sistema: il sistema si connette a loro per acquisire dati (tabella ARP, MAC table, porte switch, info sistema).

### Aggiungere un dispositivo (`/devices`)

Pulsante **"Aggiungi Dispositivo"** o, più direttamente, da una scheda host → menu **⋮** → "Aggiungi come Router/Switch".

**Campi:**

| Campo | Descrizione |
|-------|------------|
| **Tipo** | Router, Switch, Hypervisor |
| **Nome** | Nome identificativo |
| **IP** | Indirizzo IP del dispositivo |
| **Vendor** | MikroTik, Ubiquiti, Cisco, HP (ProCurve/Comware), Omada, Stormshield, Proxmox, VMware, Linux, Windows, Synology, QNAP, Altro |
| **Protocollo** | SSH, SNMP v2, SNMP v3, API REST, WinRM |
| **Porta** | Porta di connessione (default: 22 SSH, 161 SNMP, 8006 Proxmox) |
| **Credenziale archivio** | Credenziale SSH/API salvata nell'archivio (preferibile) |
| **Username / Password** | Credenziali inline (alternativa all'archivio) |
| **Credenziale SNMP** | Community SNMP dall'archivio |
| **Community SNMP** | Community inline |

### Scheda dispositivo (`/devices/[id]`)

**Header:** nome, tipo, classificazione, vendor, IP:porta, protocollo.

**Pulsanti azione:**
- **"Test Connessione"** — verifica raggiungibilità e autenticazione
- **"Aggiorna Dati"** — interroga il dispositivo e aggiorna tutte le informazioni (ARP, MAC, porte, info sistema)
- **"Modifica"** — apre dialog di modifica

#### Tab "Tabella ARP" (router)
Voci acquisite dall'ARP table del router: IP, MAC, interfaccia, link all'host associato, timestamp.

#### Tab "Schema Porte" (switch)
Per ogni porta: icona tipo (trunk/access/SFP), stato (up/down/disabilitata), velocità, duplex, VLAN, stato STP (Forwarding/Blocking/Designated), watt PoE (se attivo), dispositivo neighbor collegato (LLDP/CDP).

#### Tab "MAC Table" (switch)
MAC address appresi su ogni porta: MAC, porta, VLAN, host associato.

#### Tab "Neighbor" (switch)
Dispositivi adiacenti rilevati via LLDP/CDP: nome, porta locale, porta remota, tipo dispositivo.

#### Dati sistema (router/switch con SSH)
sysName, sysDescr, firmware, serial_number.

#### Dati Windows (dispositivi WinRM)
Sistema operativo, hardware (CPU, RAM, dischi con utilizzo), schede di rete, licenza, servizi, software installato, utenti locali, hotfix.

#### Dati Proxmox (hypervisor)
Stato nodo, lista VM/CT con risorse, licenza subscription, dettagli hardware.

#### Spanning Tree (switch)
Bridge ID, root bridge ID, priority, costi, porte, hello/forward/max-age time. Badge **ROOT BRIDGE** se questo switch è la radice STP.

### Classificazioni dispositivi

I dispositivi host vengono classificati automaticamente in base a:
- OID SNMP (Cisco, HP, MikroTik, ecc.)
- Parole chiave in sysDescr (router, switch, access point, printer, camera, NAS…)
- Porte aperte (3389 → workstation, 631 → stampante, 22 → server/router…)

La classificazione è modificabile manualmente dalla scheda host.

---

## 8. Tabella ARP e Mappatura MAC-IP

### Tabella ARP Cumulativa (`/arp-table`)

Raccoglie **tutte** le voci ARP acquisite da router e switch nel tempo. Permette di:
- Tracciare la storia IP di un MAC address (colonna "IP precedente")
- Identificare dispositivi spostati tra subnet
- Trovare un IP a partire dal MAC o viceversa

**Filtri disponibili:** ricerca testo (MAC, IP, hostname), rete, sorgente (ARP/DHCP/Host/Switch).

**Sorgenti:**
- **ARP** — acquisita dalla tabella ARP del router
- **DHCP** — da lease DHCP (MikroTik)
- **Host** — associata allo scan host
- **Switch** — dalla MAC table dello switch

---

## 9. Credenziali

Le credenziali riutilizzabili (`/credentials`) permettono di centralizzare le credenziali di accesso ai dispositivi. Sono cifrate con AES-256-GCM (mai in chiaro nel DB).

### Tipi

| Tipo | Uso tipico |
|------|-----------|
| **ssh** | Router, switch, server Linux via SSH |
| **snmp** | Dispositivi SNMP (community string) |
| **api** | Proxmox, Omada Controller, API REST |
| **windows** | WinRM per host Windows |
| **linux** | SSH per host Linux |

### Test credenziale

Dal pulsante **"Testa"** nella lista o dalla scheda credenziale: inserire IP e porta target → il sistema tenta una connessione reale e riporta il risultato.

### Utilizzo

Le credenziali si assegnano ai dispositivi di rete (campo "Credenziale SSH" e "Credenziale SNMP") o alle impostazioni globali per scan di massa su host Windows/Linux.

**Priorità:** una credenziale da archivio ha sempre la precedenza sulle credenziali inline del dispositivo.

---

## 10. Inventario Asset

Il modulo inventario permette di gestire il ciclo di vita completo degli asset fisici e virtuali.

### Lista asset (`/inventory`)

**Filtri:** ricerca testo, categoria, stato.

**Sincronizzazione rapida:**
- **"Da dispositivi di rete"** — crea/aggiorna automaticamente un asset per ogni network device registrato
- **"Da host"** — crea/aggiorna un asset per ogni host con "Host conosciuto" attivo

**Export CSV** → download con tutti i campi.

### Scheda asset (`/inventory/[id]`)

Campi organizzati in sezioni:

| Sezione | Campi principali |
|---------|-----------------|
| **Identificazione** | Asset Tag (generato automaticamente), S/N, collegamento a device/host |
| **Classificazione** | Nome prodotto, categoria (Desktop/Laptop/Server/Switch/Firewall/NAS/Stampante/VM/Licenza/Access Point/Router/Other), marca, modello, P/N |
| **Assegnazione** | Assegnatario, sede, reparto, posizione fisica, data assegnazione |
| **Ciclo vita** | Stato (Attivo/In magazzino/In riparazione/Dismesso/Rubato), data acquisto/installazione/dismissione, vita utile prevista |
| **Garanzia** | Fine garanzia, fine supporto, tipo garanzia, contratto supporto, prossima manutenzione |
| **Specifiche** | OS, CPU, RAM GB, storage GB/tipo, MAC, IP, VLAN, firmware |
| **Finanziario** | Prezzo acquisto, fornitore, N° ordine/fattura, valore attuale, metodo ammortamento, centro di costo |
| **Sicurezza/Compliance** | Crittografia disco, antivirus, MDR, classificazione dati (Pubblico/Interno/Confidenziale/Riservato), in scope GDPR, in scope NIS2, ultimo audit |
| **Note tecniche** | Note libere, dati tecnici JSON |

#### Tab Audit Log

Ogni modifica all'asset è tracciata: campo modificato, valore precedente, valore nuovo, utente, data/ora. Utile per compliance GDPR/NIS2.

### Assegnatari (`/inventory/assignees`)

Persone fisiche a cui assegnare gli asset: nome, email, telefono, note. CRUD completo.

---

## 11. Licenze Software

Il modulo licenze gestisce il parco licenze software.

### Campi principali

- Nome prodotto, fornitore
- Numero seriale / chiave
- Seats totali (numero posti licenza)
- Data scadenza, data acquisto
- Costo acquisto
- Note

### Assegnazione posti

Da ogni licenza è possibile assegnare i posti a:
- **Asset** inventario
- **Assegnatari** (persone)

Il sistema mostra quanti posti sono usati vs totali.

---

## 12. Job Schedulati

I job schedulati automatizzano le operazioni di monitoraggio e acquisizione dati.

### Tipi di job

| Tipo | Cosa fa |
|------|---------|
| **ping_sweep** | Esegue sweep ICMP su una rete (o tutte) per aggiornare lo stato host |
| **snmp_scan** | Query SNMP sugli host per aggiornare info dispositivo |
| **nmap_scan** | Port scan nmap |
| **arp_poll** | Acquisisce ARP e MAC table da tutti i dispositivi abilitati |
| **dns_resolve** | Risoluzione DNS per tutti gli host |
| **known_host_check** | Ping (o TCP) su host conosciuti con flag attivo. Alimenta la timeline uptime |
| **cleanup** | Rimuove host non visti da X giorni |

### Configurazione (`/settings` → tab "Job Schedulati")

1. Cliccare **"Nuovo Job"**
2. Scegliere tipo, rete (opzionale, se vuota agisce su tutte), intervallo in minuti
3. Il job viene attivato immediatamente nello scheduler

**Intervalli predefiniti:** 5, 15, 30, 60, 360, 1440 minuti (max 1 settimana = 10080 min).

Lo scheduler usa `node-cron` avviato da `server.ts` in produzione. Con `npm run dev` i job **non** vengono eseguiti; usare `npm run dev:server` per il server completo con scheduler.

---

## 13. Impostazioni

### Tab Generale

- **Porta server:** porta HTTP (default 3001). Richiede riavvio del servizio.
- **Credenziale host Windows:** credenziale globale per scan WinRM di massa
- **Credenziale host Linux:** credenziale globale per scan SSH di massa
- **Cambio password:** inserire password corrente, nuova password (min 8 caratteri)

### Tab Utenti

- Lista utenti: username, ruolo, creato il, ultimo accesso
- **Crea utente:** username, password, ruolo (admin/viewer)
- **Azioni:** promuovi/declassa, elimina utente
- **Ruoli:** `admin` può modificare tutto; `viewer` può solo leggere (tutti i GET, nessun POST/PUT/DELETE)

### Tab HTTPS

- **Stato TLS:** mostra se abilitato, certificato presente, soggetto, data scadenza
- **Genera certificato self-signed:** inserire dominio/IP, durata in giorni → genera automaticamente
- **Importa certificato esterno:** incollare PEM certificato e chiave privata

### Tab Profili Nmap

- Lista profili con comando nmap completo visualizzato
- **Crea/modifica profilo:** nome, descrizione, argomenti nmap personalizzati oppure "porte custom" (aggiunge top 100 TCP + porte specificate + UDP noti + SNMP)
- **Custom OUI:** textarea per sovrascrivere/aggiungere vendor per prefissi MAC. Formato: `AABBCC Nome Vendor` (una riga per prefisso). Utile per dispositivi non nel database OUI standard.

### Tab Job Schedulati

Vedi [sezione 12](#12-job-schedulati).

### Tab Gestione Dati

- **Export host CSV:** download `hosts_export.csv` con IP, MAC, vendor, hostname, stato, porte
- **Backup database:** download del file SQLite (`ipam.db`) per backup manuale
- **Reset configurazione:** elimina reti, host, dispositivi, ARP, MAC table. **Mantiene** utenti e impostazioni. Irreversibile.

---

## 14. Ricerca Globale

Accessibile con **Cmd+K** (Mac) o **Ctrl+K** (Windows/Linux) da qualsiasi pagina.

Cerca in tempo reale (min 2 caratteri, debounce 300ms) in:
- Subnet (per CIDR, nome, posizione)
- Host (per IP, MAC, hostname, nome personalizzato)

Risultati divisi per categoria. Navigazione con ↑↓, selezione con Enter, chiudi con Escape.

---

## 15. Export e Backup

### Export host CSV

Impostazioni → Gestione Dati → **"Export CSV"** (o direttamente `GET /api/export`).

Campi: IP, MAC, vendor OUI, hostname, DNS reverse, DNS forward, stato, porte aperte, classificazione, last_seen, rete.

### Export inventario CSV

Inventario → Lista asset → pulsante **"Export CSV"**.

Campi: tutti i campi dell'asset (50+).

### Backup database

Impostazioni → Gestione Dati → **"Scarica Backup DB"**.

Scarica il file `ipam.db` (SQLite). Tenere in luogo sicuro: contiene tutte le credenziali cifrate.

**Backup automatico (script):**

```bash
cd /opt/da-invent
./scripts/backup.sh
```

I backup vengono compressi con gzip e salvati in `data/backups/`. La retention default è 7 giorni.

**Backup da nodo Proxmox** (copia DB dal CT al Mac per debug):

```bash
npm run pull:db   # richiede conferma YES — sovrascrive il DB locale
```

---

## Appendice — Classificazioni Dispositivi

| Slug | Label |
|------|-------|
| `workstation` | PC / Workstation |
| `notebook` | Notebook / Laptop |
| `server` | Server |
| `vm` | Macchina Virtuale |
| `switch` | Switch |
| `router` | Router / Gateway |
| `access_point` | Access Point |
| `firewall` | Firewall |
| `hypervisor` | Hypervisor |
| `storage` | Storage / NAS |
| `voip` | Telefono VoIP |
| `iot` | Dispositivo IoT |
| `stampante` | Stampante |
| `telecamera` | Telecamera IP |
| `unknown` | Sconosciuto |
