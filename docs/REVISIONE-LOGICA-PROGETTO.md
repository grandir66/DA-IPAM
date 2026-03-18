# Revisione logica DA-IPAM vs requisiti

Documento di verifica della copertura funzionale rispetto ai requisiti descritti.

---

## 1) Reti con dati utili e credenziali di default (SSH, SNMP, WMI)

| Aspetto | Stato | Dettaglio |
|---------|-------|-----------|
| **Dati rete** | ✅ | `networks`: cidr, name, description, gateway, vlan_id, location, snmp_community, dns_server |
| **SNMP default** | ✅ | `networks.snmp_community` usato per discovery SNMP e profili nmap |
| **SSH default** | ⚠️ Parziale | Non c’è `credential_id` sulla rete. Le credenziali SSH sono sui **router** assegnati alla rete (`network_router` → `network_devices.credential_id`). Assegnazione bulk: `/api/networks/bulk-assign-credential` |
| **WMI default** | ⚠️ Parziale | Credenziali Windows globali in `settings.host_windows_credential_id`, non per rete |

**File:** `db-schema.ts`, `db.ts`, `api/networks/bulk-assign-credential/route.ts`, `settings`

---

## 2) Scansione: ping, nmap, SNMP, MAC (router), DHCP

| Modalità | Stato | Dettaglio |
|----------|-------|-----------|
| **Ping** | ✅ | `discoverNetwork(..., "ping")` → `pingSweep` in `discovery.ts` |
| **Nmap** | ✅ | `discoverNetwork(..., "nmap", nmapArgs)` con profili (Quick, Standard, Completo, Personalizzato) |
| **SNMP approfondita** | ✅ | `discoverNetwork(..., "snmp")` → sysName, sysDescr, sysObjectID, model, serial |
| **MAC da router (ARP)** | ✅ | `runArpPoll` interroga router per subnet remote; `network_router` associa rete ↔ router |
| **DHCP** | ✅ | Solo MikroTik SSH: `getDhcpLeases()` in `runArpPoll` e `runDhcpPollForNetwork` |

**File:** `lib/scanner/discovery.ts`, `lib/cron/jobs.ts`, `lib/devices/router-client.ts`, `api/scans/trigger/route.ts`

---

## 3) Tabella con il maggior numero di dati possibili

| Fonte | Stato | Campi |
|-------|-------|-------|
| **hosts** | ✅ | ip, mac, vendor, hostname, dns_forward, dns_reverse, custom_name, classification, status, open_ports, os_info, model, serial_number, last_seen |
| **mac_ip_mapping** | ✅ | MAC-IP cumulativo da arp, dhcp, host, switch; UNIQUE su mac_normalized |
| **scan_history** | ✅ | Storico scan per host/rete |
| **Aggregazione** | ✅ | `upsertHost` aggrega da ping, nmap, SNMP, ARP, DHCP, switch, DNS |

**File:** `db-schema.ts`, `db.ts`, `discovery.ts`, `cron/jobs.ts`

---

## 4) Monitoraggio stato tramite ping

| Aspetto | Stato | Dettaglio |
|---------|-------|-----------|
| **Abilitazione host** | ✅ | `hosts.known_host = 1` per host da monitorare |
| **Job schedulato** | ✅ | `known_host_check` in `scheduled_jobs` |
| **Ping + fallback TCP** | ✅ | `runKnownHostCheck` → ping, poi TCP su porte 22, 80, 443, 3389, 5985 |
| **Aggiornamento status** | ✅ | `updateHost(..., { status: "online" \| "offline" })` |
| **status_history** | ⚠️ Parziale | `addStatusHistory` usato solo in discovery, non in `runKnownHostCheck` |

**File:** `lib/cron/jobs.ts` (runKnownHostCheck), `lib/db.ts` (getKnownHosts, addStatusHistory)

---

## 5) Trasformazione host → device con tipologia, accesso, credenziali, brand

| Aspetto | Stato | Dettaglio |
|---------|-------|-----------|
| **Creazione device** | ✅ | Da host singolo o bulk: `createNetworkDevice` con classification, vendor, protocol, credential_id |
| **Tipologia** | ✅ | `device_type`: router, switch, hypervisor. `classification`: access_point, server, firewall, ecc. |
| **Modalità accesso** | ✅ | `protocol`: ssh, snmp_v2, snmp_v3, api, winrm |
| **Credenziali** | ✅ | `credential_id`, `snmp_credential_id`; inline: username, encrypted_password, community_string |
| **Brand** | ✅ | `vendor`: mikrotik, ubiquiti, hp, cisco, omada, stormshield, proxmox, vmware, linux, windows, synology, qnap, other. `vendor_subtype`: procurve, comware |

**File:** `api/devices/route.ts`, `api/devices/bulk/route.ts`, `network-detail-client.tsx`, `device-list-by-classification.tsx`

---

## 6) Device solo classificazione (senza device completo)

| Aspetto | Stato | Dettaglio |
|---------|-------|-----------|
| **Host con classificazione** | ✅ | `hosts.classification` può essere impostato senza creare `network_device` |
| **Lista unificata** | ✅ | `getDevicesByClassificationOrLegacy` + `getHostsByClassification` restituiscono host e device insieme |
| **UI** | ✅ | Pagine `/devices/*` mostrano host classificati e device; filtro per classificazione |

**File:** `api/devices/route.ts`, `api/hosts/[id]/route.ts`, `device-list-by-classification.tsx`

---

## 7) Credenziali multiple e tipi diversi

| Aspetto | Stato | Dettaglio |
|---------|-------|-----------|
| **Tipi** | ✅ | ssh, snmp, api, windows, linux |
| **Per device** | ✅ | `credential_id` (SSH/API/WinRM) + `snmp_credential_id` (SNMP) |
| **Multiple per device** | ✅ | SSH + SNMP separate; `credential_id` e `snmp_credential_id` |
| **Profilo** | ✅ | `protocol` determina quale usare (ssh, snmp_v2, snmp_v3, api, winrm) |

**File:** `db-schema.ts`, `db.ts` (getDeviceCredentials, getDeviceCommunityString, getDeviceSnmpV3Credentials)

---

## 8) Scansione device per acquisizione dati

| Aspetto | Stato | Dettaglio |
|---------|-------|-----------|
| **Acquisizione** | ✅ | `getDeviceInfo` in `device-info.ts` con SNMP, SSH, WinRM, API |
| **Protocolli** | ✅ | SNMP (sysDescr, sysName, ENTITY-MIB), SSH (vendor-specific), WinRM/WMI (Windows), API (Proxmox, Omada) |
| **Storage statico** | ✅ | `last_device_info_json`, `last_info_update`; `sysname`, `sysdescr`, `model`, `firmware`, `serial_number` |
| **Collasso duplicati** | ⚠️ Parziale | `mac_ip_mapping` ha UNIQUE su mac_normalized. Host con stesso IP in reti diverse: `UNIQUE(network_id, ip)`. Un host può apparire in più reti come record separati; non c’è unione automatica per MAC |

**File:** `lib/devices/device-info.ts`, `api/devices/[id]/query/route.ts`, `db-schema.ts`

---

## Brand e tipologie supportati

| Brand | Stato | Note |
|-------|-------|------|
| MikroTik | ✅ | Router, ARP, DHCP leases |
| Ubiquiti | ✅ | Switch, SSH, SNMP |
| Proxmox | ✅ | Hypervisor, API |
| VMware | ✅ | Vendor |
| Windows | ✅ | WinRM/WMI |
| Linux | ✅ | SSH, getDeviceInfoFromLinux |
| HP Procurve | ✅ | vendor_subtype procurve |
| HP Comware | ✅ | vendor_subtype comware |
| Cisco | ✅ | Router, switch |
| Omada | ✅ | API |
| Synology | ✅ | SSH |
| QNAP | ✅ | SSH |
| Stormshield | ✅ | Vendor |
| Estendibilità | ✅ | `other` + vendor_subtype; CHECK in DB estendibile tramite migration |

---

## Gap e raccomandazioni

1. **Credenziali default per rete**  
   - SSH: attualmente sui router. Per reti senza router assegnato non c’è credenziale SSH di default.  
   - WMI: solo globale. Possibile estensione con `credential_id` sulla rete.  

2. **status_history in known_host_check**  
   - `runKnownHostCheck` aggiorna `hosts.status` ma non chiama `addStatusHistory`.  
   - La timeline di uptime potrebbe non riflettere i check schedulati.  

3. **Collasso per MAC**  
   - `mac_ip_mapping` collassa per MAC.  
   - Gli host con stesso MAC in reti diverse restano record separati in `hosts` (UNIQUE per network_id + ip).  

4. **DHCP**  
   - Solo MikroTik SSH. Nessun supporto per DHCP server Cisco, Windows, Linux, ecc.  

---

## Riepilogo

| # | Requisito | Copertura |
|---|-----------|-----------|
| 1 | Reti + credenziali default | ⚠️ SNMP sì, SSH via router, WMI globale |
| 2 | Scansione (ping, nmap, SNMP, ARP, DHCP) | ✅ |
| 3 | Tabella dati ricca | ✅ |
| 4 | Monitoraggio ping | ✅ (status_history parziale) |
| 5 | Host → device | ✅ |
| 6 | Solo classificazione | ✅ |
| 7 | Credenziali multiple | ✅ |
| 8 | Scansione device + storage | ✅ (collasso parziale) |
