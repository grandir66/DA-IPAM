# Flowchart dell’analisi — DA-INVENT

Documento di **verifica funzionale**: descrive in sequenza le fasi di acquisizione dati, onboarding, scansioni e collegamento switch↔IPAM. I riferimenti al codice permettono di controllare che la documentazione sia allineata all’implementazione.

**Versione progetto:** vedi `package.json` → `version`.

---

## 1. Panoramica: dal primo avvio all’analisi della subnet

```mermaid
flowchart TB
  subgraph setup["Setup iniziale"]
    A[/setup — crea admin/] --> B[/login/]
  end

  subgraph onboard["Configurazione guidata prima esecuzione"]
    B --> C{onboarding_completed?}
    C -->|No| D[/onboarding — wizard/]
    D --> E[Router, DNS, credenziali, AD opz., prima rete]
    E --> F[PUT settings onboarding_completed=1]
  end

  subgraph dash["Dashboard e rete"]
    C -->|Sì o dopo F| G[/ — dashboard/]
    F --> H[/networks/id — scheda rete/]
    G --> H
  end

  subgraph analisi["Analisi dati"]
    H --> I[Job schedulati / Scan manuali / Discovery]
    I --> J[(SQLite: hosts, arp_entries, dhcp_leases, ad_computers, switch_ports, …)]
  end
```

**Controlli nel codice**

| Elemento | Dove |
|----------|------|
| Flag `onboarding_completed` | `src/lib/db.ts` (`settings`), migrazione in `getDb()` |
| Wizard UI | `src/app/onboarding/onboarding-wizard.tsx` |
| Redirect se onboarding incompleto | `src/components/shared/app-shell.tsx` + `GET /api/onboarding/status` |
| Pipeline concettuale 15 fasi | `src/lib/scanner/subnet-evaluation-pipeline.ts` |

---

## 2. Configurazione guidata (`/onboarding`) — ordine operativo

Sequenza proposta al primo accesso (dopo login), prima di marcare `onboarding_completed`.

```mermaid
flowchart LR
  S1[1. Router / gateway] --> S2[2. DNS default rete]
  S2 --> S3[3. Credenziali archivio]
  S3 --> S4[4. Active Directory opz.]
  S4 --> S5[5. Prima subnet]

  S1 -.->|POST| API_DEV["/api/devices"]
  S2 -.->|PUT| SET_DNS["settings: default_network_dns"]
  S3 -.->|POST| API_CRED["/api/credentials"]
  S3 -.->|PUT| SET_HOST["host_windows_credential_id, host_linux_credential_id"]
  S4 -.->|POST| API_AD["/api/ad"]
  S5 -.->|POST| API_NET["/api/networks"]
```

**Esito**

- **Crea rete e apri analisi:** `POST /api/networks` → redirect a `/networks/{id}`.
- **Esci / Salta rete:** solo `onboarding_completed=1` → dashboard.

---

## 3. Modello logico: “prima analisi” subnet (15 fasi)

Ordine e titoli sono definiti in **`SUBNET_EVALUATION_PHASES`** (`subnet-evaluation-pipeline.ts`). Non esiste un singolo job che esegue tutte le fasi in un unico comando; molte sono **azioni distinte** (UI, API, cron) collegate dagli stessi dati.

```mermaid
flowchart TB
  P1[1 ARP e vendor] --> P2[2 DHCP statico/dinamico]
  P2 --> P3[3 Computer AD]
  P3 --> P4[4 ICMP discovery]
  P4 --> P5[5 Nmap soft / quick]
  P5 --> P6[6 SNMP leggero]
  P6 --> P7[7 Nmap avanzato]
  P7 --> P8[8 SNMP walk vendor]
  P8 --> P9[9 OS Win/Linux]
  P9 --> P10[10 Catena credenziali auto]
  P10 --> P11[11 Revisione manuale]
  P11 --> P12[12 Flag monitoraggio]
  P12 --> P13[13 Promozione a dispositivo]
  P13 --> P14[14 Scan approfondito device]
  P14 --> P15[15 Switch porta ↔ IPAM]
```

### Tabella di tracciamento (verifica implementazione)

| # | ID fase | Cosa fa | Riferimento implementazione |
|---|---------|---------|------------------------------|
| 1 | `arp_vendor` | MAC↔IP, vendor OUI | `arp_poll`, `arp_entries`, campi host |
| 2 | `dhcp_leases` | Lease → `ip_assignment` | `dhcp_leases`, `ad_dhcp_leases`, `syncIpAssignmentsForNetwork` |
| 3 | `ad_computers` | Allineamento PC AD ↔ host | `ad-client` sync, `ad_computers`, link host |
| 4 | `icmp_discovery` | Ping sweep | `scan_type` `ping`, `network_discovery`, `ipam_full` fase 1 |
| 5 | `nmap_soft` | Porte TCP quick | `network_discovery`, `ipam_full` fase 2 |
| 6 | `snmp_light` | sysName/sysDescr/OID base | `network_discovery`/`nmap`/`ipam_full` fase 3, `snmp` scan |
| 7 | `nmap_advanced` | Profilo Nmap pieno | `scan_type` `nmap` + `nmap_profiles` |
| 8 | `snmp_walk_vendor` | OID per vendor | `snmp_vendor_profiles`, scan SNMP |
| 9 | `os_detect_win_linux` | WinRM / SSH | `scan_type` `windows`, `ssh`; in `ipam_full` solo SSH integrato |
| 10 | `credential_chain_auto` | Prove credenziali rete | `network_host_credentials`, `host_detect_credential` |
| 11 | `manual_review` | UI host/rete | `PUT /api/hosts/[id]` |
| 12 | `monitor_flag` | Host conosciuti | `known_host`, job `known_host_check` |
| 13 | `promote_to_device` | Host → `network_device` | `POST /api/devices/bulk`, ecc. |
| 14 | `device_deep_scan` | Query router/switch/API | client dispositivo, scan dedicati |
| 15 | `switch_port_ipam_link` | MAC su porta → host | `resolveMacToDevice`, `switch_ports.host_id`, ARP poll |

---

## 4. Orchestrazione interna: `discoverNetwork` (`discovery.ts`)

Tipi di scan: `ping` | `network_discovery` | `snmp` | `nmap` | `windows` | `ssh` | `ipam_full`.

### 4.1 `network_discovery`

**Sequenza nel codice:** ICMP → Nmap TCP quick sugli online → (blocco comune) persistenza host/classificazione → **ARP dal router** sugli IP online → annotazione host non rispondenti.

```mermaid
flowchart TB
  ND1[Ping sweep ICMP] --> ND2[Nmap quick TCP in batch]
  ND2 --> ND3[Merge risultati + DNS/DB / classificazione]
  ND3 --> ND4[Post: ARP router solo per IP online]
  ND4 --> ND5[Note host non rispondenti]
```

### 4.2 `ipam_full` (pipeline in 4 + post)

```mermaid
flowchart TB
  IF1["Fase 1: ICMP ping sweep"] --> IF2["Fase 2: Nmap quick TCP"]
  IF2 --> IF3["Fase 3: SNMP multi-community / OID"]
  IF3 --> IF4["Fase 4: SSH Linux — catena credenziali"]
  IF4 --> IF5["Post: ARP router — onlyEnrichIps online"]
  IF5 --> IF6["Note host non rispondenti"]
```

**Nota:** la fase WinRM non è inclusa dentro `ipam_full`; per Windows usare lo scan separato `scan_type` **`windows`** (dopo aver popolato le porte con Nmap).

### 4.3 Scansioni “solo ruolo”

```mermaid
flowchart LR
  subgraph solo["Scan mirati su host selezionati"]
    W[windows — WinRM] --> WC[Catena credenziali Windows + binding]
    SH[ssh — SSH Linux] --> SC[Catena SSH/Linux + binding]
    SN[snmp — solo SNMP] --> SD[sysName/sysDescr/…]
    NM[nmap — profilo attivo] --> NP[TCP/UDP + SNMP inline se profilo]
  end
```

**API:** `POST /api/scans/trigger` con `scan_type` e `host_ids` (per tipi manuali è richiesta la selezione IP). Vedi `src/app/api/scans/trigger/route.ts`.

---

## 5. Flusso ARP, DHCP e DNS (trigger e dati)

```mermaid
flowchart TB
  subgraph arp["ARP"]
    R1[Router registrato + rete collegata] --> R2[runArpPoll / azione ARP su scan]
    R2 --> R3[(arp_entries, hosts.mac, vendor)]
  end

  subgraph dhcp["DHCP"]
    D1[Router/API/AD DHCP] --> D2[runDhcpPollForNetwork / sync AD]
    D2 --> D3[(dhcp_leases, ad_dhcp_leases)]
    D3 --> D4[syncIpAssignmentsForNetwork → hosts.ip_assignment]
  end

  subgraph dns["DNS"]
    N1[Rete.dns_server o sistema] --> N2[runDnsResolve / discovery]
    N2 --> N3[(dns_forward, dns_reverse)]
  end
```

**Trigger manuale** (`/api/scans/trigger`): `arp_poll`, `dhcp`, `dns` su `network_id` (+ host selezionati dove previsto).

---

## 6. Active Directory: sync e DHCP Microsoft

```mermaid
flowchart LR
  AD1[Integrazione LDAP in ad_integrations] --> AD2[Sync computer/utenti/gruppi]
  AD2 --> AD3[Link host IPAM — ad_computers.host_id]
  AD2 --> AD4[Lease DHCP da AD — ad_dhcp_leases]
  AD4 --> AD5[Contributo a ip_assignment]
```

Implementazione principale: `src/lib/ad/ad-client.ts` (sync), tabelle `ad_*` in `src/lib/db.ts`.

---

## 7. Switch: MAC su porta → IPAM

Allineato a `implementationHint` fase 15 della pipeline.

```mermaid
flowchart TB
  SW1[Client switch — MAC table / port schema] --> SW2{Un solo MAC sulla porta?}
  SW2 -->|Sì| SW3[resolveMacToDevice MAC]
  SW3 --> SW4[host_id + IP se in IPAM]
  SW4 --> SW5[(switch_ports.host_id, mac_ip_mapping)]
  SW2 -->|No / trunk| SW6[Euristica trunk / neighbor]
```

Codice di riferimento: `runArpPoll` / creazione client switch in `src/lib/cron/jobs.ts`, `resolveMacToDevice` in `src/lib/db.ts`.

---

## 8. Job schedulati (cron) — mappa tipi

```mermaid
flowchart LR
  J1[ping_sweep] --> JW[runPingSweep]
  J2[snmp_scan] --> JW2[runSnmpScan]
  J3[nmap_scan] --> JW3[runNmapScan]
  J4[arp_poll] --> JW4[runArpPoll globale]
  J5[dns_resolve] --> JW5[runDnsResolve]
  J6[known_host_check] --> JW6[runKnownHostCheck]
  J7[cleanup] --> JW7[runCleanup]
```

Definizione switch: `src/lib/cron/jobs.ts` → `runJob`.

---

## 9. Classificazione e fingerprint (dopo porte/SNMP)

Ordine semplificato documentato in `docs/DEVICE-ASSIGNMENT-E-MAPPING.md` e nel codice `discovery.ts`:

```mermaid
flowchart LR
  F1[classifyDevice] --> F2[Fingerprint TCP/SNMP]
  F2 --> F3[Regole DB fingerprint_classification_map]
  F3 --> F4[hosts.classification + detection_json]
```

---

## 10. Checklist di verifica manuale

Usare questa lista per un test end-to-end su ambiente di prova.

1. **Setup:** creare admin, login, completare o saltare `/onboarding`.
2. **Rete:** almeno un router in `network_devices`, rete con CIDR, DNS se necessario, credenziali collegate alla rete.
3. **Discovery:** eseguire `network_discovery` o `ipam_full` dalla UI (o API) su una subnet piccola; verificare progress e log.
4. **ARP:** dopo discovery, verificare MAC su host; oppure job `arp_poll` dedicato.
5. **DHCP:** se applicabile, polling DHCP e valori `ip_assignment` in tabella host.
6. **AD:** se configurato, sync e presenza `ad_dns_host_name` dove previsto.
7. **Switch:** dopo poll che include switch, verificare `switch_ports` e collegamento host per porte a MAC singolo.
8. **Credenziali:** scan `windows` / `ssh` su IP selezionati con porte già note; verificare `host_detect_credential`.

---

## 11. File e endpoint principali (indice rapido)

| Area | File / route |
|------|----------------|
| Pipeline fasi (meta) | `src/lib/scanner/subnet-evaluation-pipeline.ts` |
| Orchestrazione scan | `src/lib/scanner/discovery.ts` |
| Trigger scan manuale | `src/app/api/scans/trigger/route.ts` |
| Job cron | `src/lib/cron/jobs.ts`, `src/lib/cron/scheduler.ts` |
| Onboarding | `src/app/onboarding/*`, `src/app/api/onboarding/status/route.ts` |
| AD | `src/lib/ad/ad-client.ts`, `src/app/api/ad/*` |
| Auth API admin | `src/lib/api-auth.ts` (`requireAdmin` su POST mutazioni) |
| Assegnazione tipo host (SNMP + fingerprint + anomalie) | `docs/IPAM-ASSEGNAZIONE-DEVICE-SNMP-FINGERPRINT.md` |

---

*Documento generato per supportare audit e regression test del flusso di analisi. Aggiornare questo file quando si aggiungono nuove fasi o si unifica l’orchestrazione in un unico job.*
