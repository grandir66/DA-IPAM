/**
 * Lookup table: sysObjectID → vendor/prodotto/categoria.
 *
 * Il matching è per **prefisso più lungo**: se un device restituisce
 * `1.3.6.1.4.1.14988.1.1.8.x`, viene matchato prima con `.14988.1.1.8`,
 * poi `.14988.1.1`, poi `.14988.1`, ecc. La entry più specifica vince.
 */

export interface SysObjMatch {
  vendor: string;
  product: string;
  /** Categoria libera: valori legacy (networking, wireless, firewall, server, storage) o classificazione device */
  category: string;
  enterpriseId: number;
}

// Ordinate dal prefisso più lungo al più corto (per longest-prefix-match)
export const LOOKUP_TABLE: Array<{ oid: string; match: SysObjMatch }> = [
  // ── MikroTik (14988) ──
  { oid: "1.3.6.1.4.1.14988.1.1.22", match: { vendor: "MikroTik", product: "RouterOS — CCR2216 / CCR2004-16G", category: "networking", enterpriseId: 14988 } },
  { oid: "1.3.6.1.4.1.14988.1.1.18", match: { vendor: "MikroTik", product: "RouterOS — CCR2004 / CCR2116", category: "networking", enterpriseId: 14988 } },
  { oid: "1.3.6.1.4.1.14988.1.1.14", match: { vendor: "MikroTik", product: "RouterOS — RB4011 serie", category: "networking", enterpriseId: 14988 } },
  { oid: "1.3.6.1.4.1.14988.1.1.12", match: { vendor: "MikroTik", product: "RouterOS — CRS (Cloud Router Switch)", category: "networking", enterpriseId: 14988 } },
  { oid: "1.3.6.1.4.1.14988.1.1.8", match: { vendor: "MikroTik", product: "RouterOS — hEX / hAP serie", category: "networking", enterpriseId: 14988 } },
  { oid: "1.3.6.1.4.1.14988.1.1.4", match: { vendor: "MikroTik", product: "RouterOS — CCR serie (Cloud Core Router)", category: "networking", enterpriseId: 14988 } },
  { oid: "1.3.6.1.4.1.14988.1.1.1", match: { vendor: "MikroTik", product: "RouterOS — RB700/RB900 serie", category: "networking", enterpriseId: 14988 } },
  { oid: "1.3.6.1.4.1.14988.1.1", match: { vendor: "MikroTik", product: "RouterOS — router (CHR/CCR/RB)", category: "networking", enterpriseId: 14988 } },
  { oid: "1.3.6.1.4.1.14988.1", match: { vendor: "MikroTik", product: "RouterOS generico", category: "networking", enterpriseId: 14988 } },

  // ── Cisco (9) ──
  { oid: "1.3.6.1.4.1.9.1.2271", match: { vendor: "Cisco", product: "Catalyst 9500 serie", category: "networking", enterpriseId: 9 } },
  { oid: "1.3.6.1.4.1.9.1.1863", match: { vendor: "Cisco", product: "Catalyst 9300 serie", category: "networking", enterpriseId: 9 } },
  { oid: "1.3.6.1.4.1.9.1.1786", match: { vendor: "Cisco", product: "Catalyst 9200 serie", category: "networking", enterpriseId: 9 } },
  { oid: "1.3.6.1.4.1.9.1.1227", match: { vendor: "Cisco", product: "Catalyst 2960-X serie", category: "networking", enterpriseId: 9 } },
  { oid: "1.3.6.1.4.1.9.1.1045", match: { vendor: "Cisco", product: "Catalyst 2960 serie", category: "networking", enterpriseId: 9 } },
  { oid: "1.3.6.1.4.1.9.1.1041", match: { vendor: "Cisco", product: "ISR 4000 serie", category: "networking", enterpriseId: 9 } },
  { oid: "1.3.6.1.4.1.9.1.689", match: { vendor: "Cisco", product: "Catalyst 3560 serie", category: "networking", enterpriseId: 9 } },
  { oid: "1.3.6.1.4.1.9.1.658", match: { vendor: "Cisco", product: "ISR 2900 serie", category: "networking", enterpriseId: 9 } },
  { oid: "1.3.6.1.4.1.9.1.620", match: { vendor: "Cisco", product: "ASR 1001", category: "networking", enterpriseId: 9 } },
  { oid: "1.3.6.1.4.1.9.1.516", match: { vendor: "Cisco", product: "Catalyst 3750 serie", category: "networking", enterpriseId: 9 } },
  { oid: "1.3.6.1.4.1.9.1.208", match: { vendor: "Cisco", product: "Catalyst 3500 serie", category: "networking", enterpriseId: 9 } },
  { oid: "1.3.6.1.4.1.9.1.46", match: { vendor: "Cisco", product: "Catalyst 2900 serie", category: "networking", enterpriseId: 9 } },
  { oid: "1.3.6.1.4.1.9.1.1", match: { vendor: "Cisco", product: "IOS — router generico", category: "networking", enterpriseId: 9 } },

  // ── HPE ProCurve (11) ──
  { oid: "1.3.6.1.4.1.11.2.14.11.1.2.167.1.1", match: { vendor: "HPE", product: "ProCurve 2810 serie", category: "networking", enterpriseId: 11 } },
  { oid: "1.3.6.1.4.1.11.2.14.11.1.2.127.1.1", match: { vendor: "HPE", product: "ProCurve 2510 serie", category: "networking", enterpriseId: 11 } },
  { oid: "1.3.6.1.4.1.11.2.14.11.1.2.113.1.1", match: { vendor: "HPE", product: "ProCurve 2626 serie", category: "networking", enterpriseId: 11 } },
  { oid: "1.3.6.1.4.1.11.2.3.7.11.136", match: { vendor: "HPE", product: "ProCurve 2530 serie", category: "networking", enterpriseId: 11 } },
  { oid: "1.3.6.1.4.1.11.2.3.7.11", match: { vendor: "HPE", product: "ProCurve switch generico", category: "networking", enterpriseId: 11 } },

  // ── HPE Comware / H3C (25506) ──
  { oid: "1.3.6.1.4.1.25506.11.2.54", match: { vendor: "HPE", product: "HP 1920 serie (Comware)", category: "networking", enterpriseId: 25506 } },
  { oid: "1.3.6.1.4.1.25506.11.2.37", match: { vendor: "HPE", product: "HP 1910 serie (Comware)", category: "networking", enterpriseId: 25506 } },
  { oid: "1.3.6.1.4.1.25506.11.1.1", match: { vendor: "HPE", product: "HP Comware / H3C generico", category: "networking", enterpriseId: 25506 } },

  // ── Ubiquiti (41112) ──
  { oid: "1.3.6.1.4.1.41112.1.10", match: { vendor: "Ubiquiti", product: "UniFi Dream Machine (UDM)", category: "networking", enterpriseId: 41112 } },
  { oid: "1.3.6.1.4.1.41112.1.7", match: { vendor: "Ubiquiti", product: "UniFi Security Gateway (USG)", category: "firewall", enterpriseId: 41112 } },
  { oid: "1.3.6.1.4.1.41112.1.6.3", match: { vendor: "Ubiquiti", product: "UniFi AP WiFi 6 (U6 serie)", category: "wireless", enterpriseId: 41112 } },
  { oid: "1.3.6.1.4.1.41112.1.6.1", match: { vendor: "Ubiquiti", product: "UniFi AP AC serie", category: "wireless", enterpriseId: 41112 } },
  { oid: "1.3.6.1.4.1.41112.1.6", match: { vendor: "Ubiquiti", product: "UniFi AP (UAP serie)", category: "wireless", enterpriseId: 41112 } },
  { oid: "1.3.6.1.4.1.41112.1.4", match: { vendor: "Ubiquiti", product: "UniFi Switch (USW serie)", category: "networking", enterpriseId: 41112 } },

  // ── Ruckus / CommScope (25053) ──
  { oid: "1.3.6.1.4.1.25053.3.1.11", match: { vendor: "Ruckus", product: "SmartZone controller", category: "wireless", enterpriseId: 25053 } },
  { oid: "1.3.6.1.4.1.25053.3.1.13", match: { vendor: "Ruckus", product: "Virtual SmartZone (vSZ)", category: "wireless", enterpriseId: 25053 } },
  { oid: "1.3.6.1.4.1.25053.3.1.5", match: { vendor: "Ruckus", product: "Unleashed AP", category: "wireless", enterpriseId: 25053 } },
  { oid: "1.3.6.1.4.1.25053.3.1.4.114", match: { vendor: "Ruckus", product: "Ruckus R550 / R560", category: "wireless", enterpriseId: 25053 } },
  { oid: "1.3.6.1.4.1.25053.3.1.4.92", match: { vendor: "Ruckus", product: "Ruckus R510", category: "wireless", enterpriseId: 25053 } },
  { oid: "1.3.6.1.4.1.25053.3.1.4.89", match: { vendor: "Ruckus", product: "Ruckus R500", category: "wireless", enterpriseId: 25053 } },
  { oid: "1.3.6.1.4.1.25053.3.1.4", match: { vendor: "Ruckus", product: "Ruckus AP generico", category: "wireless", enterpriseId: 25053 } },

  // ── TP-Link / Omada (11863) ──
  { oid: "1.3.6.1.4.1.11863.6.4", match: { vendor: "TP-Link", product: "Omada Switch (TL-SG serie)", category: "networking", enterpriseId: 11863 } },
  { oid: "1.3.6.1.4.1.11863.6.1", match: { vendor: "TP-Link", product: "Omada EAP (AP serie)", category: "wireless", enterpriseId: 11863 } },
  { oid: "1.3.6.1.4.1.11863", match: { vendor: "TP-Link", product: "TP-Link / Omada generico", category: "networking", enterpriseId: 11863 } },

  // ── Netgear (4526) ──
  { oid: "1.3.6.1.4.1.4526.100.4.2", match: { vendor: "Netgear", product: "M4300 serie", category: "networking", enterpriseId: 4526 } },
  { oid: "1.3.6.1.4.1.4526.100.4.1", match: { vendor: "Netgear", product: "M4100 serie", category: "networking", enterpriseId: 4526 } },
  { oid: "1.3.6.1.4.1.4526.100.1", match: { vendor: "Netgear", product: "Managed Switch generico", category: "networking", enterpriseId: 4526 } },

  // ── Fortinet (12356) ──
  { oid: "1.3.6.1.4.1.12356.112.1", match: { vendor: "Fortinet", product: "FortiSwitch serie", category: "networking", enterpriseId: 12356 } },
  { oid: "1.3.6.1.4.1.12356.111.1", match: { vendor: "Fortinet", product: "FortiAP (access point)", category: "wireless", enterpriseId: 12356 } },
  { oid: "1.3.6.1.4.1.12356.101.1.600", match: { vendor: "Fortinet", product: "FortiGate 600E serie", category: "firewall", enterpriseId: 12356 } },
  { oid: "1.3.6.1.4.1.12356.101.1.200", match: { vendor: "Fortinet", product: "FortiGate 200E / 200F serie", category: "firewall", enterpriseId: 12356 } },
  { oid: "1.3.6.1.4.1.12356.101.1.100", match: { vendor: "Fortinet", product: "FortiGate 100E / 100F serie", category: "firewall", enterpriseId: 12356 } },
  { oid: "1.3.6.1.4.1.12356.101.1.61", match: { vendor: "Fortinet", product: "FortiGate 60E / 60F serie", category: "firewall", enterpriseId: 12356 } },
  { oid: "1.3.6.1.4.1.12356.101.1.40", match: { vendor: "Fortinet", product: "FortiGate 40F serie", category: "firewall", enterpriseId: 12356 } },
  { oid: "1.3.6.1.4.1.12356.101.1.1", match: { vendor: "Fortinet", product: "FortiGate generico", category: "firewall", enterpriseId: 12356 } },

  // ── Stormshield (11256) ──
  { oid: "1.3.6.1.4.1.11256.1.3", match: { vendor: "Stormshield", product: "SNS SN-XL / SN-HI serie", category: "firewall", enterpriseId: 11256 } },
  { oid: "1.3.6.1.4.1.11256.1.2", match: { vendor: "Stormshield", product: "SNS SN-M série (medium)", category: "firewall", enterpriseId: 11256 } },
  { oid: "1.3.6.1.4.1.11256.1.1", match: { vendor: "Stormshield", product: "SNS SN série (SME)", category: "firewall", enterpriseId: 11256 } },
  { oid: "1.3.6.1.4.1.11256.1", match: { vendor: "Stormshield", product: "SNS appliance generica", category: "firewall", enterpriseId: 11256 } },

  // ── Check Point (2620) ──
  { oid: "1.3.6.1.4.1.2620.1.6", match: { vendor: "Check Point", product: "Gaia OS", category: "firewall", enterpriseId: 2620 } },
  { oid: "1.3.6.1.4.1.2620.1.1", match: { vendor: "Check Point", product: "Security Gateway", category: "firewall", enterpriseId: 2620 } },

  // ── Palo Alto (25461) ──
  { oid: "1.3.6.1.4.1.25461.2.1.2.1.7", match: { vendor: "Palo Alto", product: "PA-3000 serie", category: "firewall", enterpriseId: 25461 } },
  { oid: "1.3.6.1.4.1.25461.2.1.2.1.4", match: { vendor: "Palo Alto", product: "PA-820 / PA-850 serie", category: "firewall", enterpriseId: 25461 } },
  { oid: "1.3.6.1.4.1.25461.2.1.2.1.3", match: { vendor: "Palo Alto", product: "PA-220 serie", category: "firewall", enterpriseId: 25461 } },
  { oid: "1.3.6.1.4.1.25461.2.1.2.1", match: { vendor: "Palo Alto", product: "PA serie (NGFW generico)", category: "firewall", enterpriseId: 25461 } },

  // ── HPE ProLiant / iLO (232) ──
  { oid: "1.3.6.1.4.1.232.1.2.2.1.1.21", match: { vendor: "HPE", product: "ProLiant DL20 / DL160", category: "server", enterpriseId: 232 } },
  { oid: "1.3.6.1.4.1.232.1.2.2.1.1.12", match: { vendor: "HPE", product: "ProLiant ML serie", category: "server", enterpriseId: 232 } },
  { oid: "1.3.6.1.4.1.232.1.2.2.1.1.4", match: { vendor: "HPE", product: "ProLiant DL380 Gen9/10", category: "server", enterpriseId: 232 } },
  { oid: "1.3.6.1.4.1.232.1.2.2.1.1.3", match: { vendor: "HPE", product: "ProLiant DL360 Gen9/10", category: "server", enterpriseId: 232 } },
  { oid: "1.3.6.1.4.1.232.1.2.2.1", match: { vendor: "HPE", product: "ProLiant generico (iLO)", category: "server", enterpriseId: 232 } },

  // ── Dell (674) ──
  { oid: "1.3.6.1.4.1.674.10892.5.1.1.3", match: { vendor: "Dell", product: "PowerEdge M serie (blade)", category: "server", enterpriseId: 674 } },
  { oid: "1.3.6.1.4.1.674.10892.5.1.1.2", match: { vendor: "Dell", product: "PowerEdge T serie (tower)", category: "server", enterpriseId: 674 } },
  { oid: "1.3.6.1.4.1.674.10892.5.1.1.1", match: { vendor: "Dell", product: "PowerEdge R serie (rack)", category: "server", enterpriseId: 674 } },
  { oid: "1.3.6.1.4.1.674.10892.5", match: { vendor: "Dell", product: "PowerEdge iDRAC7/8 (Gen12-14)", category: "server", enterpriseId: 674 } },
  { oid: "1.3.6.1.4.1.674.10892.1", match: { vendor: "Dell", product: "PowerEdge DRAC 4/5 (legacy)", category: "server", enterpriseId: 674 } },

  // ── Supermicro (10876) ──
  { oid: "1.3.6.1.4.1.10876.2.1", match: { vendor: "Supermicro", product: "IPMI / BMC", category: "server", enterpriseId: 10876 } },

  // ── Lenovo (19046) ──
  { oid: "1.3.6.1.4.1.19046.11.1", match: { vendor: "Lenovo", product: "ThinkSystem / XClarity IMM", category: "server", enterpriseId: 19046 } },

  // ── VMware (6876) ──
  { oid: "1.3.6.1.4.1.6876.4.1", match: { vendor: "VMware", product: "vCenter Server Appliance (VCSA)", category: "server", enterpriseId: 6876 } },
  { oid: "1.3.6.1.4.1.6876.1.1", match: { vendor: "VMware", product: "ESXi host generico", category: "server", enterpriseId: 6876 } },

  // ── Synology (6574) ──
  { oid: "1.3.6.1.4.1.6574.3", match: { vendor: "Synology", product: "High Availability (SHA)", category: "storage", enterpriseId: 6574 } },
  { oid: "1.3.6.1.4.1.6574.2", match: { vendor: "Synology", product: "RackStation generico (DSM)", category: "storage", enterpriseId: 6574 } },
  { oid: "1.3.6.1.4.1.6574.1", match: { vendor: "Synology", product: "DiskStation generico (DSM)", category: "storage", enterpriseId: 6574 } },

  // ── QNAP (24681) ──
  { oid: "1.3.6.1.4.1.24681.2.1", match: { vendor: "QNAP", product: "QES (ZFS enterprise NAS)", category: "storage", enterpriseId: 24681 } },
  { oid: "1.3.6.1.4.1.24681.1.4", match: { vendor: "QNAP", product: "NAS — TS serie", category: "storage", enterpriseId: 24681 } },
  { oid: "1.3.6.1.4.1.24681.1.1", match: { vendor: "QNAP", product: "NAS generico (QTS)", category: "storage", enterpriseId: 24681 } },

  // ── NetApp (789) ──
  { oid: "1.3.6.1.4.1.789.1.2", match: { vendor: "NetApp", product: "FAS serie", category: "storage", enterpriseId: 789 } },
  { oid: "1.3.6.1.4.1.789.1.1", match: { vendor: "NetApp", product: "ONTAP controller generico", category: "storage", enterpriseId: 789 } },

  // ── Cisco WLC / Aironet (14179) ──
  { oid: "1.3.6.1.4.1.14179.2.1.1.1.1", match: { vendor: "Cisco", product: "WLC / Aironet AP", category: "wireless", enterpriseId: 14179 } },

  // ── Aruba (388, 14823) ──
  { oid: "1.3.6.1.4.1.14823.1.1", match: { vendor: "Aruba", product: "Aruba wireless controller", category: "wireless", enterpriseId: 14823 } },
  { oid: "1.3.6.1.4.1.388.1.1.1.1", match: { vendor: "Aruba", product: "AOS-CX / ArubaOS switch", category: "networking", enterpriseId: 388 } },

  // ── Net-SNMP / Linux (8072) ──
  { oid: "1.3.6.1.4.1.8072.3.2.255", match: { vendor: "Linux", product: "Linux unknown / custom appliance", category: "server", enterpriseId: 8072 } },
  { oid: "1.3.6.1.4.1.8072.3.2.10", match: { vendor: "Linux", product: "Linux generico (Net-SNMP)", category: "server", enterpriseId: 8072 } },
];

// ── Cache per le entry dal DB ──
let _cachedEntries: Array<{ oid: string; match: SysObjMatch }> | null = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 60000;

export function invalidateSysObjLookupCache(): void {
  _cachedEntries = null;
  _cacheTimestamp = 0;
}

/**
 * Carica le entry dal DB (con cache 60s), fallback alla LOOKUP_TABLE hardcoded.
 * Le entry sono ordinate per lunghezza OID decrescente (longest prefix first).
 */
function getEntriesFromDb(): Array<{ oid: string; match: SysObjMatch }> {
  const now = Date.now();
  if (_cachedEntries && now - _cacheTimestamp < CACHE_TTL_MS) {
    return _cachedEntries;
  }

  try {
    // Dynamic import per evitare circular dependency e problemi di build
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const db = require("@/lib/db");
    const rows: Array<{
      oid: string; vendor: string; product: string;
      category: string; enterprise_id: number; enabled: number;
    }> = db.getSysObjLookupEntries();
    if (rows && rows.length > 0) {
      // getSysObjLookupEntries() already orders by LENGTH(oid) DESC
      _cachedEntries = rows
        .filter((r) => r.enabled)
        .map((r) => ({
          oid: r.oid,
          match: {
            vendor: r.vendor,
            product: r.product,
            category: r.category as SysObjMatch["category"],
            enterpriseId: r.enterprise_id,
          },
        }));
      _cacheTimestamp = now;
      return _cachedEntries;
    }
  } catch {
    // DB non disponibile (build time, test, ecc.) - usa hardcoded
  }

  _cachedEntries = [...LOOKUP_TABLE];
  _cacheTimestamp = now;
  return _cachedEntries;
}

/**
 * Cerca nella tabella il match più specifico per un sysObjectID.
 * Usa longest-prefix-match: la tabella è ordinata dal più lungo al più corto.
 * Carica le entry dal DB con cache; fallback alla LOOKUP_TABLE hardcoded.
 */
export function lookupSysObjectId(sysObjectId: string): SysObjMatch | null {
  if (!sysObjectId) return null;
  const oid = sysObjectId.trim();
  const entries = getEntriesFromDb();
  for (const entry of entries) {
    if (oid === entry.oid || oid.startsWith(entry.oid + ".")) {
      return entry.match;
    }
  }
  return null;
}
