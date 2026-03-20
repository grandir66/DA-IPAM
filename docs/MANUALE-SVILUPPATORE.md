# DA-INVENT — Manuale sviluppatore

> **Versione di riferimento:** 0.2.x  
> Stack: Next.js 16 · TypeScript strict · SQLite (better-sqlite3) · NextAuth v5 · Tailwind CSS v4 · shadcn/ui v4

---

## Indice

1. [Setup ambiente di sviluppo](#1-setup-ambiente-di-sviluppo)
2. [Architettura generale](#2-architettura-generale)
3. [Database (SQLite)](#3-database-sqlite)
4. [Autenticazione e autorizzazione](#4-autenticazione-e-autorizzazione)
5. [API Routes — struttura e pattern](#5-api-routes--struttura-e-pattern)
6. [Scanning e Discovery](#6-scanning-e-discovery)
7. [Integrazione dispositivi di rete](#7-integrazione-dispositivi-di-rete)
8. [Job scheduler (cron)](#8-job-scheduler-cron)
9. [Crittografia credenziali](#9-crittografia-credenziali)
10. [Frontend: componenti e pattern UI](#10-frontend-componenti-e-pattern-ui)
11. [Validazione (Zod v4)](#11-validazione-zod-v4)
12. [Tipi principali](#12-tipi-principali)
13. [Script e deploy](#13-script-e-deploy)
14. [Regole anti-regressione](#14-regole-anti-regressione)
15. [Versioning](#15-versioning)

---

## 1. Setup ambiente di sviluppo

### Prerequisiti

- Node.js ≥ 20
- `nmap` installato sul sistema (opzionale, per scansioni nmap)
- Python 3 + `pywinrm` (opzionale, per integrazione WinRM Windows)
- SQLite 3 (per ispezionare il DB da riga di comando)

### Installazione

```bash
git clone https://github.com/grandir66/DA-IPAM.git
cd DA-IPAM
npm install
```

### Variabili d'ambiente (`.env.local`)

Creare `.env.local` nella root del progetto (copiare da `.env.example`):

```env
ENCRYPTION_KEY=<64 caratteri hex>    # openssl rand -hex 32
AUTH_SECRET=<64 caratteri hex>        # openssl rand -hex 32
PORT=3001
NODE_ENV=development

# Opzionale — HTTPS (solo per npm run start / produzione)
# TLS_CERT=/percorso/cert.pem
# TLS_KEY=/percorso/key.pem
# TLS_REDIRECT=true
# HTTP_PORT=80

# Opzionale — percorso venv Python per WinRM
# WINRM_PYTHON=~/.da-invent-venv/bin/python3
```

### Comandi

```bash
npm run dev           # Solo Next.js (porta 3001). Nessun job cron.
npm run dev:server    # Next.js + scheduler cron in watch mode (tsx watch server.ts)
npm run dev:doctor    # Diagnostica ambiente locale (porta, .env.local, health)
npm run build         # Build produzione
npm run start         # Produzione con scheduler cron (tsx server.ts)
npm run lint          # ESLint
npm run version:bump  # Incrementa patch version in package.json
npm run pull:db       # Copia DB dal CT Proxmox (richiede YES interattivo)
```

### Database

Il database SQLite viene creato automaticamente al primo avvio in `data/ipam.db`. Lo schema è definito in `src/lib/db-schema.ts` e applicato da `src/lib/db.ts` alla prima apertura.

Per ispezionare manualmente:

```bash
sqlite3 data/ipam.db ".tables"
sqlite3 data/ipam.db "SELECT * FROM networks;"
```

---

## 2. Architettura generale

```
DA-IPAM/
├── src/
│   ├── app/
│   │   ├── (dashboard)/      # Pagine autenticate (AppShell con sidebar)
│   │   ├── api/              # Route API REST
│   │   ├── login/            # Pagina login pubblica
│   │   ├── setup/            # Setup iniziale (solo senza utenti)
│   │   ├── globals.css       # Variabili CSS palette + stili globali
│   │   └── layout.tsx        # Root layout con AuthProvider e TooltipProvider
│   ├── components/
│   │   ├── shared/           # Sidebar, GlobalSearch, ScanProgress, IpGrid, ecc.
│   │   ├── providers/        # AuthProvider (SessionProvider NextAuth)
│   │   └── ui/               # shadcn/ui (base-ui/react, NON radix-ui)
│   ├── lib/
│   │   ├── db.ts             # Singleton SQLite, tutte le query
│   │   ├── db-schema.ts      # DDL schema + indici
│   │   ├── auth.ts           # NextAuth v5 — Credentials provider
│   │   ├── auth.config.ts    # Configurazione NextAuth (Edge-safe)
│   │   ├── crypto.ts         # AES-256-GCM encrypt/decrypt
│   │   ├── validators.ts     # Schema Zod per tutte le entità
│   │   ├── api-auth.ts       # requireAuth() / requireAdmin()
│   │   ├── rate-limit.ts     # Rate limiter in-memory
│   │   ├── utils.ts          # Helper CIDR, IP, Tailwind cn()
│   │   ├── device-classifications.ts  # Slug + label classificazioni
│   │   ├── device-classifier.ts       # Classificazione automatica dispositivi
│   │   ├── scanner/          # Ping, nmap, SNMP, DNS, ARP cache, TCP, discovery
│   │   ├── devices/          # Client router, switch, SSH, WinRM, info sistema
│   │   ├── proxmox/          # Client Proxmox API e SSH
│   │   └── cron/             # Scheduler e tipi job
│   ├── types/
│   │   └── index.ts          # TypeScript types (DB, API, view models)
│   └── proxy.ts              # Middleware Next.js (re-export auth)
├── server.ts                 # Entry point produzione (HTTP/HTTPS + cron)
├── data/                     # DB SQLite (non versionato) e certificati TLS
├── scripts/                  # Shell scripts per install, update, backup, ecc.
├── deploy/                   # Configurazioni produzione (systemd, nginx)
├── patches/                  # Patch npm (patch-package)
└── public/                   # Asset statici (loghi)
```

### Route groups

- `src/app/(dashboard)/` — tutte le pagine autenticate. Il layout `(dashboard)/layout.tsx` include `AppShell` (sidebar + header).
- `src/app/login/` e `src/app/setup/` — pagine pubbliche, senza sidebar.

### Runtime separation (critico)

| File | Runtime | Note |
|------|---------|------|
| `src/proxy.ts` | **Edge** | Importa solo `auth.config.ts` — nessun modulo Node.js nativo |
| `src/lib/auth.ts` | **Node.js** | Usa `import()` dinamico per `db` e `bcrypt` |
| `src/lib/db.ts` | **Node.js** | `better-sqlite3` non compatibile Edge |
| Tutte le API routes | **Node.js** | Server Components con `serverExternalPackages` |

> **Non importare mai** `db.ts`, `bcrypt`, `ssh2`, `net-snmp`, `better-sqlite3` in file che potrebbero girare su Edge runtime (middleware).

---

## 3. Database (SQLite)

### Singleton e apertura

```typescript
// src/lib/db.ts
import Database from "better-sqlite3";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "ipam.db");

export function getDb(): Database.Database {
  if (!globalThis.__db) {
    globalThis.__db = new Database(DB_PATH);
    applyPragmas(globalThis.__db);
    applySchema(globalThis.__db);
  }
  return globalThis.__db;
}
```

### PRAGMA configurate (non rimuovere)

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;    -- ~64MB RAM
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456;  -- 256MB mmap
```

### Schema — tabelle principali

```sql
-- Reti/subnet
networks (id, cidr, name, description, gateway, vlan_id, location,
          snmp_community, dns_server, created_at, updated_at)

-- Router associati alle reti (1:1)
network_router (network_id PK, device_id)

-- Host rilevati
hosts (id, network_id, ip, mac, vendor, hostname, custom_name,
       classification, status, first_seen, last_seen, open_ports JSON,
       os_info, model, serial_number, known_host, monitor_ports JSON,
       dns_forward, dns_reverse, hostname_source, inventory_code, notes,
       last_response_time_ms)

-- Dispositivi gestiti (router/switch/hypervisor)
network_devices (id, name, host, device_type, classification, vendor,
                 vendor_subtype, protocol, port, enabled,
                 credential_id, snmp_credential_id,
                 username, encrypted_password, community_string, api_token,
                 api_url, sysname, sysdescr, model, firmware, serial_number,
                 stp_info JSON, last_device_info_json,
                 last_proxmox_scan_result JSON, created_at, updated_at)

-- Credenziali cifrate
credentials (id, name, credential_type, encrypted_username,
             encrypted_password, created_at)

-- Voci ARP acquisite dai router
arp_entries (id, device_id, mac, ip, interface_name, host_id,
             timestamp, created_at)

-- MAC table switch
mac_port_entries (id, device_id, mac, port_name, vlan, port_status,
                  speed, timestamp, created_at)

-- Schema porte switch (arricchito con LLDP, STP, PoE)
switch_ports (id, device_id, port_index UNIQUE, port_name,
              status, speed, duplex, vlan, is_trunk,
              poe_status, poe_power_mw, mac_count,
              single_mac, single_mac_vendor, single_mac_ip,
              single_mac_hostname, host_id,
              trunk_neighbor_name, trunk_neighbor_port,
              stp_state, updated_at)

-- Mapping cumulativo MAC→IP
mac_ip_mapping (id, mac, ip, previous_ip, source, network_id,
                hostname, vendor, last_seen, first_seen, change_count)

-- Inventario asset
inventory_assets (id, asset_id, asset_tag, serial_number, ...,
                  in_scope_gdpr, in_scope_nis2, classificazione_dati,
                  created_at, updated_at)
```

### Pattern upsertHost (critico)

```typescript
// Sempre usare upsertHost invece di INSERT/UPDATE separati
// usa INSERT OR REPLACE con logica merge per first_seen e known_host
export function upsertHost(data: HostUpsertData): Host {
  const db = getDb();
  const existing = getHostByIp(data.ip, data.network_id);
  // ... merge campi, preserva first_seen e known_host
}
```

### Anti-pattern N+1

```typescript
// ❌ SBAGLIATO: N query in loop
const hosts = getHostsByNetwork(networkId);
for (const host of hosts) {
  const device = getNetworkDeviceByHost(host.ip); // N query!
}

// ✅ CORRETTO: JOIN in una sola query
const hosts = getHostsByNetworkWithDevices(networkId); // JOIN
```

### Transazioni per operazioni multi-tabella

```typescript
// DELETE + INSERT atomici → always dentro db.transaction()
const upsertArpEntries = db.transaction((deviceId, entries) => {
  db.prepare("DELETE FROM arp_entries WHERE device_id = ?").run(deviceId);
  for (const e of entries) {
    db.prepare("INSERT INTO arp_entries ...").run(e);
  }
});
```

---

## 4. Autenticazione e autorizzazione

### NextAuth v5 — Credentials provider

```typescript
// src/lib/auth.ts
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  trustHost: process.env.AUTH_TRUST_HOST !== "false",
  providers: [
    Credentials({
      async authorize(credentials) {
        // Rate limiting → verifica DB → bcrypt.compare → return user o null
      }
    })
  ]
});
```

### Middleware (Edge runtime)

```typescript
// src/proxy.ts — re-export di auth (usa auth.config.ts, Edge-safe)
export const proxy = auth;
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth|logo*).*)"]
};
```

### Protezione API routes

```typescript
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";

// Per GET con dati sensibili:
export async function GET() {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck; // 401
  // ...
}

// Per POST/PUT/DELETE:
export async function POST(request: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck; // 401 o 403
  // ...
}
```

**Endpoint senza auth** (eccezioni documentate):
- `/api/auth/*` — handler NextAuth
- `/api/setup` — solo GET (check needsSetup) e POST (solo se nessun utente)
- `/api/health` — health check per monitoring
- `/api/version` — versione app

### Ruoli

| Ruolo | Permessi |
|-------|---------|
| `admin` | Tutte le operazioni (GET, POST, PUT, DELETE) |
| `viewer` | Solo lettura (GET). Tutti i POST/PUT/DELETE → 403 Forbidden |

---

## 5. API Routes — struttura e pattern

### Struttura standard

```typescript
// src/app/api/networks/route.ts
import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { SomeSchema } from "@/lib/validators";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET(request: Request) {
  try {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    
    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get("page")) || 1;
    
    const data = getNetworks(); // db query
    return NextResponse.json(data, { headers: NO_CACHE_HEADERS });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json({ error: "Errore interno" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    
    const body = await request.json();
    const parsed = SomeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    
    const result = createNetwork(parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json({ error: "Errore interno" }, { status: 500 });
  }
}
```

### Paginazione

```typescript
// Standard: ?page=1&pageSize=25
const page = Math.max(1, Number(searchParams.get("page")) || 1);
const pageSize = Math.min(100, Number(searchParams.get("pageSize")) || 25);
const offset = (page - 1) * pageSize;

const total = countNetworks();
const data = getNetworksPaginated(offset, pageSize);
const totalPages = Math.ceil(total / pageSize);

return NextResponse.json({ data, page, totalPages, total });
```

### Progress tracking scansioni

Le scansioni in corso usano un `Map` in-memory globale (persistente tra richieste nella stessa istanza):

```typescript
// src/lib/scanner/discovery.ts
type ProgressStore = Map<string, ScanProgress>;
const getProgress = (): ProgressStore => {
  if (!globalThis.__daipam_scan_progress__) {
    globalThis.__daipam_scan_progress__ = new Map();
  }
  return globalThis.__daipam_scan_progress__;
};

// Il client fa polling su GET /api/scans/progress/[jobId]
```

---

## 6. Scanning e Discovery

### Orchestratore principale

```typescript
// src/lib/scanner/discovery.ts
export async function discoverNetwork(
  networkId: number,
  scanType: ScanType,
  nmapArgs?: string | null,
  snmpCommunity?: string | null
): Promise<DiscoveryResult>
```

Il progress viene aggiornato in `globalThis.__daipam_scan_progress__` con il `jobId` univoco.

### Flusso ping sweep

```
pingSweep(allIps, concurrency=50) 
  → per ogni IP alive:
    - readArpCache() per MAC
    - reverseDns(ip)
    - forwardDns(hostname)
    - lookupVendor(mac)
    - classifyDevice(data)
    - upsertHost(data)
    - addStatusHistory(hostId, "online", latencyMs)
  → markHostsOffline(networkId, onlineIps) per IP non risposti
  → addScanHistory(scanRecord)
```

### Flusso nmap

```
nmapDiscoverHosts(cidr) → lista IP live (discovery -sn)
  → fallback: pingSweep se nmap non disponibile
  → per ogni batch di IP (5 paralleli):
    nmapPortScan(ip, args, timeout=150s)
    → XML output → parsa porte, OS, MAC
    → upsertHost con open_ports JSON
```

### Concorrenza

| Tipo scan | Concorrenza |
|-----------|------------|
| Ping sweep | 50 IP in parallelo |
| SNMP query | 16 host in parallelo |
| Nmap port scan | 5 host in parallelo |
| Windows/SSH | Sequenziale (per carico rete) |

### Aggiungere un nuovo tipo di scansione

1. Aggiungere il valore all'enum in `src/lib/validators.ts` (`ScanTriggerSchema.scan_type`)
2. Aggiungere il case in `src/lib/scanner/discovery.ts` nella funzione principale
3. Aggiungere il case in `src/lib/cron/jobs.ts` per il job schedulato
4. Aggiornare il select nella UI (`/networks/[id]`)

---

## 7. Integrazione dispositivi di rete

### Router Client

```typescript
// src/lib/devices/router-client.ts
export function createRouterClient(device: NetworkDevice): RouterClient
```

Il client sceglie l'implementazione in base a `device.vendor` e `device.protocol`.

**Implementazioni disponibili:**

| Vendor | Protocollo | Funzionalità |
|--------|-----------|-------------|
| MikroTik | SSH | ARP table, DHCP leases, interfacce |
| Ubiquiti | SSH | ARP table |
| Cisco | SSH | ARP table |
| Generico | SNMP | ipNetToMediaTable (OID 1.3.6.1.2.1.4.22) |

**Aggiungere un vendor:**

```typescript
// In router-client.ts, aggiungere al switch vendor:
case "nuovo_vendor":
  return new NuovoVendorRouterClient(device, credentials);

// Implementare l'interfaccia:
class NuovoVendorRouterClient implements RouterClient {
  async getArpTable(): Promise<ArpTableEntry[]> { ... }
  async testConnection(): Promise<boolean> { ... }
}
```

### Switch Client

```typescript
// src/lib/devices/switch-client.ts
export function createSwitchClient(device: NetworkDevice): SwitchClient
```

**Struttura PortInfo** (ritornata da `getPortSchema()`):

```typescript
interface PortInfo {
  port_index: number;
  port_name: string;
  status: "up" | "down" | "disabled";
  speed?: number;          // Mbps
  duplex?: "full" | "half";
  vlan?: number;
  is_trunk: boolean;
  poe_status?: "on" | "off" | "searching";
  poe_power_mw?: number;
  stp_state?: "forwarding" | "blocking" | "designated" | "root" | "disabled";
  trunk_neighbor_name?: string;
  trunk_neighbor_port?: string;
  single_mac?: string;     // MAC dell'unico host su questa porta
  single_mac_vendor?: string;
  single_mac_ip?: string;
  single_mac_hostname?: string;
  host_id?: number;
}
```

### SNMP generica

```typescript
// src/lib/scanner/snmp-query.ts
export async function querySnmpInfoMultiCommunity(
  ip: string,
  communities: string[]
): Promise<SnmpDeviceInfo | null>

// OID interrogati:
// sysName:     1.3.6.1.2.1.1.5.0
// sysDescr:    1.3.6.1.2.1.1.1.0
// sysObjectID: 1.3.6.1.2.1.1.2.0
// serialNum:   1.3.6.1.2.1.47.1.1.1.1.11.1 (ENTITY-MIB)
// model:       1.3.6.1.2.1.47.1.1.1.1.7.1
```

### Proxmox Client

```typescript
// src/lib/proxmox/proxmox-client.ts
// Chiamate API REST Proxmox VE (porta 8006)
// Autenticazione: ticket (username/password) o API token
export async function getProxmoxData(device: NetworkDevice): Promise<ProxmoxData>
```

### WinRM (Windows)

```
Node.js → child_process.spawn(python3, [winrm-bridge.py])
         ↕ JSON stdin/stdout
winrm-bridge.py (pywinrm) → WinRM su host Windows
```

La connessione WinRM usa NTLM o Basic auth. Il bridge Python risponde con un oggetto JSON con lo stdout/stderr del comando WMI.

Configurazione:
- `WINRM_PYTHON` env (default: cerca `python3` nel PATH)
- Se non trovato, il client salta WinRM e usa SNMP/SSH come fallback

---

## 8. Job scheduler (cron)

### Avvio

```typescript
// server.ts → dopo avvio HTTP/HTTPS
initializeScheduler();

// src/lib/cron/scheduler.ts
export function initializeScheduler() {
  const jobs = getEnabledJobs(); // da DB
  for (const job of jobs) {
    scheduleJob(job.id, job.interval_minutes);
  }
}
```

### Conversione intervalli → cron

```typescript
function intervalToCron(minutes: number): string {
  if (minutes < 60) return `*/${minutes} * * * *`;
  const hours = Math.floor(minutes / 60);
  return `0 */${hours} * * *`;
}
```

### Aggiungere un nuovo tipo di job

1. Aggiungere a `ScheduledJobSchema.job_type` in `validators.ts`
2. Aggiungere il case in `src/lib/cron/jobs.ts` nella funzione `runJob()`
3. Aggiornare il select nella UI delle impostazioni

### Aggiungere/rimuovere un job via API

```bash
# Crea job
POST /api/jobs
{
  "job_type": "ping_sweep",
  "network_id": 1,          # null = tutte le reti
  "interval_minutes": 60
}

# Il job viene creato in DB e immediatamente schedulato nello scheduler in-memory
# Al riavvio del server, viene ricaricato da DB via initializeScheduler()
```

---

## 9. Crittografia credenziali

```typescript
// src/lib/crypto.ts

// Algoritmo: AES-256-GCM
// Chiave: scryptSync(ENCRYPTION_KEY, "da-invent-salt", 32)
// Formato stored: "iv:tag:ciphertext" (tutti hex)

export function encrypt(plaintext: string): string
export function decrypt(ciphertext: string): string    // lancia se corrotto
export function safeDecrypt(ciphertext: string | null): string | null  // null se errore
```

**Regola:** usare `safeDecrypt()` nei path non critici (display, listing), `decrypt()` solo dove il fallimento deve propagarsi (es. apertura connessione SSH).

**ENCRYPTION_KEY:** deve essere stabile. Se cambiata, tutte le credenziali cifrate diventano inaccessibili.

---

## 10. Frontend: componenti e pattern UI

### shadcn/ui v4 — differenze da v3/radix

```tsx
// ❌ shadcn v3 (radix-ui) — NON usare
<DialogTrigger asChild>
  <Button>Apri</Button>
</DialogTrigger>

// ✅ shadcn v4 (base-ui/react) — usare questa sintassi
<DialogTrigger render={<Button />}>
  Apri
</DialogTrigger>
```

### Pattern Server Component → Client Component

```tsx
// Server Component (page.tsx) — lettura diretta DB, nessun fetch
export default async function NetworksPage() {
  const networks = getNetworksWithStats(); // diretta
  return <NetworksListClient initialNetworks={networks} />;
}

// Client Component — mutazioni via fetch + router.refresh()
"use client";
export function NetworksListClient({ initialNetworks }) {
  const router = useRouter();
  async function handleCreate(data) {
    await fetch("/api/networks", { method: "POST", body: JSON.stringify(data) });
    router.refresh(); // re-fetch Server Component
  }
}
```

### Dialogs annidati

Due Dialog non devono essere semanticamente annidati (focus trap). Usare stati separati:

```tsx
const [mainOpen, setMainOpen] = useState(false);
const [nestedOpen, setNestedOpen] = useState(false);

// Entrambi come fratelli nel JSX, non uno dentro l'altro
<>
  <Dialog open={mainOpen} onOpenChange={setMainOpen}>...</Dialog>
  <Dialog open={nestedOpen} onOpenChange={setNestedOpen}>...</Dialog>
</>
```

### Select onValueChange — null-safe

`@base-ui/react` Select può passare `null` a `onValueChange`. Sempre fare null-check:

```tsx
<Select
  value={vendor}
  onValueChange={(v) => setVendor(v ?? "default")}  // ← null-safe
>
```

### setInterval in componenti — cleanup obbligatorio

```tsx
useEffect(() => {
  const id = setInterval(fetchData, 5000);
  return () => clearInterval(id); // ← cleanup obbligatorio
}, []);
```

### GlobalSearch — Cmd+K

```tsx
// src/components/shared/global-search.tsx
// Attivazione via keyboard event su document
// Query: GET /api/search?q=<input>
// Debounce 300ms, min 2 caratteri
```

### Palette colori (CSS variables in globals.css)

```css
/* Domarc colors */
--primary: #00A7E7;        /* Blu Domarc */
--primary-navy: #0D2537;   /* Navy scuro (sidebar, sfondo dark) */
--primary-gold: #FFD400;   /* Gold (accenti) */
--background: #EDEDED;     /* Sfondo chiaro */

/* Mappate su: --card, --sidebar, --foreground, ecc. */
```

### ThemeToggle

`next-themes` con `storageKey="theme"`. Script inline nel `<head>` previene il FOUC (flash of unstyled content) prima dell'hydration.

---

## 11. Validazione (Zod v4)

### Differenze Zod v4 da v3

```typescript
// ❌ Zod v3
if (!parsed.success) {
  const msg = parsed.error.errors[0].message; // .errors
}

// ✅ Zod v4
if (!parsed.success) {
  const msg = parsed.error.issues[0].message; // .issues
}

// Record con due argomenti obbligatori in v4:
const schema = z.record(z.string(), z.unknown()); // NON z.record(z.unknown())
```

### Schema principali

```typescript
// validators.ts

export const NetworkSchema = z.object({
  cidr: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/, "CIDR non valido"),
  name: z.string().min(1).max(100),
  gateway: z.string().ip().optional().or(z.literal("")),
  vlan_id: z.coerce.number().int().min(1).max(4094).optional().nullable(),
  // ...
});

export const NetworkDeviceSchema = z.object({
  device_type: z.enum(["router", "switch", "hypervisor"]),
  vendor: z.enum(["mikrotik", "ubiquiti", "hp", "cisco", "omada",
                  "stormshield", "proxmox", "vmware", "linux",
                  "windows", "synology", "qnap", "other"]),
  protocol: z.enum(["ssh", "snmp_v2", "snmp_v3", "api", "winrm"]),
  // ...
});
```

---

## 12. Tipi principali

```typescript
// src/types/index.ts (estratto)

interface Network {
  id: number;
  cidr: string;
  name: string;
  gateway?: string | null;
  vlan_id?: number | null;
  router_id?: number | null;
  // ...
}

interface NetworkWithStats extends Network {
  total_hosts: number;
  online_count: number;
  offline_count: number;
  unknown_count: number;
  last_scan: string | null;
}

interface Host {
  id: number;
  network_id: number;
  ip: string;
  mac?: string | null;
  vendor?: string | null;
  hostname?: string | null;
  custom_name?: string | null;
  classification?: string | null;
  status: "online" | "offline" | "unknown";
  open_ports?: string | null;   // JSON string: [{port, protocol}]
  known_host: 0 | 1;
  monitor_ports?: string | null; // JSON array numeri porta
  // ...
}

interface HostDetail extends Host {
  network_cidr: string;
  network_name: string;
  recent_scans: ScanHistory[];
  arp_source?: { device_name: string; interface_name: string } | null;
  switch_port?: {
    device_name: string;
    port_name: string;
    vlan?: number | null;
    speed?: number | null;
    is_trunk: boolean;
  } | null;
  network_device?: {
    id: number;
    name: string;
    device_type: string;
    vendor: string;
  } | null;
}

interface NetworkDevice {
  id: number;
  name: string;
  host: string;
  device_type: "router" | "switch" | "hypervisor";
  vendor: string;
  protocol: "ssh" | "snmp_v2" | "snmp_v3" | "api" | "winrm";
  port: number;
  enabled: 0 | 1;
  credential_id?: number | null;
  snmp_credential_id?: number | null;
  // encrypted_password e community_string mai esposti all'esterno
  // ...
}

interface ScanProgress {
  id: string;            // jobId UUID
  network_id: number;
  scan_type: string;
  status: "running" | "completed" | "failed";
  total: number;
  scanned: number;
  found: number;
  phase: string;
  started_at: string;
  logs?: string[];
}
```

---

## 13. Script e deploy

### `scripts/install.sh`

Installer per LXC Proxmox / Debian / Ubuntu.

```bash
./scripts/install.sh           # Installa dipendenze, build, .env.local
./scripts/install.sh --systemd # Come sopra + installa/abilita servizio systemd
```

**Fasi:**
1. Rileva OS (Debian/Ubuntu)
2. Installa: curl, build-essential, python3, nmap, sqlite3
3. Installa Node.js 20 via nodesource
4. Crea venv Python per WinRM (`~/.da-invent-venv`)
5. `npm ci && npm run build`
6. Genera `.env.local` con ENCRYPTION_KEY e AUTH_SECRET random
7. Con `--systemd`: crea, abilita e avvia `da-invent.service` con `systemctl enable --now`

### `scripts/update.sh`

```bash
./scripts/update.sh           # git pull, npm install, npm run build
./scripts/update.sh --restart # Come sopra + riavvia systemd (root-safe: usa systemctl diretto se id=0)
```

### `scripts/backup.sh`

```bash
DB_PATH=data/ipam.db BACKUP_DIR=data/backups RETENTION_DAYS=7 ./scripts/backup.sh
```

Usa `sqlite3 .backup` (WAL-safe), gzip, elimina backup più vecchi di RETENTION_DAYS.

### `scripts/pct-update.sh`

```bash
# Dal nodo Proxmox, non dentro il CT
./scripts/pct-update.sh <VMID>
DA_INVENT_DIR=/opt/da-invent DA_INVENT_PCT=150 ./scripts/pct-update.sh
```

Esegue `update.sh --restart` nel container tramite `pct exec`.

### `scripts/pull-db-from-pct.sh`

```bash
npm run pull:db
# Oppure:
DA_INVENT_SSH=root@192.168.99.10 DA_INVENT_PCT=150 ./scripts/pull-db-from-pct.sh
```

Copia `ipam.db` (+ WAL/SHM) dal CT al Mac. Richiede conferma "YES" interattiva (il DB del CT può essere vuoto).

### `scripts/restore-local-db.sh`

```bash
./scripts/restore-local-db.sh data/ipam.db.backup-YYYYMMDD-HHMMSS
```

Ripristina un backup locale di ipam.db (rimuove WAL/SHM vecchi).

### Servizio systemd (`deploy/da-invent.service`)

In **container** (LXC/VM dedicata) il servizio è pensato per girare come **`root`**, così `nmap` può eseguire scansioni **UDP** (`-sU`) e ICMP senza capability aggiuntive. Variabili installer: `DA_INVENT_SERVICE_USER` (default `root`), `DA_INVENT_SERVICE_GROUP`.

```ini
[Unit]
Description=DA-INVENT - IP Address Management
After=network.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=/opt/da-invent
ExecStart=/opt/da-invent/node_modules/.bin/tsx /opt/da-invent/server.ts
Restart=on-failure
RestartSec=5
PrivateTmp=true
```

### Nginx reverse proxy (`deploy/nginx-ssl.conf`)

```nginx
# Configurazione base
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
}
```

---

## 14. Regole anti-regressione

### No debug/telemetry in produzione

```typescript
// ❌ MAI in produzione
console.log("debug:", data);
fetch("http://127.0.0.1:3001/api/...");

// ✅ Solo per debug temporaneo (rimuovere prima del commit)
console.warn("[DEBUG]", data);
```

### JSON.parse sempre con try-catch

```typescript
// ❌ SBAGLIATO
const ports = JSON.parse(host.open_ports);

// ✅ CORRETTO
try {
  const ports = JSON.parse(host.open_ports ?? "[]");
} catch {
  // JSON malformato non deve crashare
  const ports = [];
}
```

### Auth check su tutti gli endpoint

```typescript
// Ogni route deve iniziare con:
const authCheck = await requireAuth();     // GET dati sensibili
const adminCheck = await requireAdmin();   // POST/PUT/DELETE
if (isAuthError(authCheck)) return authCheck;
```

### safeDecrypt nei path non critici

```typescript
// Nei listing/display: mai esporre eccezioni di decrypt
const password = safeDecrypt(device.encrypted_password); // null se errore

// Solo dove il fallimento deve propagarsi (apertura connessione):
const password = decrypt(device.encrypted_password); // lancia
```

### CIDR overlap check

`createNetwork()` verifica automaticamente overlap con reti esistenti. Non bypassare questa logica.

### setInterval cleanup

```tsx
// Ogni setInterval in un Client Component:
useEffect(() => {
  const id = setInterval(fn, ms);
  return () => clearInterval(id); // cleanup obbligatorio
}, [deps]);
```

### Result set con LIMIT

Le query per l'UI dovrebbero sempre avere LIMIT o paginazione:

```typescript
// ❌ SBAGLIATO per dataset grandi
const allHosts = db.prepare("SELECT * FROM hosts").all();

// ✅ CORRETTO
const hosts = db.prepare("SELECT * FROM hosts LIMIT ? OFFSET ?").all(pageSize, offset);
```

### Checklist pre-commit

1. `npm run lint` — nessun errore (solo warning accettabili per variabili non usate in legacy code)
2. `npm run build` — build completa senza errori TypeScript
3. No `fetch('http://127.0.0.1:...')` o `console.log` rimasti
4. Ogni nuovo endpoint ha `requireAdmin()` (POST/PUT/DELETE) o `requireAuth()` (GET sensibili)
5. Ogni `JSON.parse` ha try-catch
6. Ogni `setInterval` in componenti client ha cleanup
7. `npm run version:bump` — aggiornare versione prima del commit

---

## 15. Versioning

Il progetto usa **Semantic Versioning** MAJOR.MINOR.PATCH:

- **PATCH** — ogni modifica al codice (fix, feature piccola, refactor, aggiornamento doc)
- **MINOR** — nuova funzionalità significativa
- **MAJOR** — breaking change

```bash
npm run version:bump   # 0.2.55 → 0.2.56
```

Lo script aggiorna automaticamente `package.json` e `package-lock.json`.

La versione corrente è sempre disponibile via:
```bash
curl http://localhost:3001/api/version
```

o in `package.json` → campo `version`.

---

## Appendice A — OID SNMP usati

| OID | Nome | Uso |
|-----|------|-----|
| `1.3.6.1.2.1.1.1.0` | sysDescr | Info sistema completa |
| `1.3.6.1.2.1.1.2.0` | sysObjectID | Identificativo vendor/modello |
| `1.3.6.1.2.1.1.5.0` | sysName | Hostname dispositivo |
| `1.3.6.1.2.1.4.22` | ipNetToMediaTable | ARP table |
| `1.3.6.1.2.1.17.4.3` | dot1dTpFdbTable | MAC table bridge |
| `1.3.6.1.2.1.31.1.1` | ifXTable | Interfacce estese (speed, name) |
| `1.3.6.1.2.1.47.1.1.1` | ENTITY-MIB | Model, S/N, part_number |
| `1.0.8802.1.1.2` | LLDP-MIB | Neighbor discovery |
| `1.3.6.1.2.1.17.2` | dot1dStp | Spanning Tree |
| `1.3.6.1.4.1.9.9.315` | CISCO-POE-MIB | PoE Cisco |
| `1.3.6.1.2.1.105` | POWER-ETHERNET-MIB | PoE generico |

## Appendice B — Vendor SSH — comandi usati

| Vendor | Comando ARP | Comando MAC table | Comando porte |
|--------|------------|-------------------|--------------|
| MikroTik | `/ip arp print detail` | — | `/interface print detail` |
| Ubiquiti | `show arp` | `show mac-address-table` | `show interfaces` |
| Cisco | `show ip arp` | `show mac address-table` | `show interfaces status` |
| HP ProCurve | `show arp` | `show mac-address` | `show interfaces brief` |
| HP Comware | `display arp` | `display mac-address` | `display interface brief` |

## Appendice C — Porte note usate nel sistema

| Porta | Protocollo | Uso |
|-------|-----------|-----|
| 22 | TCP | SSH |
| 80 | TCP | HTTP |
| 135, 445 | TCP | Windows SMB/RPC (rilevamento) |
| 161 | UDP | SNMP |
| 443 | TCP | HTTPS |
| 514 | UDP | Syslog |
| 3389 | TCP | RDP Windows (classificazione) |
| 5985 | TCP | WinRM HTTP |
| 5986 | TCP | WinRM HTTPS |
| 8006 | TCP | Proxmox API |
