/**
 * Fixture del contratto comune (C0.5): una per collector, con la forma delle uscite vere e dati inventati
 * (IP di documentazione, MAC 02:00:00, nessun nome di cliente). Una famiglia nuova aggiunge qui la sua voce:
 * `Record<CollectorId, …>` fa fallire `tsc` se manca, e `contratto.test.ts` la esegue.
 */
import type { CollectorId } from "../catalogo";
import type { AcquisitionRequest, AcquisitionSnapshot, AcquisitionTransports, ReadResult, SnmpRow } from "../schema";
import { collectDevice } from "../index";
import { collectVmwareEsxi } from "../vmware-esxi";
import { collectNetappOntap } from "../netapp-ontap";
import { collectUnifiController } from "../unifi-controller";
import type { createUnifiClient } from "../../integrations/unifi-api";
import { ONTAP_ENDPOINTS } from "../ontap-transport";
import type { OntapInventory } from "../ontap-transport";
import type { VsphereInventory, PropertyObject } from "../vsphere-transport";

export const SEGRETO = "SEGRETO-FIXTURE-NON-STAMPARE";
const PIN = Array(32).fill("AB").join(":");
const ok = <T>(data: T): ReadResult<T> => ({ status: "ok", data, warnings: [] });
const SYS_DESCR = "1.3.6.1.2.1.1.1.0";

export interface Esito { snapshot: AcquisitionSnapshot; chiamateShell: number }
export interface FixtureCollector {
    richiesta: AcquisitionRequest;
    /** Uscite plausibili. */
    normale(): Promise<Esito>;
    /** Famiglia riconosciuta, ma le altre uscite hanno un formato che il parser non conosce. */
    formatoIgnoto?(): Promise<Esito>;
    /** Stessa richiesta senza credenziale SSH. */
    senzaSsh?(): Promise<Esito>;
    /** Ogni lettura fallisce lanciando un errore che nomina il segreto. */
    trasportoGuasto(): Promise<Esito>;
}

function consola(profilo: { identita: Record<string, string>; snmp?: SnmpRow[] }, altro: (comando: string) => string) {
    return (opzioni: { ssh: boolean; guasto?: boolean }) => {
        let chiamate = 0;
        const t: AcquisitionTransports = {
            get: async () => { if (opzioni.guasto) throw Error(SEGRETO); return ok(profilo.snmp ?? []); },
            walk: async () => { if (opzioni.guasto) throw Error(SEGRETO); return ok([]); },
            shell: async comandi => { chiamate++; if (opzioni.guasto) throw Error(SEGRETO); return Object.fromEntries(comandi.map(c => [c, ok(profilo.identita[c] ?? altro(c))])); },
        };
        return { t, chiamate: () => chiamate };
    };
}
function perShell(richiesta: AcquisitionRequest, fabbrica: ReturnType<typeof consola>): FixtureCollector {
    const esegui = async (req: AcquisitionRequest, o: { ssh: boolean; guasto?: boolean }): Promise<Esito> => { const { t, chiamate } = fabbrica(o); const snapshot = await collectDevice(req, t); return { snapshot, chiamateShell: chiamate() }; };
    return {
        richiesta,
        normale: () => esegui(richiesta, { ssh: true }),
        trasportoGuasto: () => esegui(richiesta, { ssh: true, guasto: true }),
        senzaSsh: () => { const { ssh: _ssh, ...resto } = richiesta as AcquisitionRequest & { ssh?: unknown }; void _ssh; return esegui({ ...resto, snmp: { community: SEGRETO } } as AcquisitionRequest, { ssh: false }); },
    };
}
const GARBAGE = (c: string) => `@@ ${c}: formato mai visto ##\n???`;

const qnapIdent = `Model name : QSW-M3216R-8S8T\nSwitch firmware : 4.5.0.847494 (20260908)\nSerial number : LAB0001\nSwitch name : sw-${SEGRETO}\nTemperature : 42\nFan 1 speed : 4200`;
const qnapNormale = (c: string) => c === "show interfaces status" ? "Ex0/7 connected Full 2.5 Gbps Auto" : c === "show vlan" ? "Vlan ID : 40\nMember Ports : Ex0/7\nUntagged Ports : None\nName : LAB" : c === "show lldp neighbors" ? "Total Entries Displayed : 0" : c === "show mac-address-table" ? "Total Mac Addresses displayed: 0" : c === "show system temperature" ? "CPU Temperature : 48 C" : "";
const qnapReq: AcquisitionRequest = { collector: "qnap-switch", host: "192.0.2.1", ssh: { username: "lab", password: SEGRETO } };

const procurveIdent: Record<string, string> = { "show system": "Software revision : YC.16.11.0020 Base MAC Addr : 020000-000001\nSerial Number : LAB001\nCPU Util (%) : 0 Free : 1000\nMemory - Total : 2000", "show version": "YC.16.11.0020" };
const procurveSnmp: SnmpRow[] = [{ oid: SYS_DESCR, value: "Aruba JL357A 2540-48G-PoE+-4SFP+ Switch, revision YC.16.11.0020, ROM YC.16.01.0003" }];
const procurveNormale = (c: string) => c === "show interfaces brief" ? "49-Trk3 SFP+SR | No Yes Up 10GigFD NA off 0" : c === "show vlans" ? "40 LAB | Port-based No No" : "";
const procurveReq: AcquisitionRequest = { collector: "hp-procurve", host: "192.0.2.2", ssh: { username: "lab", password: SEGRETO }, snmp: { community: SEGRETO } };

const comwareIdent: Record<string, string> = { "display version": "HPE Comware Software, Version 7.1.045, Release 2432P06\nHPE FF 5700-40XG-2QSFP+ Switch with 2 Processors uptime is 0 weeks, 1 day, 0 hours, 0 minutes" };
const comwareSnmp: SnmpRow[] = [{ oid: SYS_DESCR, value: "HPE Comware Software Version 7.1.045" }];
const comwareNormale = (c: string) => c === "display interface brief" ? "XGE1/0/1 UP 10G(a) F(a) A 17 lab" : "";
const comwareReq: AcquisitionRequest = { collector: "hp-comware", host: "192.0.2.3", ssh: { username: "lab", password: SEGRETO }, snmp: { community: SEGRETO } };

function conGarbage(base: FixtureCollector, ident: Record<string, string>, snmp: SnmpRow[] | undefined): FixtureCollector {
    return {
        ...base,
        formatoIgnoto: async () => { let chiamate = 0; const t: AcquisitionTransports = { get: async () => ok(snmp ?? []), walk: async () => ok([]), shell: async comandi => { chiamate++; return Object.fromEntries(comandi.map(c => [c, ok(ident[c] ?? GARBAGE(c))])); } }; const snapshot = await collectDevice(base.richiesta, t); return { snapshot, chiamateShell: chiamate }; },
    };
}

const prop = (ref: string, type: string, props: Record<string, unknown>): PropertyObject => ({ ref, type, props, missing: [] });
const esxiRaw = (): VsphereInventory => ({ about: { apiType: "HostAgent", apiVersion: "8.0.3.0", fullName: "VMware ESXi 8.0.3", build: "LAB" }, host: prop("ha-host", "HostSystem", { name: `host-${SEGRETO}`, summary: { hardware: { cpuMhz: "2000" }, quickStats: { overallCpuUsage: "0", overallMemoryUsage: "0", uptime: "0" } }, hardware: { systemInfo: { vendor: "Lab", model: "LabServer", uuid: "LABUUID" }, memorySize: "9007199254740993", cpuInfo: { numCpuPackages: "1", numCpuCores: "8", numCpuThreads: "16" } }, runtime: { inMaintenanceMode: "false" } }), vms: [], datastores: [], warnings: [] }) as unknown as VsphereInventory;
const esxiReq: AcquisitionRequest = { collector: "vmware-esxi", host: "192.0.2.4", api: { username: "lab", password: SEGRETO, tls_sha256: PIN } };
const ontapRaw = (): OntapInventory => { const raw = Object.fromEntries(Object.keys(ONTAP_ENDPOINTS).map(k => [k, { status: "ok", data: [], warnings: [] }])) as unknown as OntapInventory; raw.cluster.data = [{ uuid: "cluster-1", name: `cl-${SEGRETO}`, version: { full: "NetApp Release 9.16.1" } }]; return raw; };
const ontapReq: AcquisitionRequest = { collector: "netapp-ontap", host: "192.0.2.5", api: { username: "lab", password: SEGRETO, tls_sha256: PIN } };

/**
 * Un collector di sistema letto via shell exec (un'apertura sola per tutti i comandi): uscite di `uscita(comando)`,
 * `garbage` per il formato ignoto. Senza `senzaSsh`: SSH è l'unica credenziale ammessa.
 */
function perExec(richiesta: AcquisitionRequest, uscita: (comando: string) => string, identita: readonly string[]): FixtureCollector {
    const esegui = async (risposta: (c: string) => string, guasto = false): Promise<Esito> => {
        let chiamate = 0;
        const t: AcquisitionTransports = {
            get: async () => { throw Error(SEGRETO); }, walk: async () => { throw Error(SEGRETO); },
            shell: async comandi => { chiamate++; if (guasto) throw Error(SEGRETO); return Object.fromEntries(comandi.map(c => [c, ok(risposta(c))])); },
        };
        const snapshot = await collectDevice(richiesta, t);
        return { snapshot, chiamateShell: chiamate };
    };
    return {
        richiesta,
        normale: () => esegui(uscita),
        formatoIgnoto: () => esegui(c => (identita.includes(c) ? uscita(c) : GARBAGE(c))),
        trasportoGuasto: () => esegui(uscita, true),
    };
}

// QNAP NAS (forma da DADude3 qnap.py, dalla documentazione QTS e dalle uscite del motore d'inventario; dati inventati).
const linkJson = (nome: string, mac: string, idx = 2) => JSON.stringify([{ ifindex: 1, ifname: "lo", mtu: 65536, operstate: "UNKNOWN", address: "00:00:00:00:00:00" }, { ifindex: idx, ifname: nome, mtu: 1500, operstate: "UP", address: mac }]);
const addrJson = (nome: string, ip: string) => JSON.stringify([{ ifindex: 2, ifname: nome, addr_info: [{ family: "inet", local: ip, prefixlen: 24, scope: "global" }] }]);
const qnapNasUscite: Record<string, string> = {
    "uname -s": "Linux\n", "getsysinfo model": "TS-LAB4\n", "getsysinfo serial_num": "LABQ0001\n", "getcfg System Version -f /etc/config/uLinux.conf": "5.1.4\n",
    "getsysinfo firmver": "5.1.5\n", "cat /etc/version": "5.1.5\n", "cat /etc/default_config/WEBAPP.build": "20240101\n",
    "hostname": `nas-${SEGRETO}\n`,
    "cat /proc/meminfo": "MemTotal:        8000000 kB\nMemFree:          100000 kB\nMemAvailable:    4000000 kB\n", "cat /proc/mdstat": "Personalities : [raid1]\nmd1 : active raid1 sda3[0] sdb3[1]\n",
    "df -P -k": "Filesystem           1024-blocks      Used Available Capacity Mounted on\n/dev/mapper/cachedev1 9000000000 1000000000 8000000000  11% /share/CACHEDEV1_DATA\n",
    "ip -j link show": linkJson("eth0", "02:00:00:00:40:01"), "ip -j address show": addrJson("eth0", "192.0.2.40"),
    "lsblk -b -J -o NAME,TYPE,SIZE,MODEL,SERIAL,ROTA": '{"blockdevices":[{"name":"sda","type":"disk","size":4000787030016,"model":"LAB DISK","serial":"LABS1","rota":true}]}',
    "cat /etc/config/smb.conf": "[global]\nworkgroup = LAB\n[Public]\npath = /share/CACHEDEV1_DATA/Public\ncomment = Cartella di prova\npublic = yes\n",
    "cat /etc/exports": "\"/share/CACHEDEV1_DATA/Public\" 192.0.2.0/24(rw,async,no_subtree_check)\n",
    "cat /etc/config/qpkg.conf": "[HybridBackup]\nName = HybridBackup\nVersion = 3.0.0\nAuthor = QNAP Systems, Inc.\nEnable = TRUE\n",
};
const qnapNasReq: AcquisitionRequest = { collector: "qnap-nas", host: "192.0.2.40", ssh: { username: "lab", password: SEGRETO } };
export const QNAP_NAS_USCITE = qnapNasUscite;


// MikroTik RouterOS 7 (forme delle uscite vere della scheda MikroTik, devices/__tests__/fixtures; monitor ethernet e PoE dalla
// documentazione RouterOS 7; dati inventati).
const mikrotikUscite: Record<string, string> = {
    "/system resource print": "                   uptime: 2w20m57s\n                  version: 7.24.5 (stable)\n             total-memory: 1024.0MiB\n              free-memory: 512.0MiB\n                 cpu-load: 3%\n               board-name: CRS-LAB-8P\n",
    "/system routerboard print": "       routerboard: yes\n             model: CRS-LAB-8P\n     serial-number: LABMK0001\n  current-firmware: 7.24.5\n",
    "/system identity print": `  name: rt-${SEGRETO}\n`,
    "/interface print terse without-paging": " 0 RS name=ether1 default-name=ether1 type=ether mtu=1500 mac-address=02:00:00:00:20:01\n 1  S name=ether2 default-name=ether2 type=ether mtu=1500 mac-address=02:00:00:00:20:02\n 2 R  name=bond1 type=bond mtu=1500 mac-address=02:00:00:00:20:03\n 3 R  name=bridge type=bridge mtu=auto mac-address=02:00:00:00:20:04\n",
    "/interface ethernet monitor [find] once": "                      name: ether1    ether2\n                    status: link-ok   no-link\n          auto-negotiation: done      done\n                      rate: 1Gbps\n               full-duplex: yes\n",
    "/interface ethernet poe monitor [find] once": "                name: ether1     ether2\n             poe-out: auto-on    off\n      poe-out-status: powered-on disabled\n     poe-out-voltage: 24.1V\n     poe-out-current: 120mA\n       poe-out-power: 2.9W\n",
    "/interface bridge print terse without-paging": " 0 R name=bridge mtu=auto mac-address=02:00:00:00:20:04 protocol-mode=rstp priority=0x8000 vlan-filtering=yes\n",
    "/interface bridge port print terse without-paging": " 0   interface=ether1 bridge=bridge pvid=10\n 1   interface=bond1 bridge=bridge pvid=1\n",
    "/interface bridge port monitor [find] once": "               interface: ether1             bond1\n                  status: in-bridge          in-bridge\n                    role: designated-port    root-port\n              forwarding: yes                yes\n                learning: yes                yes\n",
    "/interface bridge vlan print terse without-paging": " 0   bridge=bridge vlan-ids=10 tagged=bridge,bond1 untagged=ether1 current-tagged=bridge,bond1 current-untagged=ether1\n 1   bridge=bridge vlan-ids=100-102,200 tagged=bridge,bond1 untagged= current-tagged= current-untagged=\n",
    "/interface bridge host print terse without-paging": " 0  D mac-address=02:00:00:00:30:01 vid=10 on-interface=ether1 bridge=bridge\n",
    "/interface bonding print terse without-paging": " 0 R name=bond1 mtu=1500 slaves=ether3,ether4 mode=802.3ad\n",
    "/ip neighbor print terse without-paging": " 0 interface=bond1 address=192.0.2.1 address4=192.0.2.1 mac-address=02:00:00:00:40:01 identity=sw-core platform=MikroTik version=7.24.5 (stable) interface-name=sfp1 system-caps-enabled=bridge,router discovered-by=lldp\n",
    "/ip address print terse without-paging": " 0   address=192.0.2.2/24 network=192.0.2.0 interface=bridge actual-interface=bridge\n",
    "/ip arp print terse without-paging": "   0 DC address=192.0.2.50 mac-address=02:00:00:00:30:01 interface=bridge published=no status=reachable\n",
};
const mikrotikReq: AcquisitionRequest = { collector: "mikrotik-routeros", host: "192.0.2.2", ssh: { username: "lab", password: SEGRETO } };
export const MIKROTIK_USCITE = mikrotikUscite;

// Windows via WinRM: la busta JSON degli script (windows-script.ts) con dati inventati.
const winBusta = (data: unknown) => JSON.stringify({ ok: true, data });
const windowsUscite: Record<string, string> = {
    identita: winBusta({ manufacturer: "Lab", model: "LabServer 1", hostname: `srv-${SEGRETO}`, domain: "lab.example", part_of_domain: true, serial: "LABW0001", bios: "LAB 1.0", os_caption: "Microsoft Windows Server 2022 Standard", os_version: "10.0.20348", os_build: "20348", architecture: "64 bit", boot_time: "2026-10-01T06:00:00.0000000Z", timezone: "W. Europe Standard Time", memory_total_bytes: "34359738368", memory_free_bytes: "17179869184" }),
    rete: winBusta({ adapters: [{ name: "Ethernet0", if_index: 4, description: "Lab NIC", mac: "02-00-00-00-50-01", status: "Up", speed_bps: "10000000000", mtu: 1500, virtual: false }], addresses: [{ address: "192.0.2.60", prefix_length: 24, if_index: 4 }] }),
    dischi: winBusta({ disks: [{ name: "\\\\.\\PHYSICALDRIVE0", model: "LAB DISK", serial: "LABD1", size_bytes: "1000204886016", interface: "SCSI", media: "Fixed hard disk media" }], volumes: { value: [{ device: "C:", file_system: "NTFS", size_bytes: "500000000000", free_bytes: "200000000000" }], Count: 1 } }),
    software: winBusta([{ name: "Lab Agent", version: "1.2.3", publisher: "Lab", install_date: "20260101" }]),
    servizi: winBusta([{ name: "W32Time", display_name: "Ora di Windows", state: "Running", start_mode: "Auto", account: "NT AUTHORITY\\LocalService" }]),
    ruoli: winBusta([{ name: "Hyper-V", display_name: "Hyper-V", type: "Role" }]),
    sicurezza: winBusta({ defender: { enabled: true, real_time: true, signature_age_days: 0 }, firewall: [{ name: "Domain", enabled: "True", inbound: "Block", outbound: "Allow" }] }),
    hyperv: winBusta([{ id: "0E3B3A3C-1111-2222-3333-444455556666", name: "vm-lab", enabled_state: 2 }]),
};
const windowsReq: AcquisitionRequest = { collector: "windows", host: "192.0.2.60", winrm: { username: "lab", password: SEGRETO } };
export const WINDOWS_USCITE = windowsUscite;
function perWinrm(richiesta: AcquisitionRequest, uscita: (id: string) => string): FixtureCollector {
    const esegui = async (risposta: (id: string) => string, guasto = false): Promise<Esito> => {
        let chiamate = 0;
        const t: AcquisitionTransports = {
            get: async () => { throw Error(SEGRETO); }, walk: async () => { throw Error(SEGRETO); }, shell: async () => { throw Error(SEGRETO); },
            winrm: async ids => { chiamate++; if (guasto) throw Error(SEGRETO); return Object.fromEntries(ids.map(id => [id, ok(risposta(id))])); },
        };
        const snapshot = await collectDevice(richiesta, t);
        return { snapshot, chiamateShell: chiamate };
    };
    return { richiesta, normale: () => esegui(uscita), formatoIgnoto: () => esegui(id => (id === "identita" ? uscita(id) : GARBAGE(id))), trasportoGuasto: () => esegui(uscita, true) };
}

// Linux (forme di util-linux, LVM, systemd e coreutils dalla documentazione; dati inventati). rpm assente: 127.
const linuxUscite: Record<string, string> = {
    "cat /etc/os-release": 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nNAME="Debian GNU/Linux"\nVERSION_ID="12"\nID=debian\n',
    "uname -srm": "Linux 6.1.0-26-amd64 x86_64\n", "hostname": `lnx-${SEGRETO}\n`, "cat /proc/uptime": "86400.00 170000.00\n",
    "cat /proc/meminfo": "MemTotal:       16000000 kB\nMemAvailable:    8000000 kB\n",
    "cat /sys/class/dmi/id/sys_vendor": "Lab\n", "cat /sys/class/dmi/id/product_name": "LabServer 2\n",
    "ip -o link show": "2: ens18: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000\\    link/ether 02:00:00:00:60:01 brd ff:ff:ff:ff:ff:ff\n",
    "ip -o -4 addr show": "2: ens18    inet 198.51.100.10/24 brd 198.51.100.255 scope global ens18\\       valid_lft forever preferred_lft forever\n",
    "lsblk -J -b -d -o NAME,SIZE,MODEL,SERIAL,ROTA,TRAN": '{"blockdevices":[{"name":"sda","size":107374182400,"model":"LAB DISK","serial":null,"rota":false,"tran":null}]}',
    "df -P -k -T": "Filesystem              Type 1024-blocks    Used Available Capacity Mounted on\n/dev/mapper/vg0-root    ext4    50000000 10000000  37000000      22% /\n",
    "df -P -i": "Filesystem               Inodes  IUsed   IFree IUse% Mounted on\n/dev/mapper/vg0-root    3276800 120000 3156800    4% /\n",
    "pvs --reportformat json --units b --nosuffix -o pv_name,vg_name,pv_size,pv_free": '{"report":[{"pv":[{"pv_name":"/dev/sda3","vg_name":"vg0","pv_size":"106300440576","pv_free":"0"}]}]}',
    "vgs --reportformat json --units b --nosuffix -o vg_name,vg_size,vg_free,lv_count": '{"report":[{"vg":[{"vg_name":"vg0","vg_size":"106300440576","vg_free":"0","lv_count":"2"}]}]}',
    "lvs --reportformat json --units b --nosuffix -o lv_name,vg_name,lv_size,lv_path": '{"report":[{"lv":[{"lv_name":"root","vg_name":"vg0","lv_size":"51200000000","lv_path":"/dev/vg0/root"}]}]}',
    "timedatectl show": "Timezone=Europe/Rome\nLocalRTC=no\nNTP=yes\nNTPSynchronized=yes\n", "cat /sys/module/apparmor/parameters/enabled": "Y\n",
    "dpkg-query -W -f '${Package}\\t${Version}\\n'": "openssh-server\t1:9.2p1-2+deb12u3\nbash\t5.2.15-2+b7\n",
    "systemctl show --property=Id,Description,ActiveState,UnitFileState '*.service'": "Id=ssh.service\nDescription=OpenBSD Secure Shell server\nActiveState=active\nUnitFileState=enabled\n\nId=cron.service\nDescription=Regular background program processing daemon\nActiveState=inactive\nUnitFileState=disabled\n",
};
const LINUX_ASSENTI = new Set(["getenforce", "rpm -qa --qf '%{NAME}\\t%{VERSION}-%{RELEASE}\\n'", "cat /sys/class/dmi/id/product_serial"]);
const linuxReq: AcquisitionRequest = { collector: "linux", host: "198.51.100.10", ssh: { username: "lab", password: SEGRETO } };
export const LINUX_USCITE = linuxUscite;
function perExecLinux(): FixtureCollector {
    const base = perExec(linuxReq, c => linuxUscite[c] ?? "", ["cat /etc/os-release", "uname -srm"]);
    // Come perExec, ma i comandi che il sistema non ha rispondono «non supportato» (exit 127) invece che vuoti.
    const esegui = async (risposta: (c: string) => string): Promise<Esito> => {
        let chiamate = 0;
        const t: AcquisitionTransports = {
            get: async () => { throw Error(SEGRETO); }, walk: async () => { throw Error(SEGRETO); },
            shell: async comandi => { chiamate++; return Object.fromEntries(comandi.map(c => [c, LINUX_ASSENTI.has(c) ? { status: "unsupported" as const, data: "", warnings: ["COMMAND_UNSUPPORTED"] } : ok(risposta(c))])); },
        };
        return { snapshot: await collectDevice(linuxReq, t), chiamateShell: chiamate };
    };
    return { ...base, normale: () => esegui(c => linuxUscite[c] ?? "") };
}

// Synology DSM 7 (forme dalla documentazione DSM, da DADude3 synology.py e dal motore d'inventario; dati inventati). synoshare senza root: errore.
const synologyUscite: Record<string, string> = {
    "uname -s": "Linux\n", "hostname": `syn-${SEGRETO}\n`, "cat /proc/sys/kernel/syno_hw_version": "DS-LAB\n", "cat /proc/sys/kernel/syno_serial": "LABS0001\n", "cat /etc.defaults/VERSION": 'majorversion="7"\nminorversion="2"\nproductversion="7.2.1"\nbuildnumber="69057"\nsmallfixnumber="5"\n',
    "cat /proc/meminfo": "MemTotal:        4000000 kB\nMemFree:         1000000 kB\n", "cat /proc/mdstat": "md2 : active raid1 sata1p3[0] sata2p3[1]\n",
    "df -P -k": "Filesystem         1024-blocks       Used  Available Capacity Mounted on\n/dev/mapper/cachedev_0 7000000000 1000000000 6000000000      15% /volume1\n",
    "ip -j link show": linkJson("eth0", "02:00:00:00:70:01"), "ip -j address show": addrJson("eth0", "192.0.2.70"),
    "lsblk -b -J -o NAME,TYPE,SIZE,MODEL,SERIAL,ROTA": '{"blockdevices":[{"name":"sata1","type":"disk","size":4000787030016,"model":"LAB DISK","serial":"LABS2","rota":true}]}',
    "cat /etc/samba/smb.share.conf": "[Dati]\npath=/volume1/Dati\ncomment=Prova\n",
    "cat /etc/exports": "/volume1/Dati\t192.0.2.0/24(rw,async,no_wdelay,crossmnt,insecure,all_squash,insecure_locks,sec=sys,anonuid=1025,anongid=100)\n",
    "cat /var/packages/*/INFO": 'package="HyperBackup"\nversion="4.1.0-3718"\nmaintainer="Synology Inc."\npackage="SynologyPhotos"\nversion="1.6.2-0720"\nmaintainer="Synology Inc."\n',
};
const synologyReq: AcquisitionRequest = { collector: "synology-dsm", host: "192.0.2.70", ssh: { username: "lab", password: SEGRETO } };
export const SYNOLOGY_USCITE = synologyUscite;
function perExecSynology(): FixtureCollector {
    const base = perExec(synologyReq, c => synologyUscite[c] ?? "", ["hostname", "cat /etc.defaults/VERSION"]);
    const esegui = async (): Promise<Esito> => {
        let chiamate = 0;
        const t: AcquisitionTransports = {
            get: async () => { throw Error(SEGRETO); }, walk: async () => { throw Error(SEGRETO); },
            shell: async comandi => { chiamate++; return Object.fromEntries(comandi.map(c => [c, c.startsWith("synoshare") ? { status: "error" as const, data: "", warnings: ["SSH_COMMAND_FAILED"] } : ok(synologyUscite[c] ?? "")])); },
        };
        return { snapshot: await collectDevice(synologyReq, t), chiamateShell: chiamate };
    };
    return { ...base, normale: esegui };
}


// Ubiquiti diretto e Proxmox VE (forme del motore d'inventario; dati inventati).
const ubiquitiUscite: Record<string, string> = {
    "uname -s": "Linux\n", "hostname": `ap-${SEGRETO}\n`, "cat /etc/version": "6.6.0\n", "mca-status": '{"model":"UAP-LAB","name":"ap-lab","mac":"02:00:00:00:80:01","version":"6.6.0","password":"non-esportare"}',
    "cat /proc/meminfo": "MemTotal:         256000 kB\nMemFree:          100000 kB\n", "ip -j link show": linkJson("eth0", "02:00:00:00:80:01"), "ip -j address show": addrJson("eth0", "192.0.2.80"),
    "ip -j neighbor show": '[{"dst":"192.0.2.1","dev":"eth0","lladdr":"02:00:00:00:80:02","state":["REACHABLE"]}]',
};
const ubiquitiReq: AcquisitionRequest = { collector: "ubiquiti-device", host: "192.0.2.80", ssh: { username: "lab", password: SEGRETO } };
export const PROXMOX_USCITE: Record<string, string> = {
    "pveversion": "pve-manager/8.2.4/faa83925c9641325 (running kernel: 6.8.8-2-pve)\n", "hostname": `pve-${SEGRETO}\n`,
    "pvesh get /nodes --output-format json": '[{"node":"pve-lab","status":"online","cpu":0.1,"maxcpu":8,"mem":1000,"maxmem":8000,"disk":1,"maxdisk":100,"uptime":1000,"id":"node/pve-lab","type":"node"}]',
    "pvesh get /cluster/status --output-format json": '[{"type":"node","name":"pve-lab","online":1,"local":1,"ip":"192.0.2.90","id":"node/pve-lab","nodeid":1}]',
    "pvesh get /cluster/resources --output-format json": JSON.stringify([
        { id: "qemu/100", type: "qemu", node: "pve-lab", vmid: 100, name: "guest-lab", status: "running", maxcpu: 4, maxmem: 8589934592, maxdisk: 34359738368, uptime: 3600, token: "non-esportare" },
        { id: "qemu/101", type: "qemu", node: "pve-lab", vmid: 101, name: "guest-spenta", status: "stopped", maxcpu: 2, maxmem: 2147483648, maxdisk: 10737418240 },
        { id: "lxc/200", type: "lxc", node: "pve-lab", vmid: 200, name: "ct-lab", status: "running", maxcpu: 1, maxmem: 536870912, maxdisk: 8589934592 },
        { id: "storage/pve-lab/local-lvm", type: "storage", node: "pve-lab", storage: "local-lvm", plugintype: "lvmthin", status: "available", content: "rootdir,images", shared: 0, maxdisk: 100000000000, disk: 25000000000 },
        { id: "node/pve-lab", type: "node", node: "pve-lab", status: "online", uptime: 86400, maxcpu: 8, cpu: 0.05, maxmem: 34359738368, mem: 8589934592 },
    ]),
    'grep -H "" /etc/pve/nodes/*/qemu-server/*.conf': [
        "/etc/pve/nodes/pve-lab/qemu-server/100.conf:bios: ovmf", "/etc/pve/nodes/pve-lab/qemu-server/100.conf:machine: q35", "/etc/pve/nodes/pve-lab/qemu-server/100.conf:agent: 1",
        "/etc/pve/nodes/pve-lab/qemu-server/100.conf:scsi0: local-lvm:vm-100-disk-0,size=32G", "/etc/pve/nodes/pve-lab/qemu-server/100.conf:ide2: local:iso/lab.iso,media=cdrom,size=1G",
        "/etc/pve/nodes/pve-lab/qemu-server/100.conf:net0: virtio=02:00:00:00:90:10,bridge=vmbr0,tag=20",
        "/etc/pve/nodes/pve-lab/qemu-server/100.conf:[prima]", "/etc/pve/nodes/pve-lab/qemu-server/100.conf:scsi1: local-lvm:vm-100-disk-9,size=999G",
        "/etc/pve/nodes/pve-lab/qemu-server/101.conf:scsi0: local-lvm:vm-101-disk-0,size=10G", "",
    ].join("\n"),
    'grep -H "" /etc/pve/nodes/*/lxc/*.conf': [
        "/etc/pve/nodes/pve-lab/lxc/200.conf:rootfs: local-lvm:vm-200-disk-0,size=8G", "/etc/pve/nodes/pve-lab/lxc/200.conf:net0: name=eth0,bridge=vmbr0,hwaddr=02:00:00:00:90:20,ip=192.0.2.200/24,tag=30", "",
    ].join("\n"),
    "ip -d -j link show": linkJson("vmbr0", "02:00:00:00:90:01"), "ip -j address show": addrJson("vmbr0", "192.0.2.90"), "cat /proc/meminfo": "MemTotal:        8000000 kB\nMemFree:         1000000 kB\n",
    "lsblk -b -J -o NAME,TYPE,SIZE,MODEL,SERIAL,ROTA": '{"blockdevices":[]}',
};
const proxmoxReq: AcquisitionRequest = { collector: "proxmox-ve", host: "192.0.2.90", ssh: { username: "lab", password: SEGRETO } };

// UniFi controller: client finto (nessuna rete), un apparato offline che resta inventario.
const unifiReq: AcquisitionRequest = { collector: "unifi-controller", host: "192.0.2.100", unifi: { api_token: SEGRETO } };
function unifiFixture(): FixtureCollector {
    const finto = (guasto: boolean) => (() => ({ kind: "udm", probe: async () => ({ ok: true, devices: 0, certPin: null, certPinRecorded: false }), listDevices: async () => { if (guasto) throw Error(SEGRETO); return [{ mac: "02:00:00:00:a0:01", name: `sw-${SEGRETO}`, model: "USW-LAB", type: "usw", ip: "192.0.2.101", state: 1, version: "7.0.0", serial: null, adopted: true, port_table: [], lldp_table: [], uplink: null }]; }, listClients: async () => [] })) as unknown as typeof createUnifiClient;
    return {
        richiesta: unifiReq,
        normale: async () => ({ snapshot: await collectUnifiController(unifiReq, finto(false)), chiamateShell: 0 }),
        trasportoGuasto: async () => ({ snapshot: await collectUnifiController(unifiReq, finto(true)), chiamateShell: 0 }),
    };
}

export const FIXTURE: Record<CollectorId, FixtureCollector> = {
    "qnap-switch": conGarbage(perShell(qnapReq, consola({ identita: { "show system-information": qnapIdent } }, qnapNormale)), { "show system-information": qnapIdent }, undefined),
    "hp-procurve": conGarbage(perShell(procurveReq, consola({ identita: procurveIdent, snmp: procurveSnmp }, procurveNormale)), procurveIdent, procurveSnmp),
    "hp-comware": conGarbage(perShell(comwareReq, consola({ identita: comwareIdent, snmp: comwareSnmp }, comwareNormale)), comwareIdent, comwareSnmp),
    "vmware-esxi": {
        richiesta: esxiReq,
        normale: async () => ({ snapshot: await collectVmwareEsxi(esxiReq, async () => esxiRaw()), chiamateShell: 0 }),
        trasportoGuasto: async () => ({ snapshot: await collectVmwareEsxi(esxiReq, async () => { throw Error(SEGRETO); }), chiamateShell: 0 }),
    },
    "qnap-nas": perExec(qnapNasReq, c => qnapNasUscite[c] ?? "", ["hostname", "getsysinfo model", "getsysinfo firmver", "cat /etc/version", "cat /etc/default_config/WEBAPP.build"]),
    "mikrotik-routeros": perExec(mikrotikReq, c => mikrotikUscite[c] ?? "", ["/system resource print", "/system routerboard print"]),
    "windows": perWinrm(windowsReq, id => windowsUscite[id] ?? ""),
    "linux": perExecLinux(),
    "synology-dsm": perExecSynology(),
    "ubiquiti-device": perExec(ubiquitiReq, c => ubiquitiUscite[c] ?? "", ["hostname", "cat /etc/version"]),
    "proxmox-ve": perExec(proxmoxReq, c => PROXMOX_USCITE[c] ?? "", ["pveversion", "hostname"]),
    "unifi-controller": unifiFixture(),
    "netapp-ontap": {
        richiesta: ontapReq,
        normale: async () => ({ snapshot: await collectNetappOntap(ontapReq, async () => ontapRaw()), chiamateShell: 0 }),
        trasportoGuasto: async () => ({ snapshot: await collectNetappOntap(ontapReq, async () => { throw Error(SEGRETO); }), chiamateShell: 0 }),
    },
};
