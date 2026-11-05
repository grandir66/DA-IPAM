import { z } from 'zod';
/** Campi DDI espliciti: gli altri campi WAPI (segreti, TSIG, utenti) non entrano nello snapshot. */
const str = z.string().nullable().optional();
const num = z.number().finite().safe().nullable().optional();
const bool = z.boolean().nullable().optional();
export const infobloxRecordSchema = z.object({
    _ref: z.string().min(1), name: str, host_name: str, platform: str, comment: str,
    network: str, network_view: str, view: str, fqdn: str, zone_format: str,
    ipv4addr: str, ipv6addr: str, address: str, mac: str, hardware: str,
    start_addr: str, end_addr: str, binding_state: str, client_hostname: str, protocol: str,
    starts: num, ends: num, never_starts: bool, never_ends: bool, disable: bool, is_default: bool,
    canonical: str, ptrdname: str, mail_exchanger: str, preference: num, text: str,
    target: str, port: num, priority: num, weight: num, ttl: num, enable_ha: bool,
    aliases: z.array(z.string()).optional(),
    ipv4addrs: z.array(z.object({ ipv4addr: str, mac: str, configure_for_dhcp: bool })).optional(),
    ipv6addrs: z.array(z.object({ ipv6addr: str, duid: str, configure_for_dhcp: bool })).optional(),
    options: z.array(z.object({ name: str, num, value: str, vendor_class: str })).optional(),
    vip_setting: z.object({ address: str, subnet_mask: str, gateway: str }).optional(),
});
export const INFOBLOX_OBJECTS = {
    grid: ['name'], member: ['host_name', 'platform', 'vip_setting', 'enable_ha'],
    networkview: ['name', 'comment', 'is_default'],
    network: ['network', 'network_view', 'comment', 'disable', 'options'],
    ipv6network: ['network', 'network_view', 'comment', 'disable', 'options'],
    networkcontainer: ['network', 'network_view', 'comment'],
    ipv6networkcontainer: ['network', 'network_view', 'comment'],
    range: ['start_addr', 'end_addr', 'network', 'network_view', 'name', 'comment', 'disable', 'options'],
    ipv6range: ['start_addr', 'end_addr', 'network', 'network_view', 'name', 'comment', 'disable', 'options'],
    fixedaddress: ['ipv4addr', 'mac', 'network', 'network_view', 'name', 'comment', 'disable', 'options'],
    ipv6fixedaddress: ['ipv6addr', 'network', 'network_view', 'name', 'comment', 'disable', 'options'],
    view: ['name', 'network_view', 'is_default', 'comment'],
    zone_auth: ['fqdn', 'view', 'zone_format', 'disable', 'comment'],
    zone_forward: ['fqdn', 'view', 'disable', 'comment'],
    'record:host': ['name', 'view', 'ipv4addrs', 'ipv6addrs', 'aliases', 'disable', 'comment', 'ttl'],
    'record:a': ['name', 'view', 'ipv4addr', 'disable', 'comment', 'ttl'],
    'record:aaaa': ['name', 'view', 'ipv6addr', 'disable', 'comment', 'ttl'],
    'record:cname': ['name', 'view', 'canonical', 'disable', 'comment', 'ttl'],
    'record:ptr': ['name', 'view', 'ptrdname', 'ipv4addr', 'ipv6addr', 'disable', 'comment', 'ttl'],
    'record:mx': ['name', 'view', 'mail_exchanger', 'preference', 'disable', 'comment', 'ttl'],
    'record:txt': ['name', 'view', 'text', 'disable', 'comment', 'ttl'],
    'record:srv': ['name', 'view', 'target', 'port', 'priority', 'weight', 'disable', 'comment', 'ttl'],
    // Le tabelle potenzialmente più pesanti vengono dopo reti e DNS.
    lease: ['address', 'hardware', 'client_hostname', 'network', 'network_view', 'binding_state', 'starts', 'ends', 'never_starts', 'never_ends', 'protocol'],
} as const;
export type InfobloxObject = keyof typeof INFOBLOX_OBJECTS;
const names = Object.keys(INFOBLOX_OBJECTS) as [InfobloxObject, ...InfobloxObject[]];
export const infobloxDdiSchema = z.object({
    scope: z.literal('grid-visible-to-account'), wapi_version: z.string().nullable(),
    tables: z.array(z.object({ object: z.enum(names), status: z.enum(['ok', 'partial', 'unsupported', 'error', 'skipped']), sources: z.array(z.string()), warnings: z.array(z.string()), fields_requested: z.array(z.string()), records: z.array(infobloxRecordSchema) })),
});
export type InfobloxDdi = z.infer<typeof infobloxDdiSchema>;
export type InfobloxRecord = z.infer<typeof infobloxRecordSchema>;
export function highestWapiVersion(versions: unknown): string | null {
    if (!Array.isArray(versions)) return null;
    const valid = versions.filter((v): v is string => typeof v === 'string' && /^\d+\.\d+(?:\.\d+)?$/.test(v));
    return valid.sort((a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { const diff = (y[i] ?? 0) - (x[i] ?? 0); if (diff) return diff; } return 0; })[0] ?? null;
}
/** Nessuna deduplicazione per IP/nome: ref, vista e tipo restano distinti. */
export function parseInfobloxRecords(records: unknown[], fields: readonly string[]): { records: InfobloxRecord[]; invalid: number } {
    const out: InfobloxRecord[] = []; let invalid = 0;
    for (const row of records) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) { invalid++; continue; }
        const raw = Object.fromEntries(Object.entries(row).filter(([key]) => key === '_ref' || fields.includes(key)));
        const parsed = infobloxRecordSchema.safeParse(raw);
        if (parsed.success) out.push(parsed.data); else invalid++;
    }
    return { records: out, invalid };
}
