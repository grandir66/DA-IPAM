/**
 * Script PowerShell del collector `windows`, per id: l'allowlist WinRM del descrittore (`script_winrm`). Testo fisso, mai
 * dall'input; solo letture (CIM, registro, cmdlet `Get-*`). Ognuno risponde con una busta JSON su una riga:
 * `{"ok":true,"data":…}` oppure `{"ok":false,"code":"UNSUPPORTED"|"SCRIPT_FAILED"}`, così un cmdlet assente non diventa
 * una lista vuota. Le date in ISO 8601 (`ToString('o')`), i byte come stringhe decimali. Compatibili con PowerShell 5.1.
 *
 * Software dal registro (chiavi Uninstall a 64 e 32 bit), **mai `Win32_Product`** (fa partire la riconfigurazione MSI su
 * ogni pacchetto: difetto noto, piano §6). Hyper-V da `root/virtualization/v2` con il GUID della VM (donatore DADude3
 * `hyperv.py:58,94,112`); Defender e profili firewall per nome (`windows_server.py:453`), senza riassunti; ruoli da
 * `Get-WindowsFeature` (`:372`), solo su Windows Server.
 */
const BUSTA_ERRORE = "catch { [pscustomobject]@{ok=$false;code='SCRIPT_FAILED'} | ConvertTo-Json -Compress }";
const busta = (corpo: string): string => `$ErrorActionPreference='Stop'; try { ${corpo} } ${BUSTA_ERRORE}`;
const ok = (dato: string): string => `[pscustomobject]@{ok=$true;data=${dato}} | ConvertTo-Json -Compress -Depth 5`;
const nonSupportato = "[pscustomobject]@{ok=$false;code='UNSUPPORTED'} | ConvertTo-Json -Compress";

export const SCRIPT_WINDOWS = {
    identita: busta(
        "$cs=Get-CimInstance Win32_ComputerSystem; $os=Get-CimInstance Win32_OperatingSystem; $bios=Get-CimInstance Win32_BIOS; " +
        "$tz=(Get-CimInstance Win32_TimeZone).StandardName; " +
        ok("[pscustomobject]@{manufacturer=$cs.Manufacturer;model=$cs.Model;hostname=$cs.DNSHostName;domain=$cs.Domain;part_of_domain=$cs.PartOfDomain;" +
            "serial=$bios.SerialNumber;bios=$bios.SMBIOSBIOSVersion;os_caption=$os.Caption;os_version=$os.Version;os_build=$os.BuildNumber;" +
            "architecture=$os.OSArchitecture;boot_time=$os.LastBootUpTime.ToUniversalTime().ToString('o');timezone=$tz;" +
            "memory_total_bytes=[string]$cs.TotalPhysicalMemory;memory_free_bytes=[string]([uint64]$os.FreePhysicalMemory*1024)}"),
    ),
    rete: busta(
        "$a=@(Get-NetAdapter | ForEach-Object { [pscustomobject]@{name=$_.Name;if_index=$_.InterfaceIndex;description=$_.InterfaceDescription;mac=$_.MacAddress;status=[string]$_.Status;speed_bps=[string]$_.Speed;mtu=$_.MtuSize;virtual=$_.Virtual} }); " +
        "$i=@(Get-NetIPAddress -AddressFamily IPv4 | ForEach-Object { [pscustomobject]@{address=$_.IPAddress;prefix_length=$_.PrefixLength;if_index=$_.InterfaceIndex} }); " +
        ok("[pscustomobject]@{adapters=$a;addresses=$i}"),
    ),
    dischi: busta(
        "$d=@(Get-CimInstance Win32_DiskDrive | ForEach-Object { [pscustomobject]@{name=$_.DeviceID;model=$_.Model;serial=$_.SerialNumber;size_bytes=[string]$_.Size;interface=$_.InterfaceType;media=$_.MediaType} }); " +
        "$v=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { [pscustomobject]@{device=$_.DeviceID;file_system=$_.FileSystem;size_bytes=[string]$_.Size;free_bytes=[string]$_.FreeSpace} }); " +
        ok("[pscustomobject]@{disks=$d;volumes=$v}"),
    ),
    software: busta(
        "$k='HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'; " +
        "$r=@(Get-ItemProperty -Path $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | ForEach-Object { [pscustomobject]@{name=[string]$_.DisplayName;version=[string]$_.DisplayVersion;publisher=[string]$_.Publisher;install_date=[string]$_.InstallDate} }); " +
        ok("$r"),
    ),
    servizi: busta(
        "$s=@(Get-CimInstance Win32_Service | ForEach-Object { [pscustomobject]@{name=$_.Name;display_name=$_.DisplayName;state=$_.State;start_mode=$_.StartMode;account=$_.StartName} }); " +
        ok("$s"),
    ),
    ruoli: busta(
        `if (-not (Get-Command Get-WindowsFeature -ErrorAction SilentlyContinue)) { ${nonSupportato}; return }; ` +
        "$f=@(Get-WindowsFeature | Where-Object { $_.Installed } | ForEach-Object { [pscustomobject]@{name=$_.Name;display_name=$_.DisplayName;type=[string]$_.FeatureType} }); " +
        ok("$f"),
    ),
    sicurezza: busta(
        "$av=$null; if (Get-Command Get-MpComputerStatus -ErrorAction SilentlyContinue) { $m=Get-MpComputerStatus; $av=[pscustomobject]@{enabled=$m.AntivirusEnabled;real_time=$m.RealTimeProtectionEnabled;signature_age_days=$m.AntivirusSignatureAge} }; " +
        "$fw=@(Get-NetFirewallProfile | ForEach-Object { [pscustomobject]@{name=[string]$_.Name;enabled=[string]$_.Enabled;inbound=[string]$_.DefaultInboundAction;outbound=[string]$_.DefaultOutboundAction} }); " +
        ok("[pscustomobject]@{defender=$av;firewall=$fw}"),
    ),
    hyperv: busta(
        `if (-not (Get-CimClass -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -ErrorAction SilentlyContinue)) { ${nonSupportato}; return }; ` +
        "$v=@(Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter \"Caption='Virtual Machine'\" | ForEach-Object { [pscustomobject]@{id=$_.Name;name=$_.ElementName;enabled_state=$_.EnabledState} }); " +
        ok("$v"),
    ),
} as const;

export type ScriptWindows = keyof typeof SCRIPT_WINDOWS;
export const ID_SCRIPT_WINDOWS = Object.keys(SCRIPT_WINDOWS) as ScriptWindows[];
