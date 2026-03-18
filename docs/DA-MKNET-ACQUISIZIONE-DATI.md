# Acquisizione dati per prodotto – DA-MKNET

Analisi del progetto DA-MKNET su come vengono acquisiti i dati per ogni vendor.

## Prodotti supportati

| DeviceType | Servizio | Metodo SSH |
|------------|----------|------------|
| **MikroTik** | `MikrotikService` | `executeCommand` (exec diretto) |
| **HP ProCurve / Aruba** | `VendorsService` | `executeCommandViaShell` (shell interattiva) |
| **HP Comware** | `VendorsService` | `executeCommand` + `executeCommandViaShell` |
| **Cisco** | — | Non implementato |
| **UniFi / Ubiquiti** | — | **Non implementato** (solo OUI in mac-vendor) |

---

## MikroTik

**File:** `backend/src/mikrotik/mikrotik.service.ts`, `ssh-client.service.ts`

- **Connessione:** SSH `exec` o API REST
- **System info:** `getSystemInfo()`
- **Interfacce:** `getCompleteInterfaces()` → `/interface print detail`, `/interface ethernet monitor`
- **LLDP:** `getLLDPNeighbors()` → `/interface ethernet lldp neighbors print`
- **Bridge/STP:** `getBridgeInfoViaSSH()` → `/interface bridge monitor [find] once`
- **Bridge ports:** `getBridgePortsViaSSH()` → `/interface bridge port monitor [find] once`

**Output bridge monitor:** formato key-value (root-bridge, bridge-id, root-bridge-id, root-port, root-path-cost, protocol-mode).

---

## HP ProCurve / Aruba

**File:** `backend/src/vendors/vendors.service.ts`

- **Connessione:** SSH `executeCommandViaShell` (shell interattiva per paginazione `--More--`)
- **System info:** `getHPProCurveSystemInfo()` → `show version`, `show system` / `show system-information`
- **Interfacce:** `getHPProCurveInterfaces()` → `show interface brief`, `show interfaces brief`, `show vlans`, `show poe`
- **LLDP:** `getHPProCurveLLDPNeighbors()` → `show lldp info remote-device`
- **STP:** `getHPProCurveStpInfo()` → `show spanning-tree`

**Output STP:** `Switch MAC Address`, `Switch Priority`, `Root MAC Address`, `Root Priority`, `Root Cost`, `Root Port`, ecc.

---

## HP Comware

**File:** `backend/src/vendors/vendors.service.ts`

- **Connessione:** SSH `executeCommand` (exec) o `executeCommandViaShell` per paginazione
- **System info:** `getHPComwareSystemInfo()` → `display device manuinfo`, `display version`, `display current-configuration`
- **Interfacce:** `getHPComwareInterfaces()` → `display interface brief`, `display stp`, `display vlan`
- **LLDP:** `getHPComwareLLDPNeighbors()` → `display lldp neighbor-information`
- **STP:** `getHPComwareStpInfo()` → `display stp region-configuration`, `display stp`

**Output STP:** `Bridge ID`, `Root ID/ERPC`, `RootPort ID`, `Bridge times`, `[Mode MSTP]`.

---

## UniFi / Ubiquiti

**Non implementato in DA-MKNET.**

- `DeviceType` non include `UNIFI` o `UBIQUITI`
- `VendorsService.getStpInfo()` → switch per `hp_procurve`, `hp_comware`, `mikrotik`; `default` → `null`
- Ubiquiti è solo in `mac-vendor.service.ts` per OUI detection (patterns: `ubiquiti`, `unifi`, `edgeos`)

**Nota:** Gli switch UniFi richiedono un flusso speciale (come in Netmiko):
1. SSH → shell Linux (BusyBox)
2. `telnet 127.0.0.1` → CLI EdgeSwitch
3. `enable` → prompt `(UBNT) #`
4. Comandi tipo `show spanning-tree`

---

## SSH client

**File:** `backend/src/mikrotik/ssh-client.service.ts`

- **`executeCommand()`** – `conn.exec()`: singolo comando, output immediato
- **`executeCommandViaShell()`** – `conn.shell()`: shell interattiva, gestione `--More--` e prompt

---

## Discovery flow

**File:** `backend/src/discovery/discovery.service.ts`

- **MikroTik:** `discoverMikrotikDevice()` → `MikrotikService`
- **HP ProCurve / Comware:** `discoverVendorDevice()` → `VendorsService`
- **Device type:** `device.deviceType === DeviceType.HP_COMWARE || DeviceType.HP_PROCURVE` → `VendorsService`, altrimenti `MikrotikService`

---

## OLDSCRIPT (Python)

**File:** `OLDSCRIPT/info_complete.py`, `info_complete_6100.py`

- Script Python per HP ProCurve (show system, show interfaces brief, show name, ecc.)
- Usa Paramiko, gestione paginazione `--More--`
- Nessun modulo UniFi
