import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { HUB_SCHEMA_SQL, HUB_INDEXES_SQL } from "./db-hub-schema";
import type { FingerprintUserRule } from "./device-fingerprint-classification";

// ═══════════════════════════════════════════════════════════════════════════
// Hub DB singleton (tenants, users, settings, profiles)
// ═══════════════════════════════════════════════════════════════════════════

const DATA_DIR = path.join(process.cwd(), "data");
const HUB_DB_PATH = process.env.DA_IPAM_HUB_DB_PATH?.trim()
  ? path.resolve(process.env.DA_IPAM_HUB_DB_PATH.trim())
  : path.join(DATA_DIR, "hub.db");

let _hubDb: Database.Database | null = null;

// ========================
// Seed functions
// ========================

function seedBuiltinFingerprintRules(db: Database.Database): void {
  const count = (db.prepare("SELECT COUNT(*) as c FROM device_fingerprint_rules").get() as { c: number }).c;
  const ins = db.prepare(
    `INSERT OR IGNORE INTO device_fingerprint_rules
     (name, device_label, classification, priority, enabled, tcp_ports_key, tcp_ports_optional, min_key_ports,
      oid_prefix, sysdescr_pattern, hostname_pattern, mac_vendor_pattern, banner_pattern, ttl_min, ttl_max, note, builtin)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  );
  const rules: Array<{
    name: string; label: string; cls: string; pri: number;
    keyPorts?: number[]; optPorts?: number[]; minKey?: number;
    oid?: string; sysDescr?: string; hostname?: string; macVendor?: string; banner?: string;
    ttlMin?: number; ttlMax?: number; note?: string;
  }> = [
    // ── Port signatures ──
    { name: "Proxmox VE (porte)", label: "Proxmox VE", cls: "hypervisor", pri: 10, keyPorts: [8006, 22], optPorts: [3128, 8007] },
    { name: "Synology DSM (porte)", label: "Synology DSM", cls: "storage", pri: 10, keyPorts: [5000, 5001, 22], optPorts: [6690, 7304] },
    { name: "QNAP QTS (porte)", label: "QNAP QTS", cls: "storage", pri: 10, keyPorts: [8080, 22], optPorts: [9000, 443] },
    { name: "TrueNAS (porte)", label: "TrueNAS", cls: "storage", pri: 15, keyPorts: [80, 443, 2049], optPorts: [22], note: "Richiede NFS (2049) per distinguere da generico" },
    { name: "MikroTik RouterOS (porte)", label: "MikroTik RouterOS", cls: "router", pri: 10, keyPorts: [8291, 22], optPorts: [80, 443, 8728] },
    { name: "UniFi Controller (porte)", label: "UniFi Controller", cls: "access_point", pri: 10, keyPorts: [8443, 8080], optPorts: [8880, 6789, 22] },
    { name: "Stormshield SNS (porte)", label: "Stormshield SNS", cls: "firewall", pri: 10, keyPorts: [443, 22, 1300], optPorts: [] },
    { name: "Hikvision (porte)", label: "Hikvision", cls: "telecamera", pri: 10, keyPorts: [554, 8000], optPorts: [80, 8001, 443] },
    { name: "Dahua / NVR (porte)", label: "Dahua / NVR", cls: "telecamera", pri: 10, keyPorts: [554, 37777], optPorts: [80, 443] },
    { name: "Telecam XMEye/clone (porte)", label: "Telecam XMEye/clone", cls: "telecamera", pri: 10, keyPorts: [34567, 554], optPorts: [80] },
    {
      name: "Windows Server (porte)",
      label: "Windows Server",
      cls: "server_windows",
      pri: 20,
      keyPorts: [135, 139, 445],
      optPorts: [3389, 5985],
      minKey: 2,
      note: "Almeno 2 tra 135/139/445 + opzionali RDP/WinRM",
    },
    { name: "HPE iLO (porte)", label: "HPE iLO", cls: "server", pri: 10, keyPorts: [17988, 17990], optPorts: [443, 623] },
    { name: "PBX SIP (porte)", label: "PBX SIP (FreePBX/3CX)", cls: "voip", pri: 10, keyPorts: [5060], optPorts: [5061, 80, 443] },
    { name: "Zabbix (porte)", label: "Zabbix", cls: "server", pri: 10, keyPorts: [10050, 10051], optPorts: [80, 443] },
    { name: "Wazuh (porte)", label: "Wazuh", cls: "server", pri: 10, keyPorts: [1514, 1515, 55000], optPorts: [443] },
    { name: "Linux generico (porte)", label: "Linux generico", cls: "server_linux", pri: 90, keyPorts: [22], optPorts: [80, 443], note: "Bassa priorità: fallback generico" },
    // ── OID ──
    { name: "HP stampante (OID)", label: "HP Stampante", cls: "stampante", pri: 5, oid: "1.3.6.1.4.1.11.2.3.9" },
    { name: "HP ProCurve switch (OID)", label: "HP ProCurve", cls: "switch", pri: 5, oid: "1.3.6.1.4.1.11.2.3.7" },
    { name: "MikroTik (OID)", label: "MikroTik RouterOS", cls: "router", pri: 5, oid: "1.3.6.1.4.1.14988.1" },
    { name: "Ubiquiti AP (OID)", label: "UniFi/Ubiquiti", cls: "access_point", pri: 5, oid: "1.3.6.1.4.1.41112" },
    { name: "Ruckus AP (OID)", label: "Ruckus AP", cls: "access_point", pri: 5, oid: "1.3.6.1.4.1.25053" },
    { name: "Hikvision (OID)", label: "Hikvision", cls: "telecamera", pri: 5, oid: "1.3.6.1.4.1.39165" },
    { name: "Synology (OID)", label: "Synology DSM", cls: "storage", pri: 5, oid: "1.3.6.1.4.1.6574" },
    { name: "QNAP (OID)", label: "QNAP QTS", cls: "storage", pri: 5, oid: "1.3.6.1.4.1.24681" },
    { name: "Epson stampante (OID)", label: "Epson", cls: "stampante", pri: 5, oid: "1.3.6.1.4.1.1248" },
    { name: "VMware (OID)", label: "VMware ESXi", cls: "hypervisor", pri: 5, oid: "1.3.6.1.4.1.6876" },
    { name: "APC UPS (OID)", label: "APC UPS", cls: "ups", pri: 5, oid: "1.3.6.1.4.1.318" },
    { name: "Yealink VoIP (OID)", label: "Yealink VoIP", cls: "voip", pri: 5, oid: "1.3.6.1.4.1.3990" },
    { name: "Fortinet (OID)", label: "Fortinet FortiGate", cls: "firewall", pri: 5, oid: "1.3.6.1.4.1.12356" },
    { name: "pfSense (OID)", label: "pfSense", cls: "firewall", pri: 5, oid: "1.3.6.1.4.1.12325" },
    { name: "Netgear (OID)", label: "Netgear", cls: "switch", pri: 5, oid: "1.3.6.1.4.1.4526" },
    { name: "Cisco switch (OID)", label: "Cisco", cls: "switch", pri: 6, oid: "1.3.6.1.4.1.9.1" },
    { name: "net-snmp Linux (OID)", label: "Linux/net-snmp", cls: "server_linux", pri: 50, oid: "1.3.6.1.4.1.8072.3.2", note: "Generico Linux; Proxmox override se porta 8006 o sysDescr" },
    // ── sysDescr / testo ──
    { name: "RouterOS (sysDescr)", label: "MikroTik RouterOS", cls: "router", pri: 30, sysDescr: "routeros|mikrotik" },
    { name: "Proxmox (sysDescr)", label: "Proxmox VE", cls: "hypervisor", pri: 30, sysDescr: "proxmox|pve-manager|qemu.?kvm" },
    { name: "Synology (sysDescr)", label: "Synology DSM", cls: "storage", pri: 30, sysDescr: "synology|diskstation" },
    { name: "QNAP (sysDescr)", label: "QNAP QTS", cls: "storage", pri: 30, sysDescr: "qnap|\\bqts\\b" },
    { name: "ESXi (sysDescr)", label: "VMware ESXi", cls: "hypervisor", pri: 30, sysDescr: "esxi|vmware\\s*esx" },
    { name: "Firewall generico (sysDescr)", label: "Firewall", cls: "firewall", pri: 35, sysDescr: "firewall|fortigate|pfsense|opnsense|sophos" },
    { name: "Windows Server (sysDescr)", label: "Windows Server", cls: "server_windows", pri: 35, sysDescr: "windows\\s*server|microsoft.*server" },
    { name: "Stampante (sysDescr)", label: "Stampante", cls: "stampante", pri: 35, sysDescr: "printer|laserjet|deskjet|officejet|epson|brother.*print|lexmark|ricoh|xerox" },
    // ── Hostname ──
    { name: "AP hostname", label: "Access Point", cls: "access_point", pri: 60, hostname: "^ap[-_]|^wifi[-_]|^unifi[-_]|^ubnt[-_]" },
    { name: "Printer hostname", label: "Stampante", cls: "stampante", pri: 60, hostname: "^printer[-_]|^print[-_]|^hp[-_]lj" },
    { name: "Camera hostname", label: "Telecamera", cls: "telecamera", pri: 60, hostname: "^cam[-_]|^ipcam[-_]|^nvr[-_]|^dvr[-_]" },
    { name: "NAS hostname", label: "NAS/Storage", cls: "storage", pri: 60, hostname: "^nas[-_]|^synology[-_]|^qnap[-_]" },
    { name: "Switch hostname", label: "Switch", cls: "switch", pri: 60, hostname: "^switch[-_]|^sw[-_]" },
    { name: "Router hostname", label: "Router", cls: "router", pri: 60, hostname: "^router[-_]|^gw[-_]|^gateway[-_]" },
    { name: "Hypervisor hostname", label: "Hypervisor", cls: "hypervisor", pri: 60, hostname: "^esxi[-_]|^proxmox[-_]|^pve[-_]" },
    // ── MAC vendor ──
    { name: "Synology MAC", label: "Synology DSM", cls: "storage", pri: 70, macVendor: "synology" },
    { name: "QNAP MAC", label: "QNAP QTS", cls: "storage", pri: 70, macVendor: "qnap" },
    { name: "Hikvision MAC", label: "Hikvision", cls: "telecamera", pri: 70, macVendor: "hikvision|hangzhou" },
    { name: "VM MAC", label: "VM", cls: "vm", pri: 70, macVendor: "vmware|proxmox\\s*server|microsoft\\s*virtual|hyper-v|qemu|xensource|oracle\\s*vm|red\\s*hat.*kvm" },
    { name: "Apple MAC", label: "Client Apple", cls: "workstation", pri: 75, macVendor: "apple" },
    // ── Banner HTTP ──
    { name: "Proxmox banner", label: "Proxmox VE", cls: "hypervisor", pri: 25, banner: "proxmox|pve-manager" },
    { name: "Synology banner", label: "Synology DSM", cls: "storage", pri: 25, banner: "synology|diskstation" },
    { name: "QNAP banner", label: "QNAP QTS", cls: "storage", pri: 25, banner: "qnap|qts" },
    // ── TTL ──
    { name: "TTL Windows", label: "Windows", cls: "workstation", pri: 95, ttlMin: 65, ttlMax: 128, note: "TTL 65-128 suggerisce Windows; bassa priorità" },
  ];
  if (count === 0) {
    const t = db.transaction(() => {
      for (const r of rules) {
        ins.run(
          r.name, r.label, r.cls, r.pri,
          r.keyPorts ? JSON.stringify(r.keyPorts) : null,
          r.optPorts ? JSON.stringify(r.optPorts) : null,
          r.minKey ?? null,
          r.oid ?? null,
          r.sysDescr ?? null,
          r.hostname ?? null,
          r.macVendor ?? null,
          r.banner ?? null,
          r.ttlMin ?? null,
          r.ttlMax ?? null,
          r.note ?? null,
        );
      }
    });
    t();
  } else {
    // Inserisci solo regole builtin mancanti (per aggiornamenti)
    const existingNames = new Set(
      (db.prepare("SELECT name FROM device_fingerprint_rules").all() as Array<{ name: string }>)
        .map((r) => r.name)
    );
    const missing = rules.filter((r) => !existingNames.has(r.name));
    if (missing.length > 0) {
      const t = db.transaction(() => {
        for (const r of missing) {
          ins.run(
            r.name, r.label, r.cls, r.pri,
            r.keyPorts ? JSON.stringify(r.keyPorts) : null,
            r.optPorts ? JSON.stringify(r.optPorts) : null,
            r.minKey ?? null,
            r.oid ?? null,
            r.sysDescr ?? null,
            r.hostname ?? null,
            r.macVendor ?? null,
            r.banner ?? null,
            r.ttlMin ?? null,
            r.ttlMax ?? null,
            r.note ?? null,
          );
        }
      });
      t();
    }
  }
}

function seedBuiltinSnmpVendorProfiles(db: Database.Database): void {
  const count = (db.prepare("SELECT COUNT(*) as c FROM snmp_vendor_profiles").get() as { c: number }).c;

  const ins = db.prepare(`INSERT INTO snmp_vendor_profiles
    (profile_id, name, category, enterprise_oid_prefixes, sysdescr_pattern, fields, confidence, enabled, builtin)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`);

  const profiles = [
    // FIREWALL
    { id: "stormshield", name: "Stormshield SNS", cat: "firewall", oids: ["1.3.6.1.4.1.11256"], conf: 0.98,
      fields: { model: "1.3.6.1.4.1.11256.1.1.1.0", firmware: "1.3.6.1.4.1.11256.1.1.2.0", serial: "1.3.6.1.4.1.11256.1.1.3.0" } },
    { id: "fortinet", name: "Fortinet FortiGate", cat: "firewall", oids: ["1.3.6.1.4.1.12356"], conf: 0.98,
      fields: { firmware: "1.3.6.1.4.1.12356.101.4.1.1.0", model: "1.3.6.1.4.1.12356.101.4.1.5.0", serial: "1.3.6.1.4.1.12356.101.4.1.4.0" } },
    { id: "pfsense", name: "pfSense", cat: "firewall", oids: ["1.3.6.1.4.1.12325"], sysDescr: "pfsense", conf: 0.95,
      fields: { os: "1.3.6.1.2.1.1.1.0" } },
    { id: "opnsense", name: "OPNsense", cat: "firewall", oids: [] as string[], sysDescr: "opnsense", conf: 0.95,
      fields: { os: "1.3.6.1.2.1.1.1.0" } },
    { id: "sophos", name: "Sophos XG/XGS", cat: "firewall", oids: ["1.3.6.1.4.1.2604"], conf: 0.97,
      fields: { model: "1.3.6.1.4.1.2604.5.1.1.2.0", firmware: "1.3.6.1.4.1.2604.5.1.1.3.0" } },
    { id: "paloalto", name: "Palo Alto Networks", cat: "firewall", oids: ["1.3.6.1.4.1.25461"], conf: 0.98,
      fields: { firmware: "1.3.6.1.4.1.25461.2.1.2.1.1.0", model: "1.3.6.1.4.1.25461.2.1.2.1.5.0", serial: "1.3.6.1.4.1.25461.2.1.2.1.3.0" } },
    // SWITCH
    { id: "cisco_switch", name: "Cisco Switch", cat: "switch", oids: ["1.3.6.1.4.1.9.1.5", "1.3.6.1.4.1.9.1.1"], conf: 0.96,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: ["1.3.6.1.2.1.47.1.1.1.1.11.1", "1.3.6.1.4.1.9.3.6.3.0"], firmware: "1.3.6.1.2.1.47.1.1.1.1.10.1" } },
    { id: "cisco_router", name: "Cisco Router", cat: "router", oids: ["1.3.6.1.4.1.9.1"], conf: 0.94,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: ["1.3.6.1.2.1.47.1.1.1.1.11.1", "1.3.6.1.4.1.9.3.6.3.0"], firmware: "1.3.6.1.2.1.47.1.1.1.1.10.1" } },
    { id: "hp_procurve", name: "HP ProCurve (ArubaOS-Switch)", cat: "switch", oids: ["1.3.6.1.4.1.11.2.14.11.5.1", "1.3.6.1.4.1.11.2.3.7"], conf: 0.97,
      fields: { model: "1.3.6.1.4.1.11.2.14.11.5.1.1.2.0", firmware: "1.3.6.1.4.1.11.2.14.11.5.1.1.7.0", serial: "1.3.6.1.4.1.11.2.14.11.5.1.1.10.0" } },
    { id: "hp_comware", name: "HP Comware (FlexFabric)", cat: "switch", oids: ["1.3.6.1.4.1.25506"], conf: 0.96,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: "1.3.6.1.2.1.47.1.1.1.1.11.1" } },
    { id: "juniper", name: "Juniper Networks", cat: "router", oids: ["1.3.6.1.4.1.2636"], conf: 0.97,
      fields: { model: "1.3.6.1.4.1.2636.3.1.2.0", serial: "1.3.6.1.4.1.2636.3.1.3.0" } },
    { id: "aruba", name: "Aruba Networks (HPE)", cat: "switch", oids: ["1.3.6.1.4.1.14823"], conf: 0.96,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: "1.3.6.1.2.1.47.1.1.1.1.11.1" } },
    { id: "netgear", name: "Netgear Switch", cat: "switch", oids: ["1.3.6.1.4.1.4526"], conf: 0.95,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: "1.3.6.1.2.1.47.1.1.1.1.11.1" } },
    { id: "dlink", name: "D-Link Switch", cat: "switch", oids: ["1.3.6.1.4.1.171"], conf: 0.94,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: "1.3.6.1.2.1.47.1.1.1.1.11.1" } },
    { id: "tplink_omada", name: "TP-Link Omada", cat: "switch", oids: ["1.3.6.1.4.1.11863"], conf: 0.95,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: "1.3.6.1.2.1.47.1.1.1.1.11.1", firmware: "1.3.6.1.2.1.47.1.1.1.1.9.1" } },
    { id: "ubiquiti_edgeswitch", name: "Ubiquiti EdgeSwitch", cat: "switch", oids: ["1.3.6.1.4.1.4413"], conf: 0.96,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: "1.3.6.1.2.1.47.1.1.1.1.11.1" } },
    // ROUTER
    { id: "mikrotik", name: "MikroTik RouterOS", cat: "router", oids: ["1.3.6.1.4.1.14988"], conf: 0.98,
      fields: { model: "1.3.6.1.4.1.14988.1.1.7.1.0", serial: "1.3.6.1.4.1.14988.1.1.7.3.0", firmware: "1.3.6.1.4.1.14988.1.1.7.4.0" } },
    { id: "ubiquiti_edgerouter", name: "Ubiquiti EdgeRouter", cat: "router", oids: ["1.3.6.1.4.1.41112.1.5"], sysDescr: "edgeos", conf: 0.95,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1" } },
    // ACCESS POINT
    { id: "ubiquiti_unifi_ap", name: "Ubiquiti UniFi AP", cat: "access_point", oids: ["1.3.6.1.4.1.41112.1.6"], conf: 0.97,
      fields: { model: "1.3.6.1.4.1.41112.1.6.1.1.0", firmware: "1.3.6.1.4.1.41112.1.6.1.2.0", serial: "1.3.6.1.4.1.41112.1.6.1.3.0" } },
    { id: "ruckus_ap", name: "Ruckus AP", cat: "access_point", oids: ["1.3.6.1.4.1.25053.3.1.4", "1.3.6.1.4.1.25053.3.1.5"], conf: 0.97,
      sysDescr: "ruckus",
      fields: { model: "1.3.6.1.4.1.25053.1.2.1.1.1.5.1.2.1", serial: "1.3.6.1.4.1.25053.1.2.1.1.1.5.1.3.1", firmware: "1.3.6.1.4.1.25053.1.2.1.1.1.5.1.7.1" } },
    { id: "ruckus_controller", name: "Ruckus SmartZone", cat: "access_point", oids: ["1.3.6.1.4.1.25053.3.1.11", "1.3.6.1.4.1.25053.3.1.13"], conf: 0.96,
      fields: { model: "1.3.6.1.4.1.25053.1.2.1.1.1.5.1.2.1", firmware: "1.3.6.1.4.1.25053.1.2.1.1.1.5.1.7.1" } },
    { id: "ubiquiti_airmax", name: "Ubiquiti AirMAX", cat: "access_point", oids: ["1.3.6.1.4.1.41112.1.2"], conf: 0.96, fields: {} },
    { id: "ubiquiti_generic", name: "Ubiquiti Device", cat: "access_point", oids: ["1.3.6.1.4.1.41112"], conf: 0.90,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1" } },
    // STORAGE
    { id: "synology", name: "Synology DSM", cat: "storage", oids: ["1.3.6.1.4.1.6574"], conf: 0.98,
      fields: {
        model: "1.3.6.1.4.1.6574.1.5.1.0",
        serial: "1.3.6.1.4.1.6574.1.5.2.0",
        firmware: "1.3.6.1.4.1.6574.1.5.3.0",
        systemStatus: "1.3.6.1.4.1.6574.1.1.0",
        powerStatus: "1.3.6.1.4.1.6574.1.2.0",
        temperature: "1.3.6.1.4.1.6574.1.4.2.0",
      } },
    { id: "qnap", name: "QNAP QTS", cat: "storage", oids: ["1.3.6.1.4.1.24681"], conf: 0.98,
      fields: {
        model: "1.3.6.1.4.1.24681.1.2.1.0",
        firmware: "1.3.6.1.4.1.24681.1.2.2.0",
        serial: "1.3.6.1.4.1.24681.1.2.3.0",
        temperature: "1.3.6.1.4.1.24681.1.2.7.0",
      } },
    { id: "truenas", name: "TrueNAS", cat: "storage", oids: [] as string[], sysDescr: "truenas|freenas", conf: 0.94, fields: { os: "1.3.6.1.2.1.1.1.0" } },
    { id: "netapp", name: "NetApp ONTAP", cat: "storage", oids: ["1.3.6.1.4.1.789"], conf: 0.97,
      fields: { firmware: "1.3.6.1.4.1.789.1.1.2.0", model: "1.3.6.1.4.1.789.1.1.3.0", serial: "1.3.6.1.4.1.789.1.1.4.0" } },
    // SERVER / HYPERVISOR
    { id: "hpe_ilo", name: "HPE iLO (ProLiant)", cat: "server", oids: ["1.3.6.1.4.1.232"], conf: 0.97,
      fields: { model: "1.3.6.1.4.1.232.2.2.4.2.0", serial: "1.3.6.1.4.1.232.2.2.2.6.0", partNumber: "1.3.6.1.4.1.232.2.2.4.3.0" } },
    { id: "dell_idrac", name: "Dell iDRAC (PowerEdge)", cat: "server", oids: ["1.3.6.1.4.1.674"], conf: 0.97,
      fields: { serial: "1.3.6.1.4.1.674.10892.5.1.3.2.0", model: "1.3.6.1.4.1.674.10892.5.1.3.21.0" } },
    { id: "vmware_esxi", name: "VMware ESXi", cat: "hypervisor", oids: ["1.3.6.1.4.1.6876"], conf: 0.98,
      fields: { model: "1.3.6.1.4.1.6876.1.1.0", firmware: "1.3.6.1.4.1.6876.1.2.0" } },
    { id: "proxmox", name: "Proxmox VE", cat: "hypervisor", oids: [] as string[], sysDescr: "proxmox|pve|pve-manager|qemu/kvm", conf: 0.95, fields: { os: "1.3.6.1.2.1.1.1.0" } },
    { id: "linux_generic", name: "Linux (net-snmp)", cat: "server_linux", oids: ["1.3.6.1.4.1.8072"], conf: 0.85, fields: { os: "1.3.6.1.2.1.1.1.0" } },
    { id: "windows_snmp", name: "Windows SNMP Agent", cat: "server_windows", oids: [] as string[], sysDescr: "windows", conf: 0.85, fields: { os: "1.3.6.1.2.1.1.1.0" } },
    // TELECAMERE
    { id: "hikvision", name: "Hikvision", cat: "telecamera", oids: ["1.3.6.1.4.1.39165", "1.3.6.1.4.1.50001"], conf: 0.97,
      fields: { model: "1.3.6.1.4.1.39165.1.1.0", firmware: "1.3.6.1.4.1.39165.1.3.0" } },
    { id: "dahua", name: "Dahua / NVR", cat: "telecamera", oids: ["1.3.6.1.4.1.1004849"], sysDescr: "dahua", conf: 0.95, fields: { os: "1.3.6.1.2.1.1.1.0" } },
    { id: "axis", name: "Axis Communications", cat: "telecamera", oids: ["1.3.6.1.4.1.368"], conf: 0.96,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: "1.3.6.1.2.1.47.1.1.1.1.11.1" } },
    // VoIP
    { id: "yealink", name: "Yealink VoIP", cat: "voip", oids: ["1.3.6.1.4.1.3990"], conf: 0.97,
      fields: { model: "1.3.6.1.4.1.3990.9.1.0", firmware: "1.3.6.1.4.1.3990.9.2.0" } },
    { id: "snom", name: "Snom VoIP", cat: "voip", oids: ["1.3.6.1.4.1.1526"], conf: 0.96,
      fields: { firmware: "1.3.6.1.4.1.1526.11.1.0" } },
    { id: "grandstream", name: "Grandstream VoIP", cat: "voip", oids: ["1.3.6.1.4.1.31746"], conf: 0.95, fields: { os: "1.3.6.1.2.1.1.1.0" } },
    { id: "cisco_phone", name: "Cisco IP Phone", cat: "voip", oids: ["1.3.6.1.4.1.9.6.1"], conf: 0.96,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: "1.3.6.1.2.1.47.1.1.1.1.11.1" } },
    // UPS
    { id: "apc", name: "APC (Schneider Electric)", cat: "ups", oids: ["1.3.6.1.4.1.318"], conf: 0.98,
      fields: { model: "1.3.6.1.4.1.318.1.1.1.1.1.1.0", firmware: "1.3.6.1.4.1.318.1.1.1.1.2.1.0", serial: "1.3.6.1.4.1.318.1.1.1.1.2.3.0" } },
    { id: "eaton", name: "Eaton UPS", cat: "ups", oids: ["1.3.6.1.4.1.705"], conf: 0.97,
      fields: { model: "1.3.6.1.4.1.705.1.1.1.0", firmware: "1.3.6.1.4.1.705.1.1.7.0" } },
    { id: "ups_rfc1628", name: "UPS (RFC 1628)", cat: "ups", oids: [] as string[], sysDescr: "ups|uninterruptible", conf: 0.88,
      fields: { model: "1.3.6.1.2.1.33.1.1.2.0", firmware: "1.3.6.1.2.1.33.1.1.3.0" } },
    // STAMPANTI
    { id: "hp_printer", name: "HP JetDirect (LaserJet)", cat: "stampante", oids: ["1.3.6.1.4.1.11.2.3.9"], conf: 0.97,
      fields: { serial: "1.3.6.1.4.1.11.2.3.9.1.1.7.0", model: "1.3.6.1.4.1.11.2.3.9.4.2.1.1.1.1.20.1" } },
    { id: "epson", name: "Epson Printer", cat: "stampante", oids: ["1.3.6.1.4.1.1248"], conf: 0.96,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: "1.3.6.1.2.1.43.5.1.1.16.1" } },
    { id: "printer_generic", name: "Printer (RFC 3805)", cat: "stampante", oids: [] as string[], sysDescr: "printer|laserjet|deskjet|officejet|multifunction|mfp", conf: 0.88,
      fields: { serial: "1.3.6.1.2.1.43.5.1.1.16.1" } },
  ];

  // Se la tabella è vuota, inserisci tutti; altrimenti inserisci solo i profili builtin mancanti
  if (count === 0) {
    const t = db.transaction(() => {
      for (const p of profiles) {
        ins.run(
          p.id, p.name, p.cat,
          JSON.stringify(p.oids),
          p.sysDescr ?? null,
          JSON.stringify(p.fields),
          p.conf
        );
      }
    });
    t();
  } else {
    // Inserisci solo profili builtin che non esistono ancora nel DB
    const existingIds = new Set(
      (db.prepare("SELECT profile_id FROM snmp_vendor_profiles").all() as Array<{ profile_id: string }>)
        .map((r) => r.profile_id)
    );
    const missing = profiles.filter((p) => !existingIds.has(p.id));
    if (missing.length > 0) {
      const t = db.transaction(() => {
        for (const p of missing) {
          ins.run(
            p.id, p.name, p.cat,
            JSON.stringify(p.oids),
            p.sysDescr ?? null,
            JSON.stringify(p.fields),
            p.conf
          );
        }
      });
      t();
    }
  }
}

function seedBuiltinSysObjLookup(db: Database.Database): void {
  const count = (db.prepare("SELECT COUNT(*) as c FROM sysobj_lookup").get() as { c: number }).c;

  const ins = db.prepare(`INSERT OR IGNORE INTO sysobj_lookup
    (oid, vendor, product, category, enterprise_id, builtin)
    VALUES (?, ?, ?, ?, ?, 1)`);

  // Import hardcoded lookup table
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { LOOKUP_TABLE } = require("@/lib/scanner/snmp-sysobj-lookup");
  const entries: Array<{ oid: string; match: { vendor: string; product: string; category: string; enterpriseId: number } }> = LOOKUP_TABLE;

  if (count === 0) {
    const t = db.transaction(() => {
      for (const e of entries) {
        ins.run(e.oid, e.match.vendor, e.match.product, e.match.category, e.match.enterpriseId);
      }
    });
    t();
  } else {
    // Inserisci solo entry builtin che non esistono ancora nel DB (per OID)
    const existingOids = new Set(
      (db.prepare("SELECT oid FROM sysobj_lookup").all() as Array<{ oid: string }>)
        .map((r) => r.oid)
    );
    const missing = entries.filter((e) => !existingOids.has(e.oid));
    if (missing.length > 0) {
      const t = db.transaction(() => {
        for (const e of missing) {
          ins.run(e.oid, e.match.vendor, e.match.product, e.match.category, e.match.enterpriseId);
        }
      });
      t();
    }
  }
}

/** Seed all hub defaults (profiles, rules, sysobj). Does NOT seed users. */
export function seedHubDefaults(db: Database.Database): void {
  seedBuiltinSnmpVendorProfiles(db);
  seedBuiltinFingerprintRules(db);
  seedBuiltinSysObjLookup(db);
}

// ========================
// Hub DB connection
// ========================

function initializeHubDb(db: Database.Database): void {
  db.exec(HUB_SCHEMA_SQL);
  db.exec(HUB_INDEXES_SQL);
  // Migrazione: aggiunge colonna email a users se mancante
  try {
    const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "email")) {
      db.exec("ALTER TABLE users ADD COLUMN email TEXT");
    }
  } catch { /* ignore */ }
  seedHubDefaults(db);
}

export function getHubDb(): Database.Database {
  if (_hubDb) return _hubDb;

  const dbDir = path.dirname(HUB_DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  _hubDb = new Database(HUB_DB_PATH);
  _hubDb.pragma("journal_mode = WAL");
  _hubDb.pragma("foreign_keys = ON");
  _hubDb.pragma("synchronous = NORMAL");
  _hubDb.pragma("cache_size = -64000");
  _hubDb.pragma("temp_store = MEMORY");
  _hubDb.pragma("mmap_size = 268435456");

  initializeHubDb(_hubDb);

  return _hubDb;
}

export function closeHubDb(): void {
  if (_hubDb) {
    try {
      _hubDb.close();
    } catch {
      /* ignore */
    }
    _hubDb = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface Tenant {
  id: number;
  codice_cliente: string;
  ragione_sociale: string;
  indirizzo: string | null;
  citta: string | null;
  provincia: string | null;
  cap: string | null;
  telefono: string | null;
  email: string | null;
  piva: string | null;
  cf: string | null;
  referente: string | null;
  note: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface HubUser {
  id: number;
  username: string;
  password_hash: string;
  email: string | null;
  role: "superadmin" | "admin" | "viewer";
  tenant_id: number | null;
  created_at: string;
  last_login: string | null;
}

export interface FingerprintClassificationMapRow {
  id: number;
  match_kind: "exact" | "contains";
  pattern: string;
  classification: string;
  priority: number;
  enabled: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeviceFingerprintRuleRow {
  id: number;
  name: string;
  device_label: string;
  classification: string;
  priority: number;
  enabled: number;
  tcp_ports_key: string | null;
  tcp_ports_optional: string | null;
  min_key_ports: number | null;
  oid_prefix: string | null;
  sysdescr_pattern: string | null;
  hostname_pattern: string | null;
  mac_vendor_pattern: string | null;
  banner_pattern: string | null;
  ttl_min: number | null;
  ttl_max: number | null;
  note: string | null;
  builtin: number;
  created_at: string;
  updated_at: string;
}

export interface NmapProfileRow {
  id: number;
  name: string;
  description: string;
  args: string;
  snmp_community: string | null;
  custom_ports: string | null;
  /** Elenco porte TCP esplicito (sovrascrive default se presente) */
  tcp_ports: string | null;
  /** Elenco porte UDP esplicito (sovrascrive default se presente) */
  udp_ports: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface SnmpVendorProfileRow {
  id: number;
  profile_id: string;
  name: string;
  category: string;
  enterprise_oid_prefixes: string;
  sysdescr_pattern: string | null;
  fields: string;
  confidence: number;
  enabled: number;
  builtin: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface SysObjLookupRow {
  id: number;
  oid: string;
  vendor: string;
  product: string;
  category: string;
  enterprise_id: number;
  builtin: number;
  enabled: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tenant CRUD
// ═══════════════════════════════════════════════════════════════════════════

export function getTenants(): Tenant[] {
  return getHubDb().prepare("SELECT * FROM tenants ORDER BY ragione_sociale").all() as Tenant[];
}

export function getActiveTenants(): Tenant[] {
  return getHubDb().prepare("SELECT * FROM tenants WHERE active = 1 ORDER BY ragione_sociale").all() as Tenant[];
}

export function getTenantById(id: number): Tenant | undefined {
  return getHubDb().prepare("SELECT * FROM tenants WHERE id = ?").get(id) as Tenant | undefined;
}

export function getTenantByCode(code: string): Tenant | undefined {
  return getHubDb().prepare("SELECT * FROM tenants WHERE codice_cliente = ?").get(code) as Tenant | undefined;
}

export function createTenant(input: Omit<Tenant, "id" | "created_at" | "updated_at">): Tenant {
  const cols: string[] = [];
  const placeholders: string[] = [];
  const vals: unknown[] = [];

  const addField = (col: string, val: unknown) => {
    cols.push(col);
    placeholders.push("?");
    vals.push(val);
  };

  addField("codice_cliente", input.codice_cliente);
  addField("ragione_sociale", input.ragione_sociale);
  if (input.indirizzo !== undefined) addField("indirizzo", input.indirizzo);
  if (input.citta !== undefined) addField("citta", input.citta);
  if (input.provincia !== undefined) addField("provincia", input.provincia);
  if (input.cap !== undefined) addField("cap", input.cap);
  if (input.telefono !== undefined) addField("telefono", input.telefono);
  if (input.email !== undefined) addField("email", input.email);
  if (input.piva !== undefined) addField("piva", input.piva);
  if (input.cf !== undefined) addField("cf", input.cf);
  if (input.referente !== undefined) addField("referente", input.referente);
  if (input.note !== undefined) addField("note", input.note);
  addField("active", input.active);

  const result = getHubDb().prepare(
    `INSERT INTO tenants (${cols.join(", ")}) VALUES (${placeholders.join(", ")})`
  ).run(...vals);
  return getHubDb().prepare("SELECT * FROM tenants WHERE id = ?").get(result.lastInsertRowid) as Tenant;
}

export function updateTenant(id: number, input: Partial<Omit<Tenant, "id" | "created_at" | "updated_at">>): Tenant | undefined {
  const existing = getHubDb().prepare("SELECT id FROM tenants WHERE id = ?").get(id) as { id: number } | undefined;
  if (!existing) return undefined;

  const sets: string[] = ["updated_at = datetime('now')"];
  const vals: unknown[] = [];
  const field = (col: string, val: unknown) => { sets.push(`${col} = ?`); vals.push(val); };

  if (input.codice_cliente !== undefined) field("codice_cliente", input.codice_cliente);
  if (input.ragione_sociale !== undefined) field("ragione_sociale", input.ragione_sociale);
  if (input.indirizzo !== undefined) field("indirizzo", input.indirizzo);
  if (input.citta !== undefined) field("citta", input.citta);
  if (input.provincia !== undefined) field("provincia", input.provincia);
  if (input.cap !== undefined) field("cap", input.cap);
  if (input.telefono !== undefined) field("telefono", input.telefono);
  if (input.email !== undefined) field("email", input.email);
  if (input.piva !== undefined) field("piva", input.piva);
  if (input.cf !== undefined) field("cf", input.cf);
  if (input.referente !== undefined) field("referente", input.referente);
  if (input.note !== undefined) field("note", input.note);
  if (input.active !== undefined) field("active", input.active);

  vals.push(id);
  getHubDb().prepare(`UPDATE tenants SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return getHubDb().prepare("SELECT * FROM tenants WHERE id = ?").get(id) as Tenant | undefined;
}

export function deleteTenant(id: number): boolean {
  return getHubDb().prepare("DELETE FROM tenants WHERE id = ?").run(id).changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// Users
// ═══════════════════════════════════════════════════════════════════════════

export function getUserByUsername(username: string): HubUser | undefined {
  return getHubDb().prepare("SELECT * FROM users WHERE username = ?").get(username) as HubUser | undefined;
}

export function getUserCount(): number {
  const row = getHubDb().prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  return row.count;
}

export function createUser(
  username: string,
  passwordHash: string,
  role: "superadmin" | "admin" | "viewer" = "admin",
  tenantId?: number | null,
  email?: string | null
): HubUser {
  const stmt = getHubDb().prepare(
    "INSERT INTO users (username, password_hash, email, role, tenant_id) VALUES (?, ?, ?, ?, ?)"
  );
  const result = stmt.run(username, passwordHash, email?.trim() || null, role, tenantId ?? null);
  return getHubDb().prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid) as HubUser;
}

export function updateUserLastLogin(userId: number): void {
  getHubDb().prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(userId);
}

export function updateUserPassword(userId: number, passwordHash: string): void {
  getHubDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
}

export function getUsers(): Omit<HubUser, "password_hash">[] {
  return getHubDb().prepare("SELECT id, username, email, role, tenant_id, created_at, last_login FROM users ORDER BY username").all() as Omit<HubUser, "password_hash">[];
}

export function updateUserEmail(userId: number, email: string | null): boolean {
  return getHubDb().prepare("UPDATE users SET email = ? WHERE id = ?").run(email?.trim() || null, userId).changes > 0;
}

export function getUserById(id: number): HubUser | undefined {
  return getHubDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as HubUser | undefined;
}

export function updateUserRole(userId: number, role: "superadmin" | "admin" | "viewer"): boolean {
  return getHubDb().prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId).changes > 0;
}

export function deleteUser(userId: number): boolean {
  // Non permettere eliminazione dell'ultimo admin
  const admins = getHubDb().prepare("SELECT COUNT(*) as c FROM users WHERE role IN ('admin', 'superadmin')").get() as { c: number };
  const user = getHubDb().prepare("SELECT role FROM users WHERE id = ?").get(userId) as { role: string } | undefined;
  if ((user?.role === "admin" || user?.role === "superadmin") && admins.c <= 1) {
    throw new Error("Impossibile eliminare l'ultimo amministratore");
  }
  return getHubDb().prepare("DELETE FROM users WHERE id = ?").run(userId).changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// User-Tenant Access
// ═══════════════════════════════════════════════════════════════════════════

export function getUserTenantAccess(userId: number): Array<{ tenant_id: number; codice_cliente: string; ragione_sociale: string; role: string }> {
  return getHubDb().prepare(
    `SELECT uta.tenant_id, t.codice_cliente, t.ragione_sociale, uta.role
     FROM user_tenant_access uta
     JOIN tenants t ON t.id = uta.tenant_id
     WHERE uta.user_id = ?
     ORDER BY t.ragione_sociale`
  ).all(userId) as Array<{ tenant_id: number; codice_cliente: string; ragione_sociale: string; role: string }>;
}

export function setUserTenantAccess(userId: number, tenantId: number, role: string): void {
  getHubDb().prepare(
    `INSERT INTO user_tenant_access (user_id, tenant_id, role)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, tenant_id) DO UPDATE SET role = excluded.role`
  ).run(userId, tenantId, role);
}

export function removeUserTenantAccess(userId: number, tenantId: number): void {
  getHubDb().prepare("DELETE FROM user_tenant_access WHERE user_id = ? AND tenant_id = ?").run(userId, tenantId);
}

export function getUsersForTenant(tenantId: number): Array<{ user_id: number; username: string; role: string }> {
  return getHubDb().prepare(
    `SELECT uta.user_id, u.username, uta.role
     FROM user_tenant_access uta
     JOIN users u ON u.id = uta.user_id
     WHERE uta.tenant_id = ?
     ORDER BY u.username`
  ).all(tenantId) as Array<{ user_id: number; username: string; role: string }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Settings
// ═══════════════════════════════════════════════════════════════════════════

export function getSetting(key: string): string | null {
  const row = getHubDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/** Configurazione guidata iniziale completata (impostazione `onboarding_completed`). */
export function isOnboardingCompleted(): boolean {
  return getSetting("onboarding_completed") === "1";
}

export function getAllSettings(): Record<string, string> {
  const rows = getHubDb().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

export function setSetting(key: string, value: string): void {
  getHubDb().prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
  ).run(key, value);
}

// ═══════════════════════════════════════════════════════════════════════════
// Nmap Profiles
// ═══════════════════════════════════════════════════════════════════════════

export function getNmapProfiles(): NmapProfileRow[] {
  return getHubDb().prepare("SELECT * FROM nmap_profiles ORDER BY is_default DESC, name ASC").all() as NmapProfileRow[];
}

export function getNmapProfileById(id: number): NmapProfileRow | undefined {
  return getHubDb().prepare("SELECT * FROM nmap_profiles WHERE id = ?").get(id) as NmapProfileRow | undefined;
}

/**
 * Profilo usato da scansioni Nmap (trigger, job) quando non si passa `nmap_profile_id`.
 * Deve essere il profilo **predefinito** (`is_default = 1`), come quello modificabile in Impostazioni
 * — non l'ultimo aggiornato per qualsiasi profilo (evita porte/argomenti da un altro profilo).
 */
export function getActiveNmapProfile(): NmapProfileRow | undefined {
  const byDefault = getHubDb()
    .prepare("SELECT * FROM nmap_profiles WHERE is_default = 1 ORDER BY id ASC LIMIT 1")
    .get() as NmapProfileRow | undefined;
  if (byDefault) return byDefault;
  return getHubDb().prepare("SELECT * FROM nmap_profiles ORDER BY updated_at DESC LIMIT 1").get() as NmapProfileRow | undefined;
}

export function createNmapProfile(
  name: string,
  description: string,
  args: string,
  snmpCommunity?: string | null,
  customPorts?: string | null,
  tcpPorts?: string | null,
  udpPorts?: string | null
): NmapProfileRow {
  const count = (getHubDb().prepare("SELECT COUNT(*) as c FROM nmap_profiles").get() as { c: number }).c;
  if (count > 0) {
    throw new Error("È consentito un solo profilo Nmap: modifica quello esistente dalle Impostazioni.");
  }
  const result = getHubDb().prepare(
    "INSERT INTO nmap_profiles (name, description, args, snmp_community, custom_ports, tcp_ports, udp_ports, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
  ).run(name, description, args, snmpCommunity || null, customPorts ?? null, tcpPorts ?? null, udpPorts ?? null);
  return getHubDb().prepare("SELECT * FROM nmap_profiles WHERE id = ?").get(result.lastInsertRowid) as NmapProfileRow;
}

export function updateNmapProfile(
  id: number,
  name: string,
  description: string,
  args: string,
  snmpCommunity?: string | null,
  customPorts?: string | null,
  tcpPorts?: string | null,
  udpPorts?: string | null
): NmapProfileRow | undefined {
  getHubDb().prepare(
    "UPDATE nmap_profiles SET name = ?, description = ?, args = ?, snmp_community = ?, custom_ports = ?, tcp_ports = ?, udp_ports = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(name, description, args, snmpCommunity ?? null, customPorts ?? null, tcpPorts ?? null, udpPorts ?? null, id);
  return getNmapProfileById(id);
}

export function deleteNmapProfile(id: number): boolean {
  return getHubDb().prepare("DELETE FROM nmap_profiles WHERE id = ? AND is_default = 0").run(id).changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// Fingerprint Classification Map
// ═══════════════════════════════════════════════════════════════════════════

export function getAllFingerprintClassificationMapRows(): FingerprintClassificationMapRow[] {
  try {
    return getHubDb()
      .prepare(`SELECT * FROM fingerprint_classification_map ORDER BY priority ASC, id ASC`)
      .all() as FingerprintClassificationMapRow[];
  } catch {
    return [];
  }
}

/** Regole attive per discovery/refresh (priorità crescente). */
export function getFingerprintClassificationRulesForResolve(): FingerprintUserRule[] {
  try {
    const rows = getHubDb()
      .prepare(
        `SELECT match_kind, pattern, classification, priority FROM fingerprint_classification_map WHERE enabled = 1 ORDER BY priority ASC, id ASC`
      )
      .all() as { match_kind: string; pattern: string; classification: string; priority: number }[];
    return rows.map((r) => ({
      match_kind: r.match_kind as "exact" | "contains",
      pattern: r.pattern,
      classification: r.classification,
      priority: r.priority,
      enabled: true,
    }));
  } catch {
    return [];
  }
}

export function createFingerprintClassificationMapRow(input: {
  match_kind: "exact" | "contains";
  pattern: string;
  classification: string;
  priority: number;
  enabled: boolean;
  note?: string | null;
}): FingerprintClassificationMapRow {
  const result = getHubDb()
    .prepare(
      `INSERT INTO fingerprint_classification_map (match_kind, pattern, classification, priority, enabled, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(
      input.match_kind,
      input.pattern.trim(),
      input.classification.trim(),
      input.priority,
      input.enabled ? 1 : 0,
      input.note?.trim() || null
    );
  const id = Number(result.lastInsertRowid);
  const row = getHubDb().prepare("SELECT * FROM fingerprint_classification_map WHERE id = ?").get(id) as FingerprintClassificationMapRow | undefined;
  if (!row) throw new Error("Inserimento regola fallito");
  return row;
}

export function updateFingerprintClassificationMapRow(
  id: number,
  input: {
    match_kind?: "exact" | "contains";
    pattern?: string;
    classification?: string;
    priority?: number;
    enabled?: boolean;
    note?: string | null;
  }
): FingerprintClassificationMapRow | undefined {
  const existing = getHubDb().prepare("SELECT id FROM fingerprint_classification_map WHERE id = ?").get(id) as { id: number } | undefined;
  if (!existing) return undefined;
  const sets: string[] = ["updated_at = datetime('now')"];
  const vals: unknown[] = [];
  if (input.match_kind !== undefined) {
    sets.push("match_kind = ?");
    vals.push(input.match_kind);
  }
  if (input.pattern !== undefined) {
    sets.push("pattern = ?");
    vals.push(input.pattern.trim());
  }
  if (input.classification !== undefined) {
    sets.push("classification = ?");
    vals.push(input.classification.trim());
  }
  if (input.priority !== undefined) {
    sets.push("priority = ?");
    vals.push(input.priority);
  }
  if (input.enabled !== undefined) {
    sets.push("enabled = ?");
    vals.push(input.enabled ? 1 : 0);
  }
  if (input.note !== undefined) {
    sets.push("note = ?");
    vals.push(input.note?.trim() || null);
  }
  vals.push(id);
  getHubDb().prepare(`UPDATE fingerprint_classification_map SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return getHubDb().prepare("SELECT * FROM fingerprint_classification_map WHERE id = ?").get(id) as FingerprintClassificationMapRow | undefined;
}

export function deleteFingerprintClassificationMapRow(id: number): boolean {
  return getHubDb().prepare("DELETE FROM fingerprint_classification_map WHERE id = ?").run(id).changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// Device Fingerprint Rules
// ═══════════════════════════════════════════════════════════════════════════

export function getDeviceFingerprintRules(): DeviceFingerprintRuleRow[] {
  return getHubDb()
    .prepare("SELECT * FROM device_fingerprint_rules ORDER BY priority ASC, id ASC")
    .all() as DeviceFingerprintRuleRow[];
}

export function getEnabledDeviceFingerprintRules(): DeviceFingerprintRuleRow[] {
  return getHubDb()
    .prepare("SELECT * FROM device_fingerprint_rules WHERE enabled = 1 ORDER BY priority ASC, id ASC")
    .all() as DeviceFingerprintRuleRow[];
}

export function createDeviceFingerprintRule(input: {
  name: string; device_label: string; classification: string; priority?: number;
  tcp_ports_key?: string | null; tcp_ports_optional?: string | null; min_key_ports?: number | null;
  oid_prefix?: string | null; sysdescr_pattern?: string | null; hostname_pattern?: string | null;
  mac_vendor_pattern?: string | null; banner_pattern?: string | null;
  ttl_min?: number | null; ttl_max?: number | null; note?: string | null; enabled?: boolean;
}): DeviceFingerprintRuleRow {
  const result = getHubDb().prepare(
    `INSERT INTO device_fingerprint_rules
     (name, device_label, classification, priority, enabled, tcp_ports_key, tcp_ports_optional, min_key_ports,
      oid_prefix, sysdescr_pattern, hostname_pattern, mac_vendor_pattern, banner_pattern, ttl_min, ttl_max, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.name.trim(), input.device_label.trim(), input.classification.trim(),
    input.priority ?? 100, input.enabled !== false ? 1 : 0,
    input.tcp_ports_key ?? null, input.tcp_ports_optional ?? null, input.min_key_ports ?? null,
    input.oid_prefix?.trim() || null, input.sysdescr_pattern?.trim() || null,
    input.hostname_pattern?.trim() || null, input.mac_vendor_pattern?.trim() || null,
    input.banner_pattern?.trim() || null, input.ttl_min ?? null, input.ttl_max ?? null,
    input.note?.trim() || null,
  );
  return getHubDb().prepare("SELECT * FROM device_fingerprint_rules WHERE id = ?").get(result.lastInsertRowid) as DeviceFingerprintRuleRow;
}

export function updateDeviceFingerprintRule(id: number, input: Partial<{
  name: string; device_label: string; classification: string; priority: number; enabled: boolean;
  tcp_ports_key: string | null; tcp_ports_optional: string | null; min_key_ports: number | null;
  oid_prefix: string | null; sysdescr_pattern: string | null; hostname_pattern: string | null;
  mac_vendor_pattern: string | null; banner_pattern: string | null;
  ttl_min: number | null; ttl_max: number | null; note: string | null;
}>): DeviceFingerprintRuleRow | undefined {
  const existing = getHubDb().prepare("SELECT id FROM device_fingerprint_rules WHERE id = ?").get(id) as { id: number } | undefined;
  if (!existing) return undefined;
  const sets: string[] = ["updated_at = datetime('now')"];
  const vals: unknown[] = [];
  const field = (col: string, val: unknown) => { sets.push(`${col} = ?`); vals.push(val); };
  if (input.name !== undefined) field("name", input.name.trim());
  if (input.device_label !== undefined) field("device_label", input.device_label.trim());
  if (input.classification !== undefined) field("classification", input.classification.trim());
  if (input.priority !== undefined) field("priority", input.priority);
  if (input.enabled !== undefined) field("enabled", input.enabled ? 1 : 0);
  if (input.tcp_ports_key !== undefined) field("tcp_ports_key", input.tcp_ports_key);
  if (input.tcp_ports_optional !== undefined) field("tcp_ports_optional", input.tcp_ports_optional);
  if (input.min_key_ports !== undefined) field("min_key_ports", input.min_key_ports);
  if (input.oid_prefix !== undefined) field("oid_prefix", input.oid_prefix?.trim() || null);
  if (input.sysdescr_pattern !== undefined) field("sysdescr_pattern", input.sysdescr_pattern?.trim() || null);
  if (input.hostname_pattern !== undefined) field("hostname_pattern", input.hostname_pattern?.trim() || null);
  if (input.mac_vendor_pattern !== undefined) field("mac_vendor_pattern", input.mac_vendor_pattern?.trim() || null);
  if (input.banner_pattern !== undefined) field("banner_pattern", input.banner_pattern?.trim() || null);
  if (input.ttl_min !== undefined) field("ttl_min", input.ttl_min);
  if (input.ttl_max !== undefined) field("ttl_max", input.ttl_max);
  if (input.note !== undefined) field("note", input.note?.trim() || null);
  vals.push(id);
  getHubDb().prepare(`UPDATE device_fingerprint_rules SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return getHubDb().prepare("SELECT * FROM device_fingerprint_rules WHERE id = ?").get(id) as DeviceFingerprintRuleRow | undefined;
}

export function deleteDeviceFingerprintRule(id: number): boolean {
  return getHubDb().prepare("DELETE FROM device_fingerprint_rules WHERE id = ?").run(id).changes > 0;
}

export function resetBuiltinFingerprintRules(): void {
  getHubDb().prepare("DELETE FROM device_fingerprint_rules WHERE builtin = 1").run();
  seedBuiltinFingerprintRules(getHubDb());
}

// ═══════════════════════════════════════════════════════════════════════════
// SNMP Vendor Profiles
// ═══════════════════════════════════════════════════════════════════════════

export function getSnmpVendorProfiles(): SnmpVendorProfileRow[] {
  return getHubDb().prepare("SELECT * FROM snmp_vendor_profiles ORDER BY category, name").all() as SnmpVendorProfileRow[];
}

export function getEnabledSnmpVendorProfiles(): SnmpVendorProfileRow[] {
  return getHubDb().prepare("SELECT * FROM snmp_vendor_profiles WHERE enabled = 1 ORDER BY confidence DESC, name").all() as SnmpVendorProfileRow[];
}

export function getSnmpVendorProfileById(id: number): SnmpVendorProfileRow | undefined {
  return getHubDb().prepare("SELECT * FROM snmp_vendor_profiles WHERE id = ?").get(id) as SnmpVendorProfileRow | undefined;
}

export function getSnmpVendorProfileByProfileId(profileId: string): SnmpVendorProfileRow | undefined {
  return getHubDb().prepare("SELECT * FROM snmp_vendor_profiles WHERE profile_id = ?").get(profileId) as SnmpVendorProfileRow | undefined;
}

export function createSnmpVendorProfile(input: {
  profile_id: string;
  name: string;
  category: string;
  enterprise_oid_prefixes?: string[];
  sysdescr_pattern?: string | null;
  fields?: Record<string, string | string[]>;
  confidence?: number;
  enabled?: number;
  builtin?: number;
  note?: string | null;
}): SnmpVendorProfileRow {
  const stmt = getHubDb().prepare(`INSERT INTO snmp_vendor_profiles
    (profile_id, name, category, enterprise_oid_prefixes, sysdescr_pattern, fields, confidence, enabled, builtin, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const r = stmt.run(
    input.profile_id,
    input.name,
    input.category,
    JSON.stringify(input.enterprise_oid_prefixes ?? []),
    input.sysdescr_pattern ?? null,
    JSON.stringify(input.fields ?? {}),
    input.confidence ?? 0.90,
    input.enabled ?? 1,
    input.builtin ?? 0,
    input.note ?? null
  );
  return getSnmpVendorProfileById(Number(r.lastInsertRowid))!;
}

export function updateSnmpVendorProfile(id: number, input: Partial<{
  profile_id: string;
  name: string;
  category: string;
  enterprise_oid_prefixes: string[];
  sysdescr_pattern: string | null;
  fields: Record<string, string | string[]>;
  confidence: number;
  enabled: number;
  note: string | null;
}>): SnmpVendorProfileRow | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.profile_id !== undefined) { fields.push("profile_id = ?"); values.push(input.profile_id); }
  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.category !== undefined) { fields.push("category = ?"); values.push(input.category); }
  if (input.enterprise_oid_prefixes !== undefined) { fields.push("enterprise_oid_prefixes = ?"); values.push(JSON.stringify(input.enterprise_oid_prefixes)); }
  if (input.sysdescr_pattern !== undefined) { fields.push("sysdescr_pattern = ?"); values.push(input.sysdescr_pattern); }
  if (input.fields !== undefined) { fields.push("fields = ?"); values.push(JSON.stringify(input.fields)); }
  if (input.confidence !== undefined) { fields.push("confidence = ?"); values.push(input.confidence); }
  if (input.enabled !== undefined) { fields.push("enabled = ?"); values.push(input.enabled); }
  if (input.note !== undefined) { fields.push("note = ?"); values.push(input.note); }

  if (fields.length === 0) return getSnmpVendorProfileById(id);
  fields.push("updated_at = datetime('now')");
  values.push(id);

  getHubDb().prepare(`UPDATE snmp_vendor_profiles SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getSnmpVendorProfileById(id);
}

export function deleteSnmpVendorProfile(id: number): boolean {
  const r = getHubDb().prepare("DELETE FROM snmp_vendor_profiles WHERE id = ?").run(id);
  return r.changes > 0;
}

export function resetBuiltinSnmpVendorProfiles(): void {
  getHubDb().prepare("DELETE FROM snmp_vendor_profiles WHERE builtin = 1").run();
  seedBuiltinSnmpVendorProfiles(getHubDb());
}

export function exportSnmpVendorProfiles(): SnmpVendorProfileRow[] {
  return getHubDb().prepare("SELECT * FROM snmp_vendor_profiles ORDER BY category, name").all() as SnmpVendorProfileRow[];
}

export function importSnmpVendorProfiles(profiles: Array<{
  profile_id: string;
  name: string;
  category: string;
  enterprise_oid_prefixes: string[] | string;
  sysdescr_pattern?: string | null;
  fields: Record<string, string | string[]> | string;
  confidence?: number;
  enabled?: number;
  note?: string | null;
}>, replaceExisting: boolean = false): { imported: number; skipped: number; errors: string[] } {
  const result = { imported: 0, skipped: 0, errors: [] as string[] };

  for (const p of profiles) {
    try {
      const existing = getSnmpVendorProfileByProfileId(p.profile_id);
      if (existing) {
        if (replaceExisting && !existing.builtin) {
          updateSnmpVendorProfile(existing.id, {
            name: p.name,
            category: p.category,
            enterprise_oid_prefixes: Array.isArray(p.enterprise_oid_prefixes) ? p.enterprise_oid_prefixes : JSON.parse(p.enterprise_oid_prefixes),
            sysdescr_pattern: p.sysdescr_pattern ?? null,
            fields: typeof p.fields === "string" ? JSON.parse(p.fields) : p.fields,
            confidence: p.confidence ?? 0.90,
            enabled: p.enabled ?? 1,
            note: p.note ?? null,
          });
          result.imported++;
        } else {
          result.skipped++;
        }
      } else {
        createSnmpVendorProfile({
          profile_id: p.profile_id,
          name: p.name,
          category: p.category,
          enterprise_oid_prefixes: Array.isArray(p.enterprise_oid_prefixes) ? p.enterprise_oid_prefixes : JSON.parse(p.enterprise_oid_prefixes),
          sysdescr_pattern: p.sysdescr_pattern ?? null,
          fields: typeof p.fields === "string" ? JSON.parse(p.fields) : p.fields,
          confidence: p.confidence ?? 0.90,
          enabled: p.enabled ?? 1,
          builtin: 0,
          note: p.note ?? null,
        });
        result.imported++;
      }
    } catch (err) {
      result.errors.push(`${p.profile_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// SysObj Lookup
// ═══════════════════════════════════════════════════════════════════════════

export function getSysObjLookupEntries(): SysObjLookupRow[] {
  return getHubDb()
    .prepare("SELECT * FROM sysobj_lookup ORDER BY LENGTH(oid) DESC")
    .all() as SysObjLookupRow[];
}

export function createSysObjLookupEntry(input: {
  oid: string; vendor: string; product: string; category: string;
  enterprise_id: number; enabled?: number; note?: string | null;
}): SysObjLookupRow {
  const result = getHubDb().prepare(
    `INSERT INTO sysobj_lookup (oid, vendor, product, category, enterprise_id, builtin, enabled, note)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    input.oid.trim(), input.vendor.trim(), input.product.trim(), input.category.trim(),
    input.enterprise_id, input.enabled ?? 1, input.note?.trim() || null,
  );
  return getHubDb().prepare("SELECT * FROM sysobj_lookup WHERE id = ?").get(result.lastInsertRowid) as SysObjLookupRow;
}

export function updateSysObjLookupEntry(id: number, input: Partial<{
  oid: string; vendor: string; product: string; category: string;
  enterprise_id: number; enabled: number; note: string | null;
}>): SysObjLookupRow | undefined {
  const existing = getHubDb().prepare("SELECT id FROM sysobj_lookup WHERE id = ?").get(id) as { id: number } | undefined;
  if (!existing) return undefined;
  const sets: string[] = ["updated_at = datetime('now')"];
  const vals: unknown[] = [];
  const field = (col: string, val: unknown) => { sets.push(`${col} = ?`); vals.push(val); };
  if (input.oid !== undefined) field("oid", input.oid.trim());
  if (input.vendor !== undefined) field("vendor", input.vendor.trim());
  if (input.product !== undefined) field("product", input.product.trim());
  if (input.category !== undefined) field("category", input.category.trim());
  if (input.enterprise_id !== undefined) field("enterprise_id", input.enterprise_id);
  if (input.enabled !== undefined) field("enabled", input.enabled);
  if (input.note !== undefined) field("note", input.note?.trim() || null);
  vals.push(id);
  getHubDb().prepare(`UPDATE sysobj_lookup SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return getHubDb().prepare("SELECT * FROM sysobj_lookup WHERE id = ?").get(id) as SysObjLookupRow | undefined;
}

export function deleteSysObjLookupEntry(id: number): boolean {
  return getHubDb().prepare("DELETE FROM sysobj_lookup WHERE id = ?").run(id).changes > 0;
}

export function resetBuiltinSysObjLookup(): void {
  getHubDb().prepare("DELETE FROM sysobj_lookup WHERE builtin = 1").run();
  seedBuiltinSysObjLookup(getHubDb());
}
