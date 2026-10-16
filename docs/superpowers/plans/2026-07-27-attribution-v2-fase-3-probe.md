# Attribution v2 — Fase 3: probe passivi (HTTP/TLS, mDNS, SSDP, WSD, SMB2) Implementation Plan

> Spec: `docs/superpowers/specs/2026-07-26-attribution-v2-design.md` §4.5. Esegue con superpowers:subagent-driven-development.

**Goal:** Dare al motore di attribuzione le sorgenti che oggi gli mancano per gli endpoint senza SNMP né agent: firme HTTP/HTTPS (header `Server`, `<title>`, redirect di login), **certificato TLS (CN/SAN/issuer)**, mDNS, SSDP/UPnP, WS-Discovery e SMB2 — tutti **senza credenziali**.

**Architecture:** I probe girano a scan-time e scrivono **direttamente evidenze** (`recordEvidence`) con le proprie `source` (`http_banner`, `tls_cert`, `mdns`, `ssdp`, `wsd`, `smb`), invece di persistere raw e ri-derivare: sono osservazioni di rete non ricostruibili dalla riga host. Per questo restano **fuori** da `RECOMPUTED_SOURCES` (il recompute non le rigenera e `retireStaleEvidence` non le tocca); la freschezza è data da `expires_at` a 30 giorni, rinnovato a ogni ri-osservazione.

**Tech Stack:** Node `net`/`tls`/`dgram` nativi, `fast-xml-parser` (già in deps), TS strict, better-sqlite3.

## Global Constraints — sicurezza operativa (vincolanti)

- **Zero autenticazione**: nessun probe invia credenziali né tenta login. SMB2 si ferma al NEGOTIATE + NTLMSSP NEGOTIATE anonimo (nessun SESSION_SETUP con password) → **nessun logon fallito**, quindi nessun allarme MDR/XDR del tipo generato da `credential_validate` (vedi vincolo `project-credential-validate-selection-only`).
- **Solo host con almeno una porta aperta** già nota (spec §10): mai probe su IP silenti.
- **Budget di tempo per rete** e timeout stretti per probe (≤ 2 s ciascuno, ≤ 60 s totali per rete); concorrenza limitata (max 8 host in parallelo).
- **Disattivabile per rete**: setting `attribution_probes_enabled` (default ON) + override per rete; se disattivo, nessun pacchetto esce.
- **Unicast, mai multicast/broadcast**: mDNS/SSDP/WSD sono inviati in unicast all'IP del target (spec §4.5), per non generare traffico di scoperta su tutta la LAN.
- Zod v4 `.issues`; TS strict, no `any`; funzioni DB in `db-tenant.ts` E `db.ts`; testi UI in italiano.
- Verifica per task: `npm run lint && npx tsc --noEmit && npm test` puliti.

## File Structure

| File | Ruolo |
|---|---|
| `src/lib/scanner/probes/http-tls.ts` (nuovo) | GET su porte note + certificato TLS |
| `src/lib/scanner/probes/mdns.ts` (nuovo) | query unicast mDNS + parsing TXT |
| `src/lib/scanner/probes/ssdp.ts` (nuovo) | M-SEARCH unicast + fetch XML device |
| `src/lib/scanner/probes/wsd.ts` (nuovo) | WS-Discovery Probe UDP 3702 |
| `src/lib/scanner/probes/smb2.ts` (nuovo) | NEGOTIATE + NTLMSSP anonimo |
| `src/lib/attribution/probe-evidence.ts` (nuovo) | probe result → EvidenceInput[] (funzioni pure) |
| `src/lib/scanner/probes/run-probes.ts` (nuovo) | orchestratore: gating, budget, concorrenza, recordEvidence |
| `src/lib/scanner/discovery.ts` (mod) | invoca i probe nella fase porte |

---

### Task 1: HTTP/TLS — probe + evidenze

**Files:** create `src/lib/scanner/probes/http-tls.ts`, `src/lib/attribution/probe-evidence.ts`; test `src/lib/attribution/__tests__/probe-evidence.test.ts`.

**Interfaces:**
```ts
export interface HttpTlsFinding {
  port: number; scheme: "http" | "https";
  server: string | null;        // header Server
  title: string | null;         // <title> (max 120 char, trim)
  realm: string | null;         // WWW-Authenticate realm
  location: string | null;      // redirect Location
  tlsSubjectCn: string | null; tlsSan: string[]; tlsIssuer: string | null;
}
export async function probeHttpTls(ip: string, openPorts: number[], opts?: { timeoutMs?: number }): Promise<HttpTlsFinding[]>
// probe-evidence.ts (PURA):
export function evidenceFromHttpTls(findings: HttpTlsFinding[]): EvidenceInput[]
```

- Porte tentate: intersezione di `openPorts` con `[80,443,8080,8443,9443,7080,8006,5000,5001,631,9100,8000,8081]`. Mai porte chiuse.
- HTTPS via `tls.connect({ rejectUnauthorized: false, servername: ip })` → `getPeerCertificate()`: `subject.CN`, `subjectaltname` (parse `DNS:`/`IP Address:`), `issuer.CN`. GET `/` con `Connection: close`, max 64 KB di body, timeout 2 s.
- **Regole di attribuzione** (`evidenceFromHttpTls`, sorgenti `http_banner` per header/title, `tls_cert` per il certificato; `phase: "scan_naabu"`, `expires_at` = +30 giorni):
  - vendor da `Server`: `nginx|apache|lighttpd|IIS` → NON emettere vendor (sono web server generici, non produttori del dispositivo); `MikroTik|RouterOS`→mikrotik+`network.router`; `Ubiquiti|UniFi`→ubiquiti; `Synology|DSM`→synology+`storage.nas`; `QNAP|QTS`→qnap+`storage.nas`; `HP HTTP Server|HP-ChaiSOE`→hp+`peripheral.printer`; `iLO`→hpe+`compute.server`; `iDRAC`→dell+`compute.server`; `Proxmox`→proxmox+`compute.hypervisor`; `VMware|ESXi`→vmware+`compute.hypervisor`.
  - categoria da `<title>`: `printer|imageRUNNER|WorkCentre|Brother|Kyocera|Lexmark`→`peripheral.printer`; `camera|NVR|Hikvision|Dahua|ONVIF`→`av.camera`; `router|gateway|firewall|pfSense|OPNsense`→`network.firewall` (pfSense/OPNsense) o `network.router`; `switch`→`network.switch`; `NAS|DiskStation|TrueNAS`→`storage.nas`; `UPS|PowerChute`→`power.ups`; `Proxmox|vSphere|ESXi`→`compute.hypervisor`.
  - **certificato TLS**: CN/SAN sono spesso auto-dichiarativi — `*.ui.com|unifi`→ubiquiti; `synology`→synology; `QNAP`→qnap; `iLO|Integrated Lights-Out`→hpe+`compute.server`; `iDRAC`→dell+`compute.server`; `pfSense|OPNsense`→`network.firewall`; `VMware`→vmware. Issuer contenente il nome del vendor vale come conferma vendor a confidence più bassa.
  - Confidence: `Server` esplicito di prodotto 0.85 · `<title>` 0.7 · CN/SAN 0.8 · issuer 0.6. Mai claim vuoti; deduplica per (dimension, claim) tenendo la confidence più alta.
- Test tabellari su `evidenceFromHttpTls` (pura): almeno 10 casi che coprono le famiglie sopra + il caso "solo nginx" → nessuna evidenza vendor.

### Task 2: SMB2 e mDNS

**Files:** create `src/lib/scanner/probes/smb2.ts`, `src/lib/scanner/probes/mdns.ts`; estendere `probe-evidence.ts` e i test.

```ts
export interface Smb2Finding { osVersion: string | null; netbiosName: string | null; dnsDomain: string | null; signingRequired: boolean }
export async function probeSmb2(ip: string, opts?: { timeoutMs?: number }): Promise<Smb2Finding | null>
export interface MdnsFinding { services: string[]; model: string | null; usbMfg: string | null; usbMdl: string | null; hapCategory: number | null }
export async function probeMdns(ip: string, opts?: { timeoutMs?: number }): Promise<MdnsFinding | null>
export function evidenceFromSmb2(f: Smb2Finding): EvidenceInput[]
export function evidenceFromMdns(f: MdnsFinding): EvidenceInput[]
```
- **SMB2** (porta 445 aperta): NEGOTIATE (dialetti 0x0202-0x0311) poi SESSION_SETUP con **NTLMSSP NEGOTIATE anonimo**; dalla CHALLENGE leggi `Version` (major.minor.build) e AV_PAIRS (`MsvAvNbComputerName`, `MsvAvDnsDomainName`). **Nessuna password inviata, nessun tentativo di autenticazione** → non produce logon falliti. Evidenza: `os` = `windows` conf 0.9 + `os_name` = build (`raw_value`), categoria `compute` conf 0.5 (server vs workstation lo decide AD/altre evidenze).
- **mDNS** (unicast UDP 5353): query PTR per `_services._dns-sd._udp.local`, poi TXT per `_device-info._tcp`, `_ipp._tcp`, `_hap._tcp`, `_airplay._tcp`, `_googlecast._tcp`. Evidenze: `_ipp`/`_pdl-datastream` → `peripheral.printer` conf 0.9 + vendor/modello da `usb_MFG`/`usb_MDL`; `_hap` con `ci=` → mappa HomeKit category (2=bridge,5=lampadina,…,17=camera→`av.camera`) conf 0.75; `_airplay`/`_googlecast` → `av.display` conf 0.7; `model=` di `_device-info` → vendor/modello.
- Se il parsing fallisce o il pacchetto è malformato → `null`, mai eccezioni propagate.

### Task 3: SSDP e WS-Discovery

**Files:** create `src/lib/scanner/probes/ssdp.ts`, `wsd.ts`; estendere `probe-evidence.ts` e i test.

```ts
export interface SsdpFinding { st: string | null; server: string | null; location: string | null; manufacturer: string | null; modelName: string | null; deviceType: string | null }
export async function probeSsdp(ip: string, opts?: { timeoutMs?: number }): Promise<SsdpFinding | null>
export interface WsdFinding { types: string[]; scopes: string[] }
export async function probeWsd(ip: string, opts?: { timeoutMs?: number }): Promise<WsdFinding | null>
export function evidenceFromSsdp(f: SsdpFinding): EvidenceInput[]
export function evidenceFromWsd(f: WsdFinding): EvidenceInput[]
```
- **SSDP**: M-SEARCH unicast a `<ip>:1900` (`ST: ssdp:all`, `MX: 1`); se arriva `LOCATION`, GET dell'XML (timeout 2 s, max 64 KB) e parsing con `fast-xml-parser` → `manufacturer`, `modelName`, `deviceType`. `WLANAccessPointDevice`→`network.access_point` 0.85; `InternetGatewayDevice`→`network.router` 0.8; `MediaRenderer`→`av.display` 0.7; `Printer`→`peripheral.printer` 0.85.
- **WSD**: Probe SOAP a UDP 3702; `NetworkVideoTransmitter`→`av.camera` **conf 0.95 (già autoritativa in `AUTHORITATIVE_SOURCES.category`)**; `PrintDeviceType`/`PrinterServiceType`→`peripheral.printer` 0.9; `Device`+`Computer`→`compute` 0.5.

### Task 4: Orchestratore, gating e wiring nello scan

**Files:** create `src/lib/scanner/probes/run-probes.ts`; mod `src/lib/scanner/discovery.ts`, `src/lib/db-tenant.ts`+`db.ts` (setting per rete), `src/app/api/networks/[id]/scan-phases/route.ts` (testo fase).

```ts
export interface ProbeRunResult { hostsProbed: number; evidenceWritten: number; skipped: number; elapsedMs: number }
export async function runAttributionProbes(networkId: number, hosts: Array<{ id: number; ip: string; openPorts: number[] }>, opts?: { budgetMs?: number; concurrency?: number }): Promise<ProbeRunResult>
```
- Gating (in quest'ordine): setting globale `attribution_probes_enabled` ≠ "0" → override per rete `networks.probes_enabled` (colonna nuova, ALTER idempotente, default 1) → host con `openPorts.length > 0`.
- Budget: default 60 s per rete, concorrenza 8, timeout 2 s per probe; allo scadere si ferma e logga quanti host sono rimasti fuori (mai troncamento silenzioso).
- Per ogni host: esegue in parallelo i probe applicabili alle sue porte aperte (445→smb2; 1900/UPnP→ssdp; 3702→wsd; 5353→mdns; porte web→http-tls; mDNS/SSDP/WSD tentati anche senza porta nota se l'host ha almeno una porta aperta, sono UDP e non compaiono nei port scan TCP), unisce le evidenze e chiama `recordEvidence` una volta sola, poi `recomputeAttributionSafe(hostId, "scan")`.
- Wiring: chiamato in `discovery.ts` al termine della fase porte (dopo che `open_ports` è persistito) per `scan_naabu`, `scan_nmap_base`, `network_discovery`. Errori del blocco probe **non** interrompono lo scan (try/catch con `console.error`).
- Aggiornare il testo `adds` della fase porte in `scan-phases/route.ts` per citare i nuovi segnali.

### Task 5: Verifica finale + release
- `npm run lint && npx tsc --noEmit && npm test && npm run build` puliti; merge su `dev`, `version:release`, push; deploy VM 533 e verifica su rete reale (evidenze per source, delta categoria/OS).

## Fuori scope
- Fingerbank e AI (Fase 5). KB vendorizzata e `mac_product_map` (Fase 2). Ritiro del legacy (Fase 4).
