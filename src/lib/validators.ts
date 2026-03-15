import { z } from "zod";

const cidrRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;
const ipRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

export const NetworkSchema = z.object({
  cidr: z.string().regex(cidrRegex, "CIDR non valido (es. 192.168.1.0/24)").refine((val) => {
    const match = val.match(cidrRegex);
    if (!match) return false;
    const octets = [parseInt(match[1]), parseInt(match[2]), parseInt(match[3]), parseInt(match[4])];
    const prefix = parseInt(match[5]);
    return octets.every((o) => o >= 0 && o <= 255) && prefix >= 1 && prefix <= 32;
  }, "Indirizzo IP o prefisso non valido"),
  name: z.string().min(1, "Nome richiesto").max(100),
  description: z.string().max(500).optional().default(""),
  gateway: z.string().regex(ipRegex, "Indirizzo IP gateway non valido").optional().or(z.literal("")),
  vlan_id: z.coerce.number().int().min(1).max(4094).optional().nullable(),
  location: z.string().max(200).optional().default(""),
  snmp_community: z.string().max(100).optional().nullable(),
  dns_server: z.union([z.string().regex(ipRegex, "Indirizzo IP DNS non valido"), z.literal("")]).optional().nullable(),
  router_id: z.coerce.number().int().positive().optional().nullable(),
});

export const HostSchema = z.object({
  network_id: z.coerce.number().int().positive(),
  ip: z.string().regex(ipRegex, "Indirizzo IP non valido"),
  mac: z.string().regex(macRegex, "MAC address non valido").optional().or(z.literal("")),
  hostname: z.string().max(255).optional(),
  custom_name: z.string().max(200).optional(),
  classification: z.string().max(100).optional(),
  inventory_code: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

export const HostUpdateSchema = z.object({
  custom_name: z.string().max(200).optional(),
  classification: z.string().max(100).optional(),
  inventory_code: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  mac: z.string().regex(macRegex, "MAC address non valido").optional().or(z.literal("")),
  known_host: z.union([z.literal(0), z.literal(1)]).optional(),
});

export const NetworkDeviceSchema = z.object({
  name: z.string().min(1, "Nome richiesto").max(100),
  host: z.string().regex(ipRegex, "Indirizzo IP non valido"),
  device_type: z.enum(["router", "switch"]),
  vendor: z.enum(["mikrotik", "ubiquiti", "hp", "cisco", "omada", "other"]),
  protocol: z.enum(["ssh", "snmp_v2", "snmp_v3", "api"]),
  username: z.string().max(100).optional(),
  password: z.string().max(200).optional(),
  community_string: z.string().max(100).optional(),
  api_token: z.string().max(500).optional(),
  api_url: z.string().url().optional().or(z.literal("")),
  port: z.coerce.number().int().min(1).max(65535).optional(),
});

export const ScheduledJobSchema = z.object({
  network_id: z.coerce.number().int().positive().optional().nullable(),
  job_type: z.enum(["ping_sweep", "nmap_scan", "arp_poll", "dns_resolve", "cleanup"]),
  interval_minutes: z.coerce.number().int().min(1).max(10080), // max 1 week
  config: z.record(z.string(), z.unknown()).optional(),
});

export const ScanTriggerSchema = z.object({
  network_id: z.coerce.number().int().positive(),
  scan_type: z.enum(["ping", "nmap", "arp_poll", "dhcp"]),
  nmap_profile_id: z.coerce.number().int().positive().optional(),
});

export const LoginSchema = z.object({
  username: z.string().min(1, "Username richiesto"),
  password: z.string().min(1, "Password richiesta"),
});

export const SetupSchema = z.object({
  username: z.string().min(3, "Username minimo 3 caratteri").max(50),
  password: z.string().min(8, "Password minimo 8 caratteri").max(100),
  confirm_password: z.string(),
}).refine((data) => data.password === data.confirm_password, {
  message: "Le password non corrispondono",
  path: ["confirm_password"],
});
