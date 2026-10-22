import { z } from "zod";
import {ontapStorageSchema} from "./ontap-schema";
import { virtualizationSchema } from "./vmware-schema";
import { COLLECTOR_IDS, descrittore } from "./catalogo";
import { SNMP_V3_AUTH_PROTOCOLS, SNMP_V3_PRIV_PROTOCOLS, SNMP_V3_SECURITY_LEVELS } from "../protocols/snmp-sessione";
import { systemSchema, hostStorageSchema, softwareSchema, servicesSchema, securitySchema, sharesSchema } from "./sistema-schema";
const port = z.number().int().min(1).max(65535);
const secret = z.string().min(1).max(16384);
export const acquisitionInputSchema = z.object({
    collector: z.enum(COLLECTOR_IDS).default("qnap-switch"),
    host: z.string().min(1).max(253).regex(/^[a-zA-Z0-9.:_-]+$/),
    snmp: z.union([
        z.object({ community: secret, version: z.enum(["1", "2c"]).default("2c"), port: port.default(161) }).strict(),
        z.object({ version: z.literal("3"), username: z.string().min(1).max(128), level: z.enum(SNMP_V3_SECURITY_LEVELS), authProtocol: z.enum(SNMP_V3_AUTH_PROTOCOLS).optional(), authKey: secret.optional(), privProtocol: z.enum(SNMP_V3_PRIV_PROTOCOLS).optional(), privKey: secret.optional(), port: port.default(161) }).strict(),
    ]).optional(),
    ssh: z.object({ username: z.string().min(1).max(128), password: secret.optional(), privateKey: secret.optional(), passphrase: secret.optional(), port: port.default(22) }).strict().refine(v => !!(v.password || v.privateKey), "Manca il segreto SSH").optional(),
    winrm: z.object({ username: z.string().min(1).max(256), password: secret, port: port.default(5985), realm: z.string().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/).optional() }).strict().optional(),
    api: z.object({username:z.string().min(1).max(128),password:secret,port:port.default(443),tls_sha256:z.string().regex(/^(?:[a-fA-F0-9]{2}:){31}[a-fA-F0-9]{2}$/).optional()}).strict().optional(),
    limits: z.object({ timeout_ms: z.number().int().min(500).max(15000).default(4000), max_rows: z.number().int().min(32).max(20000).default(4096), max_output_bytes: z.number().int().min(4096).max(4194304).default(1048576), total_timeout_ms: z.number().int().min(5000).max(300000).default(90000) }).strict().default({ timeout_ms: 4000, max_rows: 4096, max_output_bytes: 1048576, total_timeout_ms: 90000 }),
}).strict().refine(v => { const c = descrittore(v.collector).credenziali, date = (["snmp", "ssh", "api", "winrm"] as const).filter(p => !!v[p]); return date.every(p => (c.ammesse as readonly string[]).includes(p)) && c.una_di.some(p => !!v[p]); }, "Credenziali non compatibili con il collector");
export type AcquisitionInput = z.infer<typeof acquisitionInputSchema>;
export type AcquisitionRequest = z.input<typeof acquisitionInputSchema>;
const nullableString = z.string().nullable();
const nullableNumber = z.number().finite().nullable();
export const identitySchema = z.object({ part_number: nullableString.optional(), boot_rom: nullableString.optional(), manufacturer: nullableString, model: nullableString, firmware: nullableString, serial_number: nullableString, hostname: nullableString, mac: nullableString, sys_object_id: nullableString, uptime_seconds: nullableNumber });
export const interfaceSchema = z.object({ slot: nullableString.optional(), module_observed: z.boolean().nullable().optional(), name: z.string(), if_index: z.number().int().nullable(), description: nullableString, kind: z.enum(["physical", "aggregate", "other"]), admin_status: nullableString, oper_status: nullableString, speed_bps: nullableNumber, reported_speed_bps: nullableNumber, duplex: nullableString, mtu: nullableNumber, mac: nullableString, counters: z.record(z.string(), z.string().regex(/^\d+$/)), pvid: z.number().int().nullable() });
export const vlanSchema = z.object({ id: z.number().int().min(1).max(4094), name: nullableString, description: nullableString.optional(), tagged_ports: z.array(z.string()), untagged_ports: z.array(z.string()), forbidden_ports: z.array(z.string()) });
export const neighborSchema = z.object({ local_port: z.string(), remote_chassis: z.string(), remote_port: z.string(), system_name: nullableString, system_description: nullableString, management_addresses: z.array(z.string()), capabilities: z.array(z.string()), ttl_seconds: nullableNumber });
export const fdbSchema = z.object({ mac: z.string(), vlan_id: z.number().int().nullable(), fdb_id: z.number().int().nullable(), bridge_port: z.number().int().nullable(), if_index: z.number().int().nullable(), port: nullableString, status: nullableString });
export const stpSchema = z.object({ port: z.string(), instance: nullableString, state: nullableString, role: nullableString });
export const lagSchema = z.object({ name: z.string(), protocol: nullableString, admin_status: nullableString, oper_status: nullableString, members: z.array(z.string()), member_states: z.array(z.object({ port: z.string(), selection: z.string(), flags: z.array(z.string()) })).optional() });
export const sensorSchema = z.object({ name: z.string(), kind: z.enum(["temperature", "fan", "optical_rx", "optical_tx", "voltage", "current"]), value: z.number().finite(), unit: z.enum(["celsius", "rpm", "dBm", "milliwatt", "volt", "ampere"]), note: nullableString, thresholds: z.object({ lower: nullableNumber, warning: nullableNumber, alarm: nullableNumber, shutdown: nullableNumber }).optional() });
export const poeSchema = z.object({ port: z.string(), enabled: z.boolean().nullable(), status: nullableString, power_watts: nullableNumber, module_observed: z.boolean().nullable().optional() });
export const sectionStatus = z.enum(["ok", "partial", "unsupported", "error", "skipped"]);
function section<T extends z.ZodType>(data: T) { return z.object({ status: sectionStatus, collected_at: z.string().datetime(), sources: z.array(z.string()), warnings: z.array(z.string()), data: data }); }
export const snapshotSchema = z.object({
    schema_version: z.literal("1.0"), collector: z.enum(COLLECTOR_IDS), collector_version: z.string().regex(/^\d+\.\d+\.\d+$/), target: z.string(), collected_at: z.string().datetime(), duration_ms: z.number().nonnegative(), status: z.enum(["ok", "partial", "error"]),
    storage: section(ontapStorageSchema).optional(),
    virtualization: section(virtualizationSchema).optional(),
    system: section(systemSchema).optional(),
    host_storage: section(hostStorageSchema).optional(),
    software: section(softwareSchema).optional(),
    services: section(servicesSchema).optional(),
    security: section(securitySchema).optional(),
    shares: section(sharesSchema).optional(),
    modules: section(z.array(z.object({ slot: z.string(), description: nullableString, model: nullableString, serial_number: nullableString, status: nullableString, software_revision: nullableString.optional(), subslot: nullableNumber.optional() }))).optional(),
    hardware: section(z.array(z.object({ entity_index: z.number().int(), parent_index: nullableNumber, position: nullableNumber, class_code: nullableNumber, name: nullableString, description: nullableString, model: nullableString, serial_number: nullableString, manufacturer: nullableString, hardware_revision: nullableString, firmware_revision: nullableString, software_revision: nullableString, alias: nullableString, asset_tag: nullableString, replaceable: z.boolean().nullable() }))).optional(),
    resources: section(z.object({ cpu_percent: nullableNumber, memory_total_bytes: nullableNumber, memory_free_bytes: nullableNumber, instances: z.array(z.object({ slot: z.string(), cpu_percent: nullableNumber, memory_total_bytes: nullableNumber, memory_free_bytes: nullableNumber })).optional() })).optional(),
    environment: section(z.object({ fans: z.array(z.object({ name: z.string(), status: z.enum(["ok", "fault", "unknown"]), failures: nullableNumber, airflow_direction: nullableString.optional(), preferred_airflow_direction: nullableString.optional() })), power_supplies: z.array(z.object({ slot: z.string(), id: z.string(), status: nullableString, mode: nullableString })).optional(), input_power_watts: z.array(z.object({ slot: z.string(), watts: nullableNumber })).optional(), poe_budget_watts: z.object({ available: nullableNumber, used: nullableNumber, remaining: nullableNumber }) })).optional(),
    network: section(z.object({ ipv4_addresses: z.array(z.object({ address: z.string(), netmask: nullableString, if_index: z.number().int().nullable() })), arp: z.array(z.object({ address: z.string(), mac: nullableString, if_index: z.number().int().nullable(), type: nullableString })) })),
    identity: section(identitySchema.nullable()), interfaces: section(z.array(interfaceSchema)), vlans: section(z.array(vlanSchema)), forwarding: section(z.array(fdbSchema)), neighbors: section(z.array(neighborSchema)), spanning_tree: section(z.object({ enabled: z.boolean().nullable(), protocol: nullableString, ports: z.array(stpSchema) })), aggregation: section(z.array(lagSchema)), poe: section(z.array(poeSchema)).extend({ enabled: z.boolean().nullable().optional() }), sensors: section(z.array(sensorSchema)),
});
export type AcquisitionSnapshot = z.infer<typeof snapshotSchema>;
export type Identity = z.infer<typeof identitySchema>;
export type DeviceInterface = z.infer<typeof interfaceSchema>;
export type Vlan = z.infer<typeof vlanSchema>;
export type Neighbor = z.infer<typeof neighborSchema>;
export type Sensor = z.infer<typeof sensorSchema>;
export type Aggregation = z.infer<typeof lagSchema>;
export type Forwarding = z.infer<typeof fdbSchema>;
export type StpPort = z.infer<typeof stpSchema>;
export interface SnmpRow {
    oid: string;
    value: string | number | {
        hex: string;
    };
}
export interface ReadResult<T> {
    status: "ok" | "unsupported" | "partial" | "error";
    data: T;
    warnings: string[];
}
export interface AcquisitionTransports {
    get(oids: string[]): Promise<ReadResult<SnmpRow[]>>;
    walk(oid: string): Promise<ReadResult<SnmpRow[]>>;
    shell(commands: readonly string[]): Promise<Record<string, ReadResult<string>>>;
    /** Script PowerShell dell'allowlist del collector, per id (WinRM). Assente = trasporto non disponibile. */
    winrm?(scripts: readonly string[]): Promise<Record<string, ReadResult<string>>>;
}
