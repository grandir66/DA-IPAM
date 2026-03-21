/**
 * Classificazione automatica dei dispositivi di rete da dati SSH/SNMP e scansioni.
 * Usa sysDescr, sysObjectID, os_info, porte aperte, hostname e MAC vendor.
 */

import { DEVICE_CLASSIFICATIONS } from "./device-classifications";

export type DeviceClassification = (typeof DEVICE_CLASSIFICATIONS)[number];

export type ClassifierInput = {
  /** sysDescr SNMP (1.3.6.1.2.1.1.1.0) */
  sysDescr?: string | null;
  /** sysObjectID SNMP (1.3.6.1.2.1.1.2.0) — es. "1.3.6.1.4.1.9.1.1234" */
  sysObjectID?: string | null;
  /** Nmap OS detection o sysDescr usato come os_info */
  osInfo?: string | null;
  /** Porte aperte: [{port, protocol, service, version}] */
  openPorts?: Array<{ port: number; protocol?: string; service?: string | null; version?: string | null }> | null;
  /** Hostname (DNS reverse, SNMP sysName, DHCP) */
  hostname?: string | null;
  /** MAC vendor da OUI lookup */
  vendor?: string | null;
  /**
   * Testo aggiuntivo da walk SNMP (MikroTik identity, UniFi enterprise MIB, ifDescr, HOST-RESOURCES).
   * Viene unito al corpus testuale per TEXT_RULES (RouterOS, UniFi, ecc.).
   */
  snmpContext?: string | null;
};

/** Come è stata determinata la classificazione (per log / debug). */
export type DetectionMethod = "oid" | "virtual_mac" | "text" | "port" | "hostname" | "vendor" | "none";

export interface DeviceDetectionResult {
  classification: DeviceClassification | undefined;
  /** Affidabilità stimata della singola regola applicata */
  confidence: "high" | "medium" | "low";
  method: DetectionMethod;
}

/** Confronto OID per segmenti (evita che "…9.1.516" matchi il prefisso "…9.1.5"). */
function oidPrefixMatches(oid: string, prefix: string): boolean {
  const o = oid.replace(/^\.+/, "").split(".").filter(Boolean);
  const p = prefix.replace(/^\.+/, "").split(".").filter(Boolean);
  if (p.length > o.length) return false;
  for (let i = 0; i < p.length; i++) {
    if (o[i] !== p[i]) return false;
  }
  return true;
}

function buildClassifierText(input: ClassifierInput): string {
  return [
    input.sysDescr ?? "",
    input.osInfo ?? "",
    input.hostname ?? "",
    input.snmpContext ?? "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Regole per sysDescr / osInfo / hostname (test case-insensitive) */
const TEXT_RULES: Array<{ pattern: RegExp; classification: DeviceClassification }> = [
  // Router
  { pattern: /router|ios\s|vyos|mikrotik|edge.?router|quagga|bird|frr|junos|arista/i, classification: "router" },
  // Switch — \b su "switch" riduce falsi positivi (es. testi lunghi con parole casuali che contengono "switch")
  {
    pattern:
      /\b(?:ethernet\s+)?switch\b|\bswitching\b|procurve|nexus|\bcatalyst\b|comware|netgear.{0,48}\bswitch\b|d-link.{0,48}\bswitch\b/i,
    classification: "switch",
  },
  // Firewall
  { pattern: /firewall|fortigate|pfsense|opnsense|sophos|palo\s*alto|check\s*point/i, classification: "firewall" },
  // Access point
  { pattern: /access.?point|ap-|unifi|ubiquiti|wifi|wireless|aruba|ruckus|meraki.*ap|cisco.*ap/i, classification: "access_point" },
  // Hypervisor
  { pattern: /esxi|vmware\s*esx|hyper-v|hyperv|proxmox|qemu|kvm|virtualbox|ovirt|xen\s*server/i, classification: "hypervisor" },
  // VM / container
  { pattern: /vmware\s*tools|vmtools|vmware\s*guest|virtual\s*machine|docker|containerd|podman|kvm\s*guest|qemu\s*guest/i, classification: "vm" },
  // Server Windows
  { pattern: /windows\s*server|microsoft.*server|win\s*srv|win\s*server/i, classification: "server_windows" },
  // Server Linux
  { pattern: /linux\s*server|debian|ubuntu\s*server|centos|rhel|sles|red\s*hat\s*enterprise|alma\s*linux|rocky\s*linux|oracle\s*linux|fedora\s*server/i, classification: "server_linux" },
  // Server generico (fallback)
  { pattern: /server/i, classification: "server" },
  // NAS / Storage (Synology e QNAP unificati sotto storage; il profilo vendor gestisce i comandi)
  { pattern: /nas|synology|qnap|netapp|truenas|free nas|storage|drobo/i, classification: "storage" },
  // PC HP (prima delle stampanti: ProDesk, EliteBook, ProBook, ZBook, Pavilion, Omen, Envy, Compaq)
  { pattern: /prodesk|elitebook|probook|zbook|pavilion|omen|envy|compaq|hp\s*elite|hp\s*pro\s*\d|hp\s*z\s*workstation/i, classification: "workstation" },
  // Stampanti (laserjet, deskjet, ecc.; HP senza modello PC → OID/porte distinguono)
  { pattern: /printer|print\s*server|laserjet|deskjet|officejet|epson|canon\s*print|brother\s*print|hp\s*lj|lexmark|ricoh\s*print|konica|sharp\s*print|samsung\s*print|xerox/i, classification: "stampante" },
  { pattern: /multifunction|mfp|all-in-one\s*print|multifunzione/i, classification: "multifunzione" },
  { pattern: /scanner\s*network|scan\s*server/i, classification: "scanner" },
  { pattern: /copier|fotocopiatrice|photocopier/i, classification: "fotocopiatrice" },
  // Telecamere
  { pattern: /camera|ipcam|hikvision|dahua|axis|vivotek|foscam|reolink|annke|uniview|dahua|onvif/i, classification: "telecamera" },
  // VoIP / telefoni
  { pattern: /phone|voip|yealink|cisco.?phone|polycom|grandstream|snom|avaya\s*ip|mitel|fanvil|sangoma/i, classification: "voip" },
  // UPS
  { pattern: /ups|apc|eaton|tripp.?lite|cyberpower|schneider\s*ups/i, classification: "ups" },
  // Load balancer / proxy
  { pattern: /load\s*balancer|f5|nginx|haproxy|citrix\s*netscaler/i, classification: "load_balancer" },
  { pattern: /vpn\s*gateway|openvpn|wireguard|ipsec/i, classification: "vpn_gateway" },
  { pattern: /proxy\s*server|squid|blue\s*coat/i, classification: "proxy" },
  // Server specializzati
  { pattern: /dhcp\s*server|isc\s*dhcp|kea/i, classification: "dhcp_server" },
  { pattern: /dns\s*server|bind|powerdns|unbound/i, classification: "dns_server" },
  { pattern: /nfs\s*server|nfsd/i, classification: "nfs_server" },
  { pattern: /mail\s*server|postfix|exim|exchange|zimbra/i, classification: "mail_server" },
  { pattern: /web\s*server|apache|nginx|iis|tomcat/i, classification: "web_server" },
  { pattern: /database|mysql|postgres|mariadb|mongodb|oracle\s*db/i, classification: "database_server" },
  { pattern: /backup\s*server|veeam|bacula|bareos/i, classification: "backup_server" },
  // Workstation / client Windows
  { pattern: /workstation|desktop|windows\s*\d|windows\s*xp|windows\s*7|windows\s*10|windows\s*11/i, classification: "workstation" },
  // Rilevamento generico Windows (dopo server_windows e workstation)
  { pattern: /microsoft\s*windows(?!\s*server)/i, classification: "workstation" },
  { pattern: /notebook|laptop|macbook|thinkpad|dell\s*xps|surface\s*pro/i, classification: "notebook" },
  // IoT / consumer
  { pattern: /smart\s*tv|roku|apple\s*tv|chromecast|fire\s*tv|android\s*tv/i, classification: "smart_tv" },
  { pattern: /playstation|xbox|nintendo|switch\s*console/i, classification: "console" },
  { pattern: /tablet|ipad|android\s*tablet|surface\s*go/i, classification: "tablet" },
  { pattern: /smartphone|iphone|android\s*phone|pixel|galaxy/i, classification: "smartphone" },
  { pattern: /media\s*player|dlna|plex|kodi/i, classification: "media_player" },
  { pattern: /decoder|set.?top|stb|iptv/i, classification: "decoder" },
  // OT / industriale
  { pattern: /plc|siemens\s*s7|allen.?bradley|modbus|opc/i, classification: "plc" },
  { pattern: /hmi|human.?machine|scada/i, classification: "hmi" },
  { pattern: /sensor|sensore|iot\s*device|zigbee|zwave/i, classification: "sensore" },
  { pattern: /controller|industrial|rete\s*ot/i, classification: "controller" },
  // Altri
  { pattern: /bridge|repeater|hub/i, classification: "bridge" },
  { pattern: /modem|cable\s*modem|dsl/i, classification: "modem" },
  { pattern: /ont|onu|gpon|epon|fiber\s*terminal/i, classification: "ont" },
];

/**
 * Prefissi OID (sysObjectID) per tipo dispositivo.
 * Ordine: più specifici prima; **Cisco generico (9.1)** solo dopo le regole Cisco/altro specifiche.
 * Matching **per segmenti OID** tramite oidPrefixMatches().
 */
const OID_RULES: Array<{ prefix: string; classification: DeviceClassification }> = [
  // HP printers
  { prefix: "1.3.6.1.4.1.11.2.3.9.1", classification: "stampante" },
  { prefix: "1.3.6.1.4.1.11.2.3.9", classification: "stampante" },
  // HP ProCurve switches
  { prefix: "1.3.6.1.4.1.11.2.3.7.11", classification: "switch" },
  { prefix: "1.3.6.1.4.1.11.2.3.7", classification: "switch" },
  // MikroTik
  { prefix: "1.3.6.1.4.1.14988.1", classification: "router" },
  // Ubiquiti (AP / airOS)
  { prefix: "1.3.6.1.4.1.10002.1", classification: "access_point" },
  // UniFi / Ubiquiti enterprise MIB (walk 1.3.6.1.4.1.41112)
  { prefix: "1.3.6.1.4.1.41112", classification: "access_point" },
  // Ubiquiti EdgeSwitch / EdgeMax (OID 4413)
  { prefix: "1.3.6.1.4.1.4413", classification: "switch" },
  // Hikvision
  { prefix: "1.3.6.1.4.1.39165", classification: "telecamera" },
  // Dahua
  { prefix: "1.3.6.1.4.1.55985", classification: "telecamera" },
  // Axis
  { prefix: "1.3.6.1.4.1.368", classification: "telecamera" },
  // Synology / QNAP
  { prefix: "1.3.6.1.4.1.6574", classification: "storage" },
  { prefix: "1.3.6.1.4.1.24681", classification: "storage" },
  // Epson printers
  { prefix: "1.3.6.1.4.1.1248", classification: "stampante" },
  // VMware
  { prefix: "1.3.6.1.4.1.6876.2", classification: "hypervisor" },
  { prefix: "1.3.6.1.4.1.6876", classification: "hypervisor" },
  // APC UPS
  { prefix: "1.3.6.1.4.1.318", classification: "ups" },
  // Eaton UPS
  { prefix: "1.3.6.1.4.1.705", classification: "ups" },
  // Yealink VoIP
  { prefix: "1.3.6.1.4.1.3990", classification: "voip" },
  // Cisco VoIP
  { prefix: "1.3.6.1.4.1.9.6.1", classification: "voip" },
  // Cisco switches (product ID specifici — match per segmenti esatti)
  { prefix: "1.3.6.1.4.1.9.1.5", classification: "switch" },
  { prefix: "1.3.6.1.4.1.9.1.1", classification: "switch" },
  // Netgear
  { prefix: "1.3.6.1.4.1.4526", classification: "switch" },
  // D-Link
  { prefix: "1.3.6.1.4.1.171.10", classification: "switch" },
  // Fortinet
  { prefix: "1.3.6.1.4.1.12356", classification: "firewall" },
  // pfSense
  { prefix: "1.3.6.1.4.1.12325", classification: "firewall" },
  // Linux net-snmp (host / VM Linux)
  { prefix: "1.3.6.1.4.1.8072.3.2", classification: "server_linux" },
  // Cisco IOS/IOS-XE generico (1.3.6.1.4.1.9.1.<productId>) — dopo regole specifiche
  { prefix: "1.3.6.1.4.1.9.1", classification: "router" },
];

/** Porte e servizi che indicano il tipo di dispositivo */
const PORT_RULES: Array<{
  ports: number[];
  services?: string[];
  classification: DeviceClassification;
}> = [
  { ports: [9100, 515, 631], services: ["ipp", "cups", "lpd", "printer"], classification: "stampante" },
  { ports: [554, 8554], services: ["rtsp", "streaming"], classification: "telecamera" },
  { ports: [5060, 5061], services: ["sip", "sip-tls"], classification: "voip" },
  { ports: [389, 636], services: ["ldap", "ldaps"], classification: "server" },
  { ports: [445, 139], services: ["microsoft-ds", "netbios-ssn"], classification: "workstation" },
  { ports: [5900, 5901], services: ["vnc", "vnc-http"], classification: "workstation" },
  { ports: [3389], services: ["ms-wbt-server", "rdp"], classification: "workstation" },
  { ports: [5000, 32400], services: ["plex", "upnp"], classification: "media_player" },
  { ports: [8443], services: ["unifi"], classification: "access_point" },
  { ports: [8291], services: ["mikrotik"], classification: "router" },
  { ports: [161], services: ["snmp"], classification: "server" }, // SNMP alone = network device, weak
];

/** Pattern hostname comuni (es. AP-01, PRINTER-02, CAM-001) */
const HOSTNAME_RULES: Array<{ pattern: RegExp; classification: DeviceClassification }> = [
  { pattern: /^ap[-_]|^wifi[-_]|^unifi[-_]|^ubnt[-_]/i, classification: "access_point" },
  { pattern: /^printer[-_]|^print[-_]|^hp[-_]lj|^epson[-_]|^canon[-_]|^brother[-_]/i, classification: "stampante" },
  { pattern: /^cam[-_]|^ipcam[-_]|^nvr[-_]|^dvr[-_]|^hik[-_]|^dahua[-_]/i, classification: "telecamera" },
  { pattern: /^phone[-_]|^voip[-_]|^yealink[-_]|^cisco[-_]phone|^sip[-_]/i, classification: "voip" },
  { pattern: /^switch[-_]|^sw[-_]|^core[-_]|^dist[-_]/i, classification: "switch" },
  { pattern: /^router[-_]|^gw[-_]|^gateway[-_]|^mikrotik[-_]|^fw[-_]/i, classification: "router" },
  { pattern: /^nas[-_]|^synology[-_]|^qnap[-_]/i, classification: "storage" },
  { pattern: /^esxi[-_]|^vm[-_]|^hyperv[-_]|^proxmox[-_]|^vcenter[-_]/i, classification: "hypervisor" },
  { pattern: /^srv[-_]|^server[-_]|^dc[-_]|^ad[-_]/i, classification: "server" },
  { pattern: /^ups[-_]|^apc[-_]|^eaton[-_]/i, classification: "ups" },
];

/** MAC vendor → classificazione (OUI lookup). HP Inc/Hewlett prima come workstation (PC) perché le stampanti HP hanno OID/porte specifici. */
const VENDOR_RULES: Array<{ pattern: RegExp; classification: DeviceClassification }> = [
  { pattern: /cisco|arista|juniper|mikrotik|ubiquiti|netgear|d-link|tp-link|hp\s*networks|hpe\s*aruba|stormshield/i, classification: "router" },
  { pattern: /hikvision|dahua|axis|vivotek|foscam|reolink|annke|uniview/i, classification: "telecamera" },
  { pattern: /yealink|polycom|grandstream|cisco\s*systems.*phone|snom|avaya|mitel|fanvil/i, classification: "voip" },
  { pattern: /apple|dell|lenovo|hp\s*inc|hewlett|asus|acer|msi|microsoft\s*surface/i, classification: "workstation" },
  { pattern: /epson|canon|brother|lexmark|ricoh|konica|sharp|samsung.*print|xerox/i, classification: "stampante" },
  { pattern: /synology|qnap|netapp|western\s*digital|seagate/i, classification: "storage" },
  { pattern: /vmware|microsoft\s*virtual|hyper-v\s*virtual|red\s*hat\s*kvm|qemu|proxmox\s*server|oracle\s*vm|xensource/i, classification: "vm" },
  { pattern: /apc|eaton|tripp.?lite|cyberpower|schneider/i, classification: "ups" },
];

/**
 * Classificazione con metodo e confidenza stimata (per audit e future UI).
 */
export function classifyDeviceDetailed(input: ClassifierInput): DeviceDetectionResult {
  const text = buildClassifierText(input);
  const oid = (input.sysObjectID ?? "").trim();
  const openPortSet = new Set((input.openPorts ?? []).map((p) => p.port));
  const sysDescrLower = (input.sysDescr ?? "").toLowerCase();

  // 1. Porta TCP 8006 → Proxmox VE (pveproxy). Viene prima degli OID hardcoded perché Proxmox usa
  //    net-snmp (OID 8072 = generico Linux) che altrimenti restituirebbe server_linux.
  //    Nota: le regole OID del DB (snmpFingerprintOidMatches) vengono applicate in discovery.ts
  //    PRIMA di chiamare classifyDevice, quindi qui gestiamo solo il fallback senza match DB.
  if (openPortSet.has(8006)) {
    return { classification: "hypervisor", confidence: "high", method: "port" };
  }

  // 2. sysObjectID hardcoded (per device con OID vendor specifico non presente nel DB fingerprint)
  if (oid) {
    // net-snmp (8072): agente generico usato da Linux, Synology, QNAP, Proxmox, switch Ubiquiti, ecc.
    // → disambiguare con corpus (vendor MAC, hostname, sysDescr) prima di restituire server_linux
    if (oidPrefixMatches(oid, "1.3.6.1.4.1.8072")) {
      const corpus = `${text} ${sysDescrLower}`;
      if (/\bproxmox\b|\bpve\b|pve-manager|qemu\/kvm|kvm\s*virtualization/i.test(corpus)) {
        return { classification: "hypervisor", confidence: "high", method: "oid" };
      }
      if (/synology|diskstation|\bdsm\b/i.test(corpus)) {
        return { classification: "storage", confidence: "high", method: "oid" };
      }
      if (/\bqnap\b|turbo\s*nas|\bqts\b/i.test(corpus)) {
        return { classification: "storage", confidence: "high", method: "oid" };
      }
      if (/asustor|adm\s*\d|asus\s*nas/i.test(corpus)) {
        return { classification: "storage", confidence: "high", method: "oid" };
      }
      // Hostname prefix di device di rete: cedere al naming convention piuttosto che a server_linux
      const hn = (input.hostname ?? "").toLowerCase();
      if (/^sw[-_]|^swi[-_]|^switch[-_]|^core[-_]|^dist[-_]|^acc[-_]|^usw[-_]|^us[-_]/.test(hn)) {
        return { classification: "switch", confidence: "high", method: "oid" };
      }
      if (/^ap[-_]|^wifi[-_]|^uap[-_]|^unifi[-_]|^ubnt[-_]|^uap[0-9]/.test(hn)) {
        return { classification: "access_point", confidence: "high", method: "oid" };
      }
      if (/^gw[-_]|^rtr[-_]|^router[-_]|^fw[-_]|^firewall[-_]/.test(hn)) {
        return { classification: "router", confidence: "high", method: "oid" };
      }
      return { classification: "server_linux", confidence: "high", method: "oid" };
    }
    for (const rule of OID_RULES) {
      if (oidPrefixMatches(oid, rule.prefix)) {
        return { classification: rule.classification, confidence: "high", method: "oid" };
      }
    }
  }

  // 2. MAC virtuale: VMware/Proxmox/Hyper-V/QEMU → VM / server
  const vendor = (input.vendor ?? "").trim();
  const isVirtualMac = /vmware|proxmox\s*server|microsoft\s*virtual|hyper-v|qemu|xensource|oracle\s*vm|red\s*hat.*kvm/i.test(vendor);
  if (isVirtualMac) {
    const ports = input.openPorts ?? [];
    const portSet = new Set(ports.map((p) => p.port));
    const has445 = portSet.has(445);
    const has135 = portSet.has(135);
    const has22 = portSet.has(22);

    if (portSet.has(8006)) return { classification: "hypervisor", confidence: "high", method: "virtual_mac" };

    if (has445 && has135) return { classification: "server_windows", confidence: "high", method: "virtual_mac" };
    if (has22 && !has445) return { classification: "server_linux", confidence: "high", method: "virtual_mac" };

    if (/windows\s*server|microsoft.*server|win\s*srv/i.test(text)) return { classification: "server_windows", confidence: "high", method: "virtual_mac" };
    if (/debian|ubuntu|centos|rhel|red\s*hat|alma|rocky|oracle\s*linux|fedora|sles|linux\s*server/i.test(text)) {
      return { classification: "server_linux", confidence: "high", method: "virtual_mac" };
    }
    if (/windows/i.test(text)) return { classification: "server_windows", confidence: "medium", method: "virtual_mac" };
    if (/linux/i.test(text)) return { classification: "server_linux", confidence: "medium", method: "virtual_mac" };

    return { classification: "vm", confidence: "medium", method: "virtual_mac" };
  }

  // 3. sysDescr / osInfo / hostname / snmpContext
  if (text) {
    for (const rule of TEXT_RULES) {
      if (rule.pattern.test(text)) {
        return { classification: rule.classification, confidence: "medium", method: "text" };
      }
    }
  }

  // 4. Hostname pattern — PRIMA delle porte: "SW-*" deve vincere su porta 161→server
  const hostname = (input.hostname ?? "").trim();
  if (hostname) {
    for (const rule of HOSTNAME_RULES) {
      if (rule.pattern.test(hostname)) {
        return { classification: rule.classification, confidence: "medium", method: "hostname" };
      }
    }
  }

  // 5. MAC vendor — anch'esso prima delle porte per device di rete identificati dal vendor
  if (vendor) {
    for (const rule of VENDOR_RULES) {
      if (rule.pattern.test(vendor)) {
        return { classification: rule.classification, confidence: "low", method: "vendor" };
      }
    }
  }

  // 6. Porte e servizi (ultima risorsa: 161/SNMP da solo è molto debole)
  const ports = input.openPorts ?? [];
  if (ports.length > 0) {
    for (const rule of PORT_RULES) {
      const portMatch = rule.ports.some((p) => ports.some((po) => po.port === p));
      const serviceMatch = !rule.services?.length || ports.some((po) =>
        rule.services!.some((s) => (po.service ?? "").toLowerCase().includes(s))
      );
      if (portMatch || serviceMatch) {
        const weakSnmpOnly = rule.ports.length === 1 && rule.ports[0] === 161 && (rule.services?.includes("snmp") ?? false);
        return {
          classification: rule.classification,
          confidence: weakSnmpOnly ? "low" : "medium",
          method: "port",
        };
      }
    }
  }

  return { classification: undefined, confidence: "low", method: "none" };
}

/**
 * Classifica un dispositivo in base ai dati disponibili.
 * Restituisce la classificazione o undefined se non determinabile.
 */
export function classifyDevice(input: ClassifierInput): DeviceClassification | undefined {
  return classifyDeviceDetailed(input).classification;
}
