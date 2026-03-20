# DA-INVENT

<p align="center">
  <strong>Domarc</strong> · <a href="https://domarc.it">domarc.it</a>
</p>

Sistema di **IP Address Management (IPAM)** e **inventario asset** basato su Next.js 16. Gestisce reti IPv4, host, dispositivi di rete (router, switch, hypervisor), acquisizione ARP/MAC, mappatura porte switch, scansioni (ping, nmap, SNMP), job schedulati, credenziali cifrate e modulo inventario con licenze e assegnatari.

Il codice sorgente è **rilasciato in forma open source** (vedi [`LICENSE`](LICENSE)): puoi usare, studiare e modificare il software liberamente. Se pubblichi un **fork** o una **derivata** verso terzi (repository pubblico, prodotto o servizio), è richiesto un **riferimento esplicito** al progetto originale **DA-INVENT**, al brand **Domarc** e al repository canonico — come indicato nel file di licenza.

**Indice**

1. [Panoramica e architettura](#panoramica-e-architettura)  
2. [Requisiti](#requisiti)  
3. [Installazione Proxmox (una riga)](#installazione-proxmox-una-riga)  
4. [Installazione manuale (LXC / VM / bare metal)](#installazione-manuale-lxc--vm--bare-metal)  
5. [Primo avvio e configurazione](#primo-avvio-e-configurazione)  
6. [Funzionalità dell’applicazione](#funzionalità-dellapplicazione)  
7. [Allineamento al documento di requisiti funzionali](#allineamento-al-documento-di-requisiti-funzionali)  
8. [Job schedulati e server di produzione](#job-schedulati-e-server-di-produzione)  
9. [Sicurezza](#sicurezza)  
10. [API e dati](#api-e-dati)  
11. [Documentazione in `docs/`](#documentazione-in-docs)  
12. [Deploy in produzione](#deploy-in-produzione)  
13. [Sviluppo](#sviluppo) (include copia locale da Git)  
14. [Aggiornamento](#aggiornamento)  
15. [Versioning](#versioning)  
16. [Licenza](#licenza)

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
| **Python 3 + pywinrm** | Opzionale, per WinRM su host Windows (`WINRM_PYTHON` in `.env.local`) |
| **Sistema** | Debian/Ubuntu consigliati per script `install.sh` (apt) |

Per **scansioni nmap** (inclusa **UDP `-sU`**) e **ping ICMP** servono in genere **socket privilegiati**. Nel **container LXC/VM** il servizio systemd è quindi previsto in esecuzione come **`root`** (default di `scripts/install.sh` e di `deploy/da-invent.service`), così `nmap` non viene eseguito senza i diritti necessari. Un container **non privilegiato** può comunque bastare se accetti solo scan TCP; per UDP serve **root** nel CT oppure capability `CAP_NET_RAW` / `CAP_NET_ADMIN` su un utente dedicato (configurazione avanzata).

---

## Installazione Proxmox (una riga)

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

## Installazione manuale (LXC / VM / bare metal)

### Repository già sul nodo Proxmox (solo wizard LXC)

```bash
cd /percorso/DA-IPAM
chmod +x scripts/proxmox-lxc-install.sh
./scripts/proxmox-lxc-install.sh
```

### Installazione applicazione dentro il CT o su una VM

```bash
git clone https://github.com/grandir66/DA-IPAM.git
cd DA-IPAM
chmod +x scripts/install.sh
./scripts/install.sh              # dipendenze, npm, build, .env.local
sudo ./scripts/install.sh --systemd   # servizio systemd: abilitato al boot e avviato subito (enable --now)
```

`install.sh` installa Node 20, build-essential, nmap, sqlite3, esegue `npm ci`/`npm install` e `npm run build`, genera `.env.local` con `ENCRYPTION_KEY` e `AUTH_SECRET`.

Con `sudo ./scripts/install.sh --systemd` il servizio systemd usa per default **`User=root`** (adatto al container: scan nmap UDP e ping). Per forzare un altro utente: `DA_INVENT_SERVICE_USER=da-invent sudo -E ./scripts/install.sh --systemd` (in quel caso valuta capability di rete per `nmap`).

Avvio senza systemd: `npm run start` (porta default **3001**).

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
| [`INSTALLAZIONE-PROXMOX.md`](docs/INSTALLAZIONE-PROXMOX.md) | Procedura Proxmox e comando bootstrap |
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

---

## Licenza

- **Licenza:** vedi [`LICENSE`](LICENSE) — permissiva (stile MIT) con **clausola di attribuzione per fork e redistribuzioni esterne** verso terzi.  
- **Copyright:** **Domarc** ([domarc.it](https://domarc.it)) e contributori.  
- **Repository canonico:** [github.com/grandir66/DA-IPAM](https://github.com/grandir66/DA-IPAM)  

Uso interno e deploy privato senza ridistribuire il sorgente a terzi non richiedono passi aggiuntivi oltre al mantenimento della nota di copyright nelle copie del codice. Per fork pubblici: leggi la sezione *Forks, derivative works* nel file `LICENSE` e il file [`NOTICE`](NOTICE).
