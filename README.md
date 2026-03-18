# DA-INVENT

Sistema di **IP Address Management** e **Inventario Asset** basato su Next.js 16. Gestisce reti, host, dispositivi (router, switch), acquisizione ARP, mappatura porte switch, scansioni pianificate e inventario hardware/licenze.

## Requisiti

- Node.js 20+
- SQLite 3
- nmap (per scansioni)
- Python 3 + pywinrm (opzionale, per comandi WinRM su host Windows)

## Sviluppo

```bash
npm install
npm run dev          # Solo Next.js (porta 3001)
npm run dev:server   # Con server custom e cron
npm run build
npm run start        # Produzione con cron
```

## Installazione su LXC/Proxmox (Debian/Ubuntu)

### 1. Clona il repository

```bash
git clone https://github.com/<tuo-org>/da-invent.git
cd da-invent
```

### 2. Esegui l'installer

```bash
chmod +x scripts/install.sh
./scripts/install.sh
```

L'installer:
- Installa Node.js 20, build-essential, nmap, sqlite3
- Crea venv Python per WinRM (opzionale)
- Esegue `npm install` e `npm run build`
- Genera `.env.local` con ENCRYPTION_KEY e AUTH_SECRET

### 3. Avvio

```bash
npm run start
```

Accedi a `http://<ip-lxc>:3001` e completa il setup dalla pagina `/setup`.

### 4. Servizio systemd (opzionale)

Per avvio automatico al boot:

```bash
sudo ./scripts/install.sh --systemd
sudo systemctl start da-invent
sudo systemctl status da-invent
```

Oppure copia manualmente il file di servizio:

```bash
sudo cp deploy/da-invent.service /etc/systemd/system/
# Modifica User, WorkingDirectory e path in base alla tua installazione
sudo systemctl daemon-reload
sudo systemctl enable da-invent
sudo systemctl start da-invent
```

### Variabili d'ambiente

Copia `.env.example` in `.env.local` e configura:

| Variabile      | Descrizione                          |
|----------------|--------------------------------------|
| ENCRYPTION_KEY | Chiave per credenziali (generata)    |
| AUTH_SECRET    | Secret NextAuth (generato)           |
| PORT           | Porta HTTP (default 3001)            |
| WINRM_PYTHON   | Path Python con pywinrm (opzionale)  |

## Stack

- **Framework:** Next.js 16 (App Router), TypeScript
- **UI:** Tailwind CSS v4, shadcn/ui v4, Recharts
- **Database:** SQLite (better-sqlite3) in `data/ipam.db`
- **Auth:** NextAuth v5 (Credentials, JWT)
- **Device:** SSH (ssh2), SNMP (net-snmp), REST API

## Aggiornamento (Git pull)

Per aggiornare un’installazione esistente dal repository Git:

```bash
cd /path/to/da-invent
./scripts/update.sh
```

Per eseguire anche il restart del servizio systemd:

```bash
./scripts/update.sh --restart
```

Per aggiornamenti automatici periodici, aggiungi un cron job:

```bash
# Ogni giorno alle 3:00
0 3 * * * cd /opt/da-invent && ./scripts/update.sh --restart
```

## Versioning

- Versione in `package.json` (formato `MAJOR.MINOR.PATCH`)
- Ogni modifica incrementa la patch: `npm run version:bump`
- API versione: `GET /api/version`

## Licenza

Proprietario.
