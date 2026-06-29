# Core IPAM (Networks, Hosts/Devices, Discovery, Software Inventory) — DA-IPAM

## Scopo nel progetto

È il cuore di DA-IPAM: gestione di **reti (networks)**, **host e device**,
**discovery/scan** della rete e **inventario software**. Non è un modulo
opzionale del registry — è la base su cui poggiano tutti gli altri moduli
(vuln, patch, wazuh, librenms, mdm correlano sui suoi host). Tutto vive nel DB
tenant.

## Funzioni principali

- **Networks**: CRUD subnet/reti (`networks`), associazione host, configurazione
  SNMP community, scheduling scan per rete. Pagine `/networks`.
- **Hosts / Devices / Objects**: anagrafica host (`hosts`), promozione a device
  fisico/network device (`network_devices`), classificazione automatica del
  device (vendor/OS/tipo) tramite fingerprint, SNMP sysObjectID, MAC vendor.
  Pagine `/hosts`, `/devices`, `/objects`, `/switches`, `/routers`.
- **Discovery / Scan**: `discoverNetwork()` orchestra ping sweep, nmap discovery,
  TCP check, lettura ARP cache, lookup vendor MAC, query SNMP multi-community,
  classificazione device. Tipi di scan via cron: `network_discovery`, `fast`,
  `snmp`, `nmap`, `dns_resolve`, `known_host_check`, `anomaly_check`. Storico in
  `scan_history` / `status_history`. Pagine `/discovery`, `/scans`, `/arp-table`.
- **Software Inventory**: raccolta software installato per host
  (`software_inventory` + `software_scans`), base per il matching CVE→pacchetto
  del Patch Management. Pagine `/software`, `/inventory`. Vista NIS2 / gap.
- **Classificazione device**: pipeline di fingerprint + regole
  (`device-classifier`, `device-fingerprint-classification`, profili vendor).
- **DHCP / DNS / ARP locali**: tabelle lease, mapping MAC↔IP, ARP table per
  arricchire la presenza host.

## Come si usa

1. **Definizione reti**: in `/networks` si creano le subnet con CIDR, nome,
   community SNMP.
2. **Discovery**: si lancia uno scan (manuale o schedulato via `/scans`); gli
   host trovati vengono inseriti/aggiornati in `hosts`, con stato online/offline
   tracciato in `status_history`.
3. **Classificazione**: il classifier assegna tipo/vendor/OS; l'admin può
   promuovere un host a device fisico/network device da `/objects`.
4. **Inventario software**: gli scan software popolano `software_inventory`,
   consultabile in `/software` e usato dal Patch Management.

## Architettura e integrazioni

- DA-IPAM gira in **systemd**. Lo scan può girare **in-process locale**
  (`LocalExecutor`) o, per tenant `agent_mode='remote'`, delegato a un
  **agente remoto** (`RemoteExecutor`) — vedi modulo Agents/Bridge.
- Scheduler `node-cron` (`src/lib/cron/jobs.ts`) dispatcha i job per rete.
- Tutto il dato vive nel **DB tenant** (`data/tenants/<CODE>.db`); l'anagrafica
  clienti/agenti sull'hub.
- Probe: ICMP/nmap/TCP, ARP cache, SNMP (IP-MIB universale, sysObjectID),
  MAC vendor (OUI).
- Gli host sono l'anchor di correlazione per vuln (CVE), patch, wazuh, librenms,
  mdm.

## File chiave

- `src/lib/scanner/discovery.ts` — `discoverNetwork()`, orchestrazione scan.
- `src/lib/scanner/{ping,nmap,ports,tcp-check,arp-cache,mac-vendor}.ts`.
- `src/lib/scanner/{snmp-query,snmp-sysobj-lookup,snmp-oid-library}.ts` — SNMP.
- `src/lib/device-classifier.ts`, `device-fingerprint-classification.ts`,
  `device-product-profiles.ts` — classificazione device.
- `src/lib/executor/{index,local,remote}.ts` — astrazione esecuzione scan.
- `src/lib/cron/jobs.ts` — dispatch job scan/sync per rete.
- `src/lib/db-tenant-schema.ts` — `networks`, `hosts`, `scan_history`,
  `network_devices`, `software_scans`, `software_inventory`.
- Pagine: `src/app/(dashboard)/{networks,hosts,devices,objects,discovery,scans,software,inventory,arp-table,switches,routers}/`.
- API: `src/app/api/{networks,hosts,devices,discovery,scans,software,software-scans,arp-table}/`.
