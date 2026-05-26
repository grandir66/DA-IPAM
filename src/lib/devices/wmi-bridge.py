#!/usr/bin/env python3
"""
Bridge Python per WMI via DCOM (impacket). Fallback quando WinRM (5985/5986)
non è raggiungibile o non è configurato sul target.

Trasporto: DCOM su porta 135 (RPC endpoint mapper) + porte dinamiche.
Auth: NTLM via username/password (Kerberos non supportato qui — chi vuole
Kerberos passa già da WinRM).

Limitazioni rispetto a WinRM:
  - solo query WMI (WQL): niente registry, niente DirectorySearcher,
    niente PowerShell script. installed_software, last_logged_on_user e
    AD enrichment richiedono WinRM e NON sono replicabili qui.

Input JSON (stdin):
  host, username, password, namespace (opzionale, default "//./root/cimv2")

Output JSON: stessa shape del dict $r prodotto dallo script PowerShell in
device-info.ts (sottoinsieme — vedi limitazioni).
"""
import json
import sys
import re
from datetime import datetime


def _err(code: str, msg: str):
    print(json.dumps({"error": msg, "errorCode": code, "transport": "wmi/dcom"}))
    sys.exit(1)


def _parse_wmi_datetime(s: str):
    """yyyymmddHHMMSS.ffffff+UTC → ISO string. Restituisce None se non parseabile."""
    if not s or not isinstance(s, str):
        return None
    m = re.match(r"^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})", s)
    if not m:
        return None
    try:
        dt = datetime(*[int(x) for x in m.groups()])
        return dt.isoformat()
    except Exception:
        return None


def _safe(d, key, default=None):
    """impacket WMI restituisce oggetti con attributi: estrai per nome."""
    try:
        v = getattr(d, key, default)
        return v if v is not None else default
    except Exception:
        return default


def _domain_role_label(n):
    roles = {
        0: "Standalone Workstation",
        1: "Member Workstation",
        2: "Standalone Server",
        3: "Member Server",
        4: "Backup Domain Controller",
        5: "Primary Domain Controller",
    }
    try:
        return roles.get(int(n))
    except Exception:
        return None


def main():
    raw = sys.stdin.read()
    try:
        req = json.loads(raw)
    except Exception as e:
        _err("BRIDGE_INPUT", f"JSON parse error: {e}")

    host = req.get("host", "")
    username = req.get("username", "")
    password = req.get("password", "")
    namespace = req.get("namespace", "//./root/cimv2")

    if not host or not username:
        _err("BRIDGE_INPUT", "host e username obbligatori")

    # Split DOMAIN\user oppure user@DOMAIN.FQDN → username, domain
    domain = ""
    user = username
    if "\\" in username:
        domain, user = username.split("\\", 1)
    elif "@" in username:
        user, domain = username.split("@", 1)
        # impacket si aspetta NETBIOS, non FQDN: tronca al primo punto
        domain = domain.split(".", 1)[0]

    try:
        from impacket.dcerpc.v5.dcomrt import DCOMConnection
        from impacket.dcerpc.v5.dcom import wmi
        from impacket.dcerpc.v5.dtypes import NULL
    except ImportError as e:
        _err(
            "IMPACKET_MISSING",
            f"Modulo Python impacket assente: {e}. Sul server DA-IPAM: "
            "~/.da-invent-venv/bin/pip install impacket "
            "oppure rilancia scripts/install.sh."
        )

    dcom = None
    iWbemServices = None
    try:
        # DCOMConnection accetta lmhash/nthash separati ma noi passiamo password plaintext.
        dcom = DCOMConnection(
            host, user, password, domain, "", "",
            None, oxidResolver=True, doKerberos=False
        )

        iInterface = dcom.CoCreateInstanceEx(wmi.CLSID_WbemLevel1Login, wmi.IID_IWbemLevel1Login)
        iWbemLevel1Login = wmi.IWbemLevel1Login(iInterface)
        iWbemServices = iWbemLevel1Login.NTLMLogin(namespace, NULL, NULL)
        iWbemLevel1Login.RemRelease()
    except Exception as e:
        msg = str(e)
        lower = msg.lower()
        if "rpc_s_access_denied" in lower or "access_denied" in lower or "0x5" in msg:
            _err("AUTH_REJECTED", f"WMI access denied: {msg}. Verifica che l'utente sia in Administrators o abbia 'Remote Enable' sul namespace WMI.")
        if "ept_s_not_registered" in lower or "endpoint" in lower:
            _err("TCP_CLOSED", f"WMI/RPC endpoint mapper non disponibile (porta 135 chiusa o servizio RPC fermo): {msg}")
        if "connection" in lower and ("refused" in lower or "reset" in lower):
            _err("TCP_CLOSED", f"WMI: connessione RPC rifiutata: {msg}")
        if "timed out" in lower or "timeout" in lower:
            _err("TCP_TIMEOUT", f"WMI: timeout connessione RPC a {host}: {msg}")
        _err("UNKNOWN", f"WMI connect error: {msg}")

    def query(wql, limit=200):
        """Esegue WQL, ritorna lista di oggetti getProperties() dict."""
        try:
            it = iWbemServices.ExecQuery(wql)
            out = []
            i = 0
            while True:
                try:
                    obj = it.Next(0xffffffff, 1)[0]
                except Exception:
                    break
                if not obj:
                    break
                props = obj.getProperties()
                # getProperties() ritorna {name: {'value': X, 'qualifiers': {...}}}
                row = {k: v.get("value") for k, v in props.items()} if isinstance(props, dict) else {}
                out.append(row)
                i += 1
                if i >= limit:
                    break
            return out
        except Exception:
            return []

    r = {}

    # Win32_OperatingSystem
    os_rows = query("SELECT Caption,Version,BuildNumber,OSArchitecture,SerialNumber,LastBootUpTime,InstallDate,RegisteredUser,Organization FROM Win32_OperatingSystem", 1)
    if os_rows:
        o = os_rows[0]
        r["os_name"] = o.get("Caption")
        r["os_version"] = o.get("Version")
        r["os_build"] = o.get("BuildNumber")
        r["architecture"] = o.get("OSArchitecture")
        r["os_serial"] = o.get("SerialNumber")
        r["last_boot"] = _parse_wmi_datetime(o.get("LastBootUpTime"))
        r["install_date"] = _parse_wmi_datetime(o.get("InstallDate"))
        r["registered_user"] = o.get("RegisteredUser")
        r["organization"] = o.get("Organization")

    # Win32_ComputerSystem
    cs_rows = query("SELECT Name,Domain,Model,Manufacturer,SystemType,NumberOfProcessors,DomainRole,TotalPhysicalMemory,PartOfDomain,UserName FROM Win32_ComputerSystem", 1)
    if cs_rows:
        c = cs_rows[0]
        r["hostname"] = c.get("Name")
        r["domain"] = c.get("Domain")
        r["model"] = c.get("Model")
        r["manufacturer"] = c.get("Manufacturer")
        r["system_type"] = c.get("SystemType")
        r["processor_count"] = c.get("NumberOfProcessors")
        dr = c.get("DomainRole")
        r["domain_role"] = _domain_role_label(dr)
        try:
            r["is_domain_controller"] = int(dr) >= 4
            r["is_server"] = int(dr) >= 2
        except Exception:
            pass
        tpm = c.get("TotalPhysicalMemory")
        if tpm:
            try:
                tpm_n = int(tpm)
                r["ram_total_mb"] = int(tpm_n / (1024 * 1024))
                r["ram_total_gb"] = round(tpm_n / (1024 * 1024 * 1024), 1)
            except Exception:
                pass
        if c.get("UserName"):
            r["last_logged_on_user"] = c.get("UserName")

    # Win32_Processor (primo)
    cpu_rows = query("SELECT Name,Manufacturer,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed FROM Win32_Processor", 1)
    if cpu_rows:
        c = cpu_rows[0]
        r["cpu_model"] = c.get("Name")
        r["cpu_manufacturer"] = c.get("Manufacturer")
        r["cpu_cores"] = c.get("NumberOfCores")
        r["cpu_threads"] = c.get("NumberOfLogicalProcessors")
        r["cpu_speed_mhz"] = c.get("MaxClockSpeed")

    # Win32_LogicalDisk DriveType=3
    disks = []
    total_size = 0
    total_free = 0
    for d in query("SELECT DeviceID,FileSystem,VolumeName,Size,FreeSpace FROM Win32_LogicalDisk WHERE DriveType=3", 50):
        obj = {"device": d.get("DeviceID"), "filesystem": d.get("FileSystem"), "label": d.get("VolumeName")}
        try:
            if d.get("Size"):
                obj["size_gb"] = int(int(d["Size"]) / (1024**3))
                total_size += obj["size_gb"]
            if d.get("FreeSpace"):
                obj["free_gb"] = int(int(d["FreeSpace"]) / (1024**3))
                total_free += obj["free_gb"]
        except Exception:
            pass
        disks.append(obj)
    if disks:
        r["disks"] = disks
        r["disk_total_gb"] = total_size
        r["disk_free_gb"] = total_free

    # Win32_BIOS
    bios = query("SELECT SerialNumber,Manufacturer,SMBIOSBIOSVersion FROM Win32_BIOS", 1)
    if bios:
        b = bios[0]
        sn = b.get("SerialNumber")
        if sn and not re.match(r"^(To Be Filled|Default string|\s*)$", str(sn)):
            r["serial_number"] = sn
        r["bios_manufacturer"] = b.get("Manufacturer")
        r["bios_version"] = b.get("SMBIOSBIOSVersion")

    # Win32_BaseBoard
    board = query("SELECT SerialNumber,Product FROM Win32_BaseBoard", 1)
    if board:
        b = board[0]
        if not r.get("serial_number"):
            r["serial_number"] = b.get("SerialNumber")
        r["part_number"] = b.get("Product")

    # Network adapters (IPEnabled=True)
    adapters = []
    for a in query("SELECT Description,MACAddress,DHCPEnabled,IPAddress,IPSubnet,DefaultIPGateway,DNSServerSearchOrder FROM Win32_NetworkAdapterConfiguration WHERE IPEnabled=True", 30):
        obj = {
            "name": a.get("Description"),
            "mac": a.get("MACAddress"),
            "dhcp": a.get("DHCPEnabled"),
        }
        for src, dst in [("IPAddress", "ips"), ("IPSubnet", "subnets"), ("DefaultIPGateway", "gateway"), ("DNSServerSearchOrder", "dns")]:
            v = a.get(src)
            if v:
                obj[dst] = list(v) if isinstance(v, (list, tuple)) else [v]
        adapters.append(obj)
    if adapters:
        r["network_adapters"] = adapters

    # Physical memory
    mem = []
    for m in query("SELECT Capacity,Speed,Manufacturer FROM Win32_PhysicalMemory", 16):
        obj = {}
        if m.get("Capacity"):
            try:
                obj["size_gb"] = int(int(m["Capacity"]) / (1024**3))
            except Exception:
                pass
        if m.get("Speed"):
            obj["speed_mhz"] = m.get("Speed")
        if m.get("Manufacturer"):
            obj["manufacturer"] = m.get("Manufacturer")
        if obj:
            mem.append(obj)
    if mem:
        r["memory_modules"] = mem

    # Servizi importanti
    keywords = ["SQL Server", "Exchange", "IIS", "Active Directory", "DNS", "DHCP", "Hyper-V", "Print Spooler", "Windows Update", "Remote Desktop"]
    svcs = []
    for s in query("SELECT Name,DisplayName,State,StartMode FROM Win32_Service WHERE State='Running'", 200):
        dn = s.get("DisplayName") or ""
        if any(kw.lower() in dn.lower() for kw in keywords):
            svcs.append({
                "name": s.get("Name"),
                "display_name": dn,
                "state": s.get("State"),
                "start_mode": s.get("StartMode"),
            })
    if svcs:
        r["important_services"] = svcs

    # Local users
    users = []
    for u in query("SELECT Name,FullName,Disabled FROM Win32_UserAccount WHERE LocalAccount=True", 20):
        users.append({"name": u.get("Name"), "full_name": u.get("FullName"), "disabled": u.get("Disabled")})
    if users:
        r["local_users"] = users

    # Antivirus (namespace root/SecurityCenter2)
    try:
        iWbemServices.RemRelease()
        iWbemServices = iWbemLevel1Login.NTLMLogin("//./root/SecurityCenter2", NULL, NULL) if False else None
    except Exception:
        iWbemServices = None
    if iWbemServices is None:
        # Riconnetti per il namespace SecurityCenter2
        try:
            iInterface2 = dcom.CoCreateInstanceEx(wmi.CLSID_WbemLevel1Login, wmi.IID_IWbemLevel1Login)
            iWbemLevel1Login2 = wmi.IWbemLevel1Login(iInterface2)
            iWbemServices_sc = iWbemLevel1Login2.NTLMLogin("//./root/SecurityCenter2", NULL, NULL)
            iWbemLevel1Login2.RemRelease()
            av_list = []
            try:
                av_it = iWbemServices_sc.ExecQuery("SELECT displayName,productState FROM AntivirusProduct")
                while True:
                    try:
                        av_obj = av_it.Next(0xffffffff, 1)[0]
                    except Exception:
                        break
                    if not av_obj:
                        break
                    p = av_obj.getProperties()
                    av_list.append({
                        "name": p.get("displayName", {}).get("value") if isinstance(p, dict) else None,
                        "state": p.get("productState", {}).get("value") if isinstance(p, dict) else None,
                    })
            except Exception:
                pass
            if av_list:
                r["antivirus"] = av_list
            iWbemServices_sc.RemRelease()
        except Exception:
            # SecurityCenter2 non disponibile su server senza Defender — non è un errore fatale
            pass

    # Hotfix
    hf = []
    for h in query("SELECT HotFixID,Description,InstalledOn FROM Win32_QuickFixEngineering", 50):
        if h.get("HotFixID"):
            obj = {"id": h.get("HotFixID")}
            if h.get("Description"):
                obj["description"] = h.get("Description")
            if h.get("InstalledOn"):
                obj["installed_on"] = h.get("InstalledOn")
            hf.append(obj)
    if hf:
        r["installed_hotfixes"] = hf

    # GPU
    gpu = []
    for v in query("SELECT Name,DriverVersion,AdapterRAM FROM Win32_VideoController", 4):
        if v.get("Name"):
            obj = {"name": v.get("Name")}
            if v.get("DriverVersion"):
                obj["driver_version"] = v.get("DriverVersion")
            try:
                ram = int(v.get("AdapterRAM") or 0)
                if ram > 0:
                    obj["ram_gb"] = round(ram / (1024**3), 1)
            except Exception:
                pass
            gpu.append(obj)
    if gpu:
        r["gpu"] = gpu

    # Physical disks
    pdisks = []
    for d in query("SELECT DeviceID,Model,Size,SerialNumber,Manufacturer,InterfaceType FROM Win32_DiskDrive", 20):
        obj = {"device": d.get("DeviceID"), "model": d.get("Model")}
        try:
            if d.get("Size"):
                obj["size_gb"] = int(int(d["Size"]) / (1024**3))
        except Exception:
            pass
        sn = (d.get("SerialNumber") or "").strip() if d.get("SerialNumber") else ""
        if sn:
            obj["serial"] = sn
        mfg = d.get("Manufacturer")
        if mfg and mfg != "(Standard disk drives)":
            obj["vendor"] = mfg
        if d.get("InterfaceType"):
            obj["interface_type"] = d.get("InterfaceType")
        pdisks.append(obj)
    if pdisks:
        r["physical_disks"] = pdisks

    # Uptime
    if r.get("last_boot"):
        try:
            boot_dt = datetime.fromisoformat(r["last_boot"])
            r["uptime_days"] = int((datetime.now() - boot_dt).total_seconds() / 86400)
        except Exception:
            pass

    # Marker: questa è una probe WMI, modalità degradata
    r["_probe_transport"] = "wmi/dcom"

    try:
        if iWbemServices:
            iWbemServices.RemRelease()
    except Exception:
        pass
    try:
        if dcom:
            dcom.disconnect()
    except Exception:
        pass

    print(json.dumps({"data": r, "transport": "wmi/dcom"}))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        _err("UNKNOWN", f"Errore WMI bridge non gestito: {e}")
