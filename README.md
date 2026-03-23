# DA-INVENT

<p align="center">
  <strong>Domarc</strong> · <a href="https://domarc.it">domarc.it</a>
</p>

Sistema di **IP Address Management (IPAM)** e **inventario asset** basato su Next.js 16. Gestisce reti IPv4, host, dispositivi di rete (router, switch, hypervisor), acquisizione ARP/MAC, mappatura porte switch, scansioni (ping, nmap, SNMP), job schedulati, credenziali cifrate e modulo inventario con licenze e assegnatari.

Il codice sorgente è **rilasciato in forma open source** (vedi [`LICENSE`](LICENSE)): puoi usare, studiare e modificare il software liberamente. Se pubblichi un **fork** o una **derivata** verso terzi (repository pubblico, prodotto o servizio), è richiesto un **riferimento esplicito** al progetto originale **DA-INVENT**, al brand **Domarc** e al repository canonico — come indicato nel file di licenza.

**Indice**

1. [Panoramica e architettura](#panoramica-e-architettura)  
2. [Requisiti](#requisiti)  
3. [Tre scenari di installazione (Proxmox, VM Linux, container)](#tre-scenari-di-installazione-proxmox-vm-linux-container)  
4. [Installazione Proxmox (una riga)](#installazione-proxmox-una-riga)  
5. [Installazione su Debian/Ubuntu (VM, bare metal, container)](#installazione-su-debianubuntu-vm-bare-metal-container)  
6. [Script di installazione e variabili d’ambiente](#script-di-installazione-e-variabili-dambiente)  
7. [Primo avvio e configurazione](#primo-avvio-e-configurazione)  
8. [Funzionalità dell’applicazione](#funzionalità-dellapplicazione)  
9. [Allineamento al documento di requisiti funzionali](#allineamento-al-documento-di-requisiti-funzionali)  
10. [Job schedulati e server di produzione](#job-schedulati-e-server-di-produzione)  
11. [Sicurezza](#sicurezza)  
12. [API e dati](#api-e-dati)  
13. [Documentazione in `docs/`](#documentazione-in-docs)  
14. [Deploy in produzione](#deploy-in-produzione)  
15. [Sviluppo](#sviluppo) (include copia locale da Git)  
16. [Aggiornamento](#aggiornamento)  
17. [Versioning](#versioning)  
18. [Licenza](#licenza)  

---

## Panoramica e architettura

| Componente | Ruolo |
|------------|--------|
| **Next.js 16 (App Router)** | UI dashboard, route API sotto `src/app/api/` |
| **`server.ts`** | Avvio in produzione: integra Next + **node-cron** per job schedulati (`src/lib/cron/`) |
| **SQLite** (`data/ipam.db`) | Persistenza: reti, host, device, ARP, porte, inventario, utenti, job, impostazioni |
| **NextAuth v5** | Login con credenziali, JWT in cookie HttpOnly, ruoli (es. admin / viewer) |

- In **sviluppo** si può usare solo `npm run dev` (senza cron) oppure `npm run dev:server` (con scheduler).  
- In **produzione** usare `npm run start` (o unità systemd che invoca `tsx server.ts`).

---

## Requisiti

| Componente | Note |
|------------|------|
| **Node.js** | 20 o superiore |
| **SQLite 3** | File DB in `data/` (directory esclusa da Git) |
| **nmap** | Scansioni porte/OS |
| **Python 3 + venv WinRM** | Opzionale, per WinRM su host Windows. `scripts/install.sh` crea `~/.da-invent-venv` e installa: `pywinrm`, `requests-ntlm`, `requests-credssp`, `gssapi` (Kerberos opzionale). Variabili: `WINRM_PYTHON`, `WINRM_TRANSPORT` (vedi `.env.example`) |
| **Sistema** | Debian/Ubuntu consigliati per script `install.sh` (apt) |

Per **scansioni nmap** (inclusa **UDP `-sU`**) e **ping ICMP** servono in genere **socket privilegiati**. Nel **container LXC/VM** il servizio systemd è quindi previsto in esecuzione come **`root`** (default di `scripts/install.sh` e di `deploy/da-invent.service`), così `nmap` non viene eseguito senza i diritti necessari. Un container **non privilegiato** può comunque bastare se accetti solo scan TCP; per UDP serve **root** nel CT oppure capability `CAP_NET_RAW` / `CAP_NET_ADMIN` su un utente dedicato (configurazione avanzata).

Oltre a Node e agli strumenti di scansione, in **produzione** servono i **pacchetti di sviluppo** per compilare moduli nativi npm (`better-sqlite3`, `bcrypt`, `ssh2`, `net-snmp`, …): `build-essential`, `pkg-config`, `libssl-dev`, `libsqlite3-dev`, `libsnmp-dev` (installati automaticamente da `scripts/install.sh` come **root** su Debian/Ubuntu).

---

## Tre scenari di installazione (Proxmox, VM Linux, container)

Gli script ufficiali presuppongono **Debian o Ubuntu** (apt). Il codice viene sempre preso da **Git** (repository pubblico o fork): o lo scarica uno **script di bootstrap** da GitHub, oppure esegui tu `git clone` e poi `install.sh`.

| # | Scenario | Dove esegui i comandi | Installer «facilitato» | Alternativa: solo Git + `install.sh` |
|---|----------|------------------------|-------------------------|--------------------------------------|
| **1** | **Proxmox VE** — crei un **container LXC** dal nodo | Shell **root** sul **nodo** Proxmox (mai nel CT per il wizard) | `bootstrap-proxmox.sh` → scarica il repo sul nodo e lancia `proxmox-lxc-install.sh` (wizard **pct**). Nel CT puoi rispondere **sì** all’installazione automatica: viene fatto `git clone` in `/opt/da-invent` ed eseguito `install.sh --systemd` | Sul nodo: hai già il clone → `./scripts/proxmox-lxc-install.sh`. **Dentro il CT** (se non hai usato l’auto-install): `bootstrap-linux.sh` oppure `git clone` + `./scripts/install.sh --systemd` |
| **2** | **VM o bare metal** — Linux **Debian/Ubuntu** come sistema operativo «principale», **senza** creare un CT in questa guida | Shell **root** (o `sudo`) **dentro la VM o sul server fisico** | `bootstrap-linux.sh` (una riga con `curl` da raw GitHub): installa il minimo, **clona** il repo in `/opt/da-invent`, lancia `install.sh --systemd` | `git clone https://github.com/grandir66/DA-IPAM.git /opt/da-invent` poi `chmod +x scripts/install.sh && sudo ./scripts/install.sh --systemd` |
| **3** | **Container Linux** (stesso percorso dello scenario 2, ma **dentro** il CT) — es. CT già esistente, LXC su altro host, o ambiente containerizzato con OS Debian/Ubuntu | Shell **root** **dentro il container** | Stesso **`bootstrap-linux.sh`** da eseguire nel container (serve rete verso GitHub e NodeSource) | Stesso **`git clone`** + **`install.sh`** nel container |

Note operative:

- **Scenario 1 vs 3:** sul **nodo** Proxmox usi solo il **wizard** (`proxmox-lxc-install.sh`) per definire template, disco, rete e privilegi del CT. **Dopo** che il CT esiste, l’installazione dell’applicazione è **identica** allo scenario 3 (comandi **dentro** il CT): `bootstrap-linux.sh` oppure clone manuale + `install.sh`.
- **`install.sh`** è sempre il passo che installa dipendenze apt, Node.js 20, moduli npm (con build nativa), `npm run build`, `.env.local` e opzionalmente **systemd** (`tsx server.ts` + cron).
- **Aggiornamenti** dopo il deploy: `./scripts/update.sh` nell’istanza (es. `/opt/da-invent`); da **nodo** Proxmox verso un CT: `./scripts/pct-update.sh <VMID>`.

---

## Installazione Proxmox (una riga)

**Scenario [1](#tre-scenari-di-installazione-proxmox-vm-linux-container)** — solo sul **nodo** Proxmox: creazione del CT e (opzionale) installazione automatica **dentro** il CT tramite `git clone` + `install.sh`.

Sul **nodo Proxmox VE**, come **root**, esegui (script salvato su disco — **non** usare `curl … | bash` per non interferire con le domande interattive):

```bash
curl -fsSL https://raw.githubusercontent.com/grandir66/DA-IPAM/main/scripts/bootstrap-proxmox.sh -o /tmp/da-invent-bootstrap.sh \
  && bash /tmp/da-invent-bootstrap.sh
```

Cosa fa `bootstrap-proxmox.sh`:

1. Installa `git`, `curl`, `ca-certificates` con `apt` se assenti  
2. Clona il repository (default: `https://github.com/grandir66/DA-IPAM.git`, branch `main`)  
3. Avvia il wizard `scripts/proxmox-lxc-install.sh`: **storage template** e **storage root** da menu numerati (`pvesm`), **template OS** da elenco o da catalogo numerato per il download; CTID, hostname, risorse, **bridge** da menu numerato (`ip link type bridge`, opzione 0 = nome manuale), VLAN, DHCP o statico, privilegi, password root, installazione opzionale di DA-INVENT nel CT

**Variabili d’ambiente (opzionali):**

| Variabile | Descrizione |
|-----------|-------------|
| `DA_INVENT_GIT_URL` | URL repository da clonare |
| `DA_INVENT_BRANCH` | Branch (default `main`) |
| `DA_INVENT_BOOTSTRAP_DIR` | Directory del clone (default `/root/da-invent-install`) |

Dettagli aggiuntivi: [`docs/INSTALLAZIONE-PROXMOX.md`](docs/INSTALLAZIONE-PROXMOX.md).

### Aggiornamento dell’istanza nel CT (da nodo Proxmox)

Sul **nodo Proxmox**, come **root**, con il repository già clonato (o copiando solo lo script):

```bash
cd /root/da-invent-install           # clone bootstrap (o altro percorso del repo sul nodo)
chmod +x scripts/pct-update.sh
./scripts/pct-update.sh <VMID>       # es. CT di test: ./scripts/pct-update.sh 150
```

Equivale a `pct exec <VMID> -- bash` in `/opt/da-invent` con `git pull`, `npm install`, `build` e `systemctl restart da-invent` (vedi `scripts/update.sh`).

Variabile opzionale: `DA_INVENT_DIR` se l’app non è in `/opt/da-invent`.

**Opzionale — snapshot DB dal CT:** se vuoi **sostituire temporaneamente** `data/ipam.db` sul Mac con quello del CT (solo per confronto/debug), usa `npm run pull:db`. **Non** è la copia principale del progetto; la copia «buona» resta la **cartella sul Mac**. Dettagli: [`docs/INSTALLAZIONE-PROXMOX.md`](docs/INSTALLAZIONE-PROXMOX.md#opzionale-snapshot-database-ct--mac).

---

## Installazione su Debian/Ubuntu (VM, bare metal, container)

**Scenari [2](#tre-scenari-di-installazione-proxmox-vm-linux-container) e [3](#tre-scenari-di-installazione-proxmox-vm-linux-container):** qui installi l’applicazione **sul sistema operativo Debian/Ubuntu** — che sia una **VM**, un **server fisico** o un **container** (es. CT LXC già creato, anche se il CT stesso è stato creato prima su Proxmox con altri strumenti). I comandi si eseguono **dentro** quella macchina, come **root**.

### Opzione A — Installer facilitato (`bootstrap-linux.sh`)

Scarica lo script da GitHub ed eseguilo: clona il repository e lancia `install.sh --systemd`.

```bash
curl -fsSL https://raw.githubusercontent.com/grandir66/DA-IPAM/main/scripts/bootstrap-linux.sh -o /tmp/da-invent-bootstrap-linux.sh \
  && bash /tmp/da-invent-bootstrap-linux.sh
```

Cosa fa: installa `git` / `curl` / `ca-certificates` se mancano; **`git clone`** in **`/opt/da-invent`** (o `DA_INVENT_BOOTSTRAP_DIR`); poi **`scripts/install.sh --systemd`**.

### Opzione B — Solo Git, poi installer locale

```bash
git clone https://github.com/grandir66/DA-IPAM.git /opt/da-invent
cd /opt/da-invent
chmod +x scripts/install.sh
sudo ./scripts/install.sh --systemd
```

(`sudo` non serve se sei già root.)

### Cosa fa `install.sh` (comune alle opzioni A e B)

- **apt** (solo come root): toolchain e librerie per moduli nativi, nmap, SNMP client, ping, ecc. (elenco nella sezione [Script di installazione](#script-di-installazione-e-variabili-dambiente)).
- **Node.js 20 LTS** ([NodeSource](https://github.com/nodesource/distributions)).
- **`npm ci`** o **`npm install`**, poi **`npm run build`**.
- **`.env.local`** con `ENCRYPTION_KEY`, `AUTH_SECRET`, `PORT` se assente.
- Con **`--systemd`**: servizio `da-invent` con `systemctl enable --now`.

**Utente del servizio:** default **`root`** (consigliato per nmap UDP e ping in CT). Alternativa: `DA_INVENT_SERVICE_USER=da-invent sudo -E ./scripts/install.sh --systemd` (valuta le capability di rete).

**Senza systemd:** `npm run start` (porta **3001**).

### Caso particolare: CT Proxmox senza installazione automatica

Se hai creato il CT con il wizard ma **senza** installare l’app, oppure entri in un CT già esistente: dal **nodo** esegui `pct enter <VMID>`, poi **Opzione A** o **B** sopra (stessi comandi **dentro** il CT).

### Solo wizard LXC dal nodo (nessun `bootstrap-proxmox`)

Se il repository è già sul **nodo** Proxmox:

```bash
cd /percorso/DA-IPAM
chmod +x scripts/proxmox-lxc-install.sh
./scripts/proxmox-lxc-install.sh
```

Script **interattivo** (template, storage, rete, privilegi, install opzionale nel CT). **Non** usare `curl … | bash` per questo wizard: salva lo script ed eseguilo da file così le domande funzionano.

---

## Script di installazione e variabili d’ambiente

### Tabella script

| Script | Ruolo |
|--------|--------|
| [`scripts/bootstrap-proxmox.sh`](scripts/bootstrap-proxmox.sh) | Sul **nodo** PVE: `git`/`curl`, clone repo, avvio `proxmox-lxc-install.sh` |
| [`scripts/proxmox-lxc-install.sh`](scripts/proxmox-lxc-install.sh) | Wizard **pct**: template, risorse, rete, CT privilegiato/opzionale, clone + `install.sh` opzionale nel CT |
| [`scripts/bootstrap-linux.sh`](scripts/bootstrap-linux.sh) | Su **Debian/Ubuntu**: clone in `/opt/da-invent` (o `DA_INVENT_BOOTSTRAP_DIR`) ed esecuzione di `install.sh` |
| [`scripts/install.sh`](scripts/install.sh) | Dipendenze di sistema, Node 20, npm, build, `.env.local`, opzione systemd |
| [`scripts/update.sh`](scripts/update.sh) | `git pull`, `npm install`, `build`; `--restart` per `systemctl restart da-invent` |
| [`scripts/pct-update.sh`](scripts/pct-update.sh) | Dal **nodo** Proxmox: `pct exec <VMID>` → `update.sh` nella directory dell’app |

### Variabili — bootstrap Proxmox (`bootstrap-proxmox.sh`)

| Variabile | Descrizione |
|-----------|-------------|
| `DA_INVENT_GIT_URL` | URL repository da clonare sul nodo |
| `DA_INVENT_BRANCH` | Branch (default `main`) |
| `DA_INVENT_BOOTSTRAP_DIR` | Directory del clone sul nodo (default `/root/da-invent-install`) |

### Variabili — bootstrap Linux (`bootstrap-linux.sh`)

| Variabile | Descrizione |
|-----------|-------------|
| `DA_INVENT_GIT_URL` | URL repository |
| `DA_INVENT_BRANCH` | Branch (default `main`) |
| `DA_INVENT_BOOTSTRAP_DIR` | Directory di installazione (default `/opt/da-invent`) |
| `DA_INVENT_SKIP_SYSTEMD` | Se impostata a `1`, non passa `--systemd` a `install.sh` |

### Variabili — wizard Proxmox (`proxmox-lxc-install.sh`)

| Variabile | Descrizione |
|-----------|-------------|
| `DA_INVENT_GIT_URL` | URL usato per il clone **dentro** al CT quando scegli l’installazione automatica |

### Variabili — `install.sh`

| Variabile | Descrizione |
|-----------|-------------|
| `DA_INVENT_DIR` | Directory dell’applicazione (default: directory corrente / `$(pwd)`) |
| `DA_INVENT_USER` | Nome utente sistema per cartelle home (raramente usato; default `da-invent`) |
| `DA_INVENT_SERVICE_USER` | Utente dell’unità systemd (default **`root`**) |
| `DA_INVENT_SERVICE_GROUP` | Gruppo dell’unità systemd (default = utente servizio) |
| `PORT` | Porta HTTP in `.env.local` e nel servizio (default **3001**) |

### Pacchetti Debian/Ubuntu installati da `install.sh` (apt)

Come **root**, lo script installa tra gli altri: `ca-certificates`, `curl`, `git`, `openssl`, `build-essential`, `pkg-config`, `python3`, `python3-venv`, `python3-pip`, `net-tools`, `nmap`, `snmp`, `iputils-ping`, `sqlite3`, `libssl-dev`, `libsqlite3-dev`, `libsnmp-dev`. Servono per **ping/nmap/SNMP** da riga di comando e per la **compilazione** dei moduli nativi npm.

---

## Primo avvio e configurazione

1. Apri `http://<indirizzo-server>:3001`  
2. Completa il **setup iniziale** dalla pagina `/setup` (primo utente amministratore)  
3. Opzionale: copia `.env.example` in `.env.local` e adatta `PORT`, `WINRM_PYTHON`, TLS (vedi commenti in `.env.example`)

| Variabile | Descrizione |
|-----------|-------------|
| `DA_INVENT_SERVICE_USER` | Solo installer `--systemd`: utente del servizio (default **`root`**, consigliato per nmap UDP nel CT) |
| `DA_INVENT_SERVICE_GROUP` | Gruppo del servizio (default = stesso nome di `DA_INVENT_SERVICE_USER`) |
| `ENCRYPTION_KEY` | Cifratura credenziali dispositivi (generata dall’installer) |
| `AUTH_SECRET` | Secret NextAuth (generato) |
| `PORT` | Porta HTTP (default 3001) |
| `WINRM_PYTHON` | Path interprete Python con pywinrm (opzionale) |
| `WINRM_TRANSPORT` | `ntlm`, `credssp` o vuoto: default NTLM poi CredSSP se necessario (bridge WinRM) |
| `AUTH_TRUST_HOST` | Default: host attendibile (accesso via IP/LAN). Solo se serve: `false` + `AUTH_URL` fisso |
| `AUTH_URL` | URL pubblico dell’app (es. `https://invent.esempio.it`) se usi `AUTH_TRUST_HOST=false` |

### Errore «Server error / problem with the server configuration» (login)

Spesso **Auth.js v5** con accesso tramite **IP o hostname non previsto**. Dalla v0.2.45 il progetto imposta **`trustHost`** salvo `AUTH_TRUST_HOST=false`. Se l’errore resta: verifica che **`AUTH_SECRET`** sia valorizzato in `.env.local` e che **systemd** carichi il file (`EnvironmentFile=` nel servizio), poi `sudo systemctl restart da-invent`.

---

## Funzionalità dell’applicazione

### Dashboard

Panoramica su reti, host, stato online/offline e accesso rapido alle sezioni principali.

### Reti e scansioni

- **Subnet** (`/networks`): CIDR, nome, gateway, VLAN, DNS, community SNMP di default, router associato  
- **Scansioni**: ping sweep, nmap (profili configurabili), discovery SNMP su host  
- **Job** su rete configurabili da Impostazioni / API  

### Host

- Elenco per rete, griglia IP, dettaglio host con storico scan, porte, DNS, classificazione  
- **Monitoraggio**: host “noti” (`known_host`) con check periodici ping / fallback TCP  
- Grafici latenza dove implementati  

### Dispositivi (router, switch, hypervisor)

- Creazione da host o in bulk, **vendor** (MikroTik, Cisco, HP, Ubiquiti, Omada, …), **protocollo** (SSH, SNMP v2/v3, API, WinRM)  
- Credenziali da **archivio** o **inline** (cifrate)  
- Query dati dispositivo (SNMP/SSH/API/WinRM), ARP, tabelle MAC, STP/LLDP dove supportato  
- **Proxmox**: scan/match VM (ove previsto dall’API e UI)  
- Viste per **classificazione** (PC, server, VM, AP, firewall, …) da sidebar  

### Tabella ARP e mapping MAC–IP

- Raccolta ARP da router configurati  
- Vista **MAC–IP** e correlazione con host / switch  

### Credenziali (`/credentials`)

Archivio centralizzato (SSH, API, SNMP, Windows, Linux) con test connessione; assegnazione ai dispositivi o bulk sulle reti.

### Inventario asset

- **Asset** collegabili a host/device, ubicazioni, stato ciclo vita, dati tecnici ed economici  
- **Assegnatari** e **Licenze** con posti (seats) e assegnazioni  
- Export e sincronizzazione con host/device ove previsto dall’API  

### Impostazioni

- Utenti, profili nmap, job schedulati, integrazioni (es. TLS), chiavi/custom OUI, credenziali Windows globali per host, ecc.

---

## Allineamento al documento di requisiti funzionali

Il file [`docs/REVISIONE-LOGICA-PROGETTO.md`](docs/REVISIONE-LOGICA-PROGETTO.md) confronta il prodotto con i requisiti. Sintesi per sezione:

| § | Argomento | Stato nel prodotto |
|---|-----------|-------------------|
| **1** | Reti con dati utili, SNMP default, credenziali | Reti con CIDR, gateway, DNS, `snmp_community`; SSH spesso tramite router e bulk credential; WMI/host Windows con credenziale globale in settings |
| **2** | Scansioni ping, nmap, SNMP, MAC router, DHCP | Ping, nmap, SNMP discovery, ARP da router, lease DHCP **MikroTik** |
| **3** | Tabella dati arricchita | Host + `mac_ip_mapping` + `scan_history` + aggregazione in `upsertHost` |
| **4** | Monitoraggio ping | `known_host_check`, ping + TCP fallback, aggiornamento `status` |
| **5** | Host → device (tipologia, accesso, brand) | `network_devices` con `classification`, `vendor`, `protocol`, credenziali multiple |
| **6** | Solo classificazione su host | `hosts.classification` senza device obbligatorio; liste unificate |
| **7** | Credenziali multiple e tipi | `credential_id` + `snmp_credential_id`, tipi ssh/snmp/api/windows/linux |
| **8** | Scansione device / storage info | `device-info.ts`, query API, campi su DB; note su unione MAC cross-rete in documento |

**Brand / vendor** supportati (estratto dalla revisione): MikroTik, Ubiquiti, Proxmox, VMware, Windows, Linux, HP (ProCurve/Comware), Cisco, Omada, Synology, QNAP, Stormshield, altro.

**Gap noti** (dal documento): credenziali SSH “di default” per rete solo in parte coperte; `status_history` non sempre alimentata dai check schedulati; DHCP non-MikroTik; collasso MAC tra reti. Per il dettaglio: `docs/REVISIONE-LOGICA-PROGETTO.md`.

---

## Job schedulati e server di produzione

I job (`ping_sweep`, `nmap_scan`, `arp_poll`, `dns_resolve`, `cleanup`, monitoraggio host noti, ecc.) sono definiti in `src/lib/cron/jobs.ts` e registrati da `server.ts`. **Solo** l’avvio tramite `tsx server.ts` (`npm run start`) esegue il cron integrato.

---

## Sicurezza

- Autenticazione su API sensibili: `requireAuth()` / `requireAdmin()` (`src/lib/api-auth.ts`)  
- Rate limiting sul login (`src/lib/rate-limit.ts`)  
- Credenziali cifrate (AES-256-GCM, `src/lib/crypto.ts`)  
- Endpoint pubblici intenzionalmente limitati (es. health, version, auth, setup secondo configurazione)  

---

## API e dati

- API REST sotto `/api/*` (reti, host, device, scan, inventario, licenze, utenti, …)  
- Database **SQLite** con schema ed indici in `src/lib/db-schema.ts` e query in `src/lib/db.ts`  
- File dati **non** versionato: `data/ipam.db` (in `.gitignore`)

---

## Documentazione in `docs/`

| File | Contenuto |
|------|-----------|
| [`INSTALLAZIONE-PROXMOX.md`](docs/INSTALLAZIONE-PROXMOX.md) | Procedura Proxmox approfondita (bootstrap, rete, aggiornamenti); riepilogo installer anche in questo README |
| [`REVISIONE-LOGICA-PROGETTO.md`](docs/REVISIONE-LOGICA-PROGETTO.md) | Requisiti funzionali vs implementazione, gap |
| [`INVENTARIO-ASSET-MANAGEMENT.md`](docs/INVENTARIO-ASSET-MANAGEMENT.md) | Modello inventario e licenze (riferimenti Snipe-IT/GLPI/Shelf) |
| [`CREDENZIALI-E-PROTOCOLLI.md`](docs/CREDENZIALI-E-PROTOCOLLI.md) | Priorità archivio vs inline, uso multi-protocollo |
| [`DA-MKNET-ACQUISIZIONE-DATI.md`](docs/DA-MKNET-ACQUISIZIONE-DATI.md) | Note comparative acquisizione dati per vendor (riferimento progetto MKNET) |

---

## Deploy in produzione

- **systemd**: `deploy/da-invent.service` (esempio con utente `da-invent`, `/opt/da-invent`); allineare path dopo `install.sh`  
- **HTTPS / reverse proxy**: es. `deploy/nginx-ssl.conf`  
- **Backup DB**: `scripts/backup.sh`  
- **Certificati**: `scripts/generate-cert.sh`  

---

## Sviluppo

### Dove è la copia «buona» del progetto

La **cartella sul tuo Mac** dove hai il clone Git (es. `~/Progetti/DA-IPAM`) è la copia di **riferimento**: ci lavori, committi e fai push. Il **CT Proxmox** è solo **deploy** (aggiornato da Git sul nodo, non il contrario). **Non** va considerata «la copia giusta» quella dentro il container rispetto al Mac.

### Copia locale dal repository (non è “tutto” nell’archivio Git)

L’**archivio su GitHub** contiene il **codice**; il **database** (`data/ipam.db`) **non** è versionato (è nel `.gitignore`). Per avere il progetto in locale:

```bash
git clone https://github.com/grandir66/DA-IPAM.git
cd DA-IPAM
npm install
npm run dev
```

Apri `http://localhost:3001`, vai su **/setup** e crea il primo utente: SQLite crea `data/ipam.db` da solo (istanza vuota).

Solo se ti serve **uno snapshot del database del CT** sul Mac (sovrascrive `data/ipam.db` locale, con backup automatico): **`npm run pull:db`** e SSH al Proxmox. Vedi [doc Proxmox](docs/INSTALLAZIONE-PROXMOX.md#opzionale-snapshot-database-ct--mac).

---

```bash
npm install
npm run dev          # Solo Next.js (porta 3001)
npm run dev:server   # Next + scheduler cron in watch
npm run build
npm run lint
```

Convenzioni e anti-regressioni: vedi `CLAUDE.md` nel repository.

### Porta 3001: il sito non si apre sul Mac

1. **Apri un terminale** e avvia il server dalla root del repo — **non basta** avere solo i file in cartella:
   ```bash
   cd ~/Progetti/DA-IPAM   # o il tuo percorso
   npm run dev
   ```
   Attendi la riga **Ready** (es. “Ready in … ms”). Lascia il terminale aperto.
2. Nel browser usa **HTTP**: **`http://127.0.0.1:3001`** o **`http://localhost:3001`**.  
   Se in `.env.local` hai **`TLS_CERT`** / **`TLS_KEY`** e usi **`npm run start`** (produzione), allora è **HTTPS**: **`https://127.0.0.1:3001`**. Con **`npm run dev`** di solito è solo HTTP: **non** usare `https://` se il server non è in TLS.
3. **Diagnostica**: in un secondo terminale, con il server avviato: `npm run dev:doctor` (controlla porta e `/api/health`).  
   Oppure: `lsof -i :3001` e `curl -s http://127.0.0.1:3001/api/health`
4. Se la **login** resta su «Caricamento…», dopo ~12 secondi dovrebbe comunque apparire il modulo; se il DB non risponde, controlla che nessun altro processo tenga aperto `data/ipam.db`.

### Database di test sul Mac (dopo un `pull:db` sbagliato)

`npm run pull:db` **sostituisce** il DB locale con quello del CT (spesso piccolo). Ora lo script chiede conferma **`YES`** (oppure `DA_INVENT_PULL_DB_CONFIRM=yes` in CI).

Per **ripristinare** un backup locale:

```bash
./scripts/restore-local-db.sh data/ipam.db.backup-<data>
```

---

## Aggiornamento

```bash
cd /percorso/DA-IPAM
./scripts/update.sh
./scripts/update.sh --restart    # se usi systemd
```

Esempio cron giornaliero:

```bash
0 3 * * * cd /opt/da-invent && ./scripts/update.sh --restart
```

---

## Versioning

- Versione semver in `package.json`  
- Incremento patch: `npm run version:bump`  
- Endpoint: `GET /api/version`  
- **Tag di stabilità:** `v0.2.62-stable` — checkpoint (pre-miglioramenti classificazione dispositivi). Ripristino: `git checkout -b nome-branch v0.2.62-stable`  

---

## Licenza

- **Licenza:** vedi [`LICENSE`](LICENSE) — permissiva (stile MIT) con **clausola di attribuzione per fork e redistribuzioni esterne** verso terzi.  
- **Copyright:** **Domarc** ([domarc.it](https://domarc.it)) e contributori.  
- **Repository canonico:** [github.com/grandir66/DA-IPAM](https://github.com/grandir66/DA-IPAM)  

Uso interno e deploy privato senza ridistribuire il sorgente a terzi non richiedono passi aggiuntivi oltre al mantenimento della nota di copyright nelle copie del codice. Per fork pubblici: leggi la sezione *Forks, derivative works* nel file `LICENSE` e il file [`NOTICE`](NOTICE).
