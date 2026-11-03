/** Aruba AOS-CX: parser puri delle letture CLI, collaudati su 6100 / 10.12. */
import { isIP } from 'node:net';
import { cleanConsole } from './parsers';
import type { Identity, DeviceInterface, Vlan, Neighbor, Forwarding, AcquisitionSnapshot, Sensor } from './schema';
const lines = (s: string) => cleanConsole(s).replace(/\r/g, '').split('\n');
const field = (s: string, name: string): string | null => {
    const l = lines(s).find(l => l.split(':')[0].trim().toLowerCase() === name.toLowerCase());
    return l ? l.slice(l.indexOf(':') + 1).trim() || null : null;
};
const n = (s: string | null) => s !== null && /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : null;
const portPattern = /^(?:\d+\/\d+\/\d+|lag\d+)$/;
export function parseCxIdentity(version: string, system: string): Identity | null {
    if (!/\bArubaOS-CX\b|\bAOS-CX\b/i.test(version + '\n' + system)) return null;
    const product = field(system, 'Product Name'), up = field(system, 'Up Time');
    const units: Record<string, number> = { year: 31536000, week: 604800, day: 86400, hour: 3600, minute: 60, second: 1 };
    let uptime: number | null = null;
    for (const m of (up ?? '').matchAll(/(\d+)\s+(year|week|day|hour|minute|second)s?/g)) uptime = (uptime ?? 0) + Number(m[1]) * units[m[2]];
    return { manufacturer: 'Aruba', model: product, part_number: product?.match(/^([A-Z]{2}\d{3}[A-Z]|[A-Z]\d[A-Z]\d{2}[A-Z])\b/)?.[1] ?? null, firmware: field(system, 'ArubaOS-CX Version') ?? field(version, 'Version'), serial_number: field(system, 'Chassis Serial Nbr'), hostname: field(system, 'Hostname'), mac: field(system, 'Base MAC Address')?.toLowerCase() ?? null, sys_object_id: null, uptime_seconds: uptime };
}
export function parseCxInterfaces(text: string): DeviceInterface[] {
    const ls = lines(text), header = ls.find(l => /^Port\s+Native\s+Mode/.test(l));
    if (!header) return [];
    const speed = header.indexOf('Speed'), description = header.indexOf('Description');
    if (speed < 0 || description <= speed) return [];
    const out: DeviceInterface[] = [];
    for (const l of ls) {
        const m = l.match(/^(\d+\/\d+\/\d+|lag\d+)\s+(\d+|--)\s+(\S+)\s+(\S+)\s+(yes|no)\s+(up|down)\b/i);
        if (!m) continue;
        const mbps = n(l.slice(speed, description).trim()), desc = l.slice(description).trim();
        out.push({ name: m[1], if_index: null, description: desc && desc !== '--' ? desc : null, kind: m[1].startsWith('lag') ? 'aggregate' : 'physical', admin_status: m[5].toLowerCase() === 'yes' ? 'up' : 'down', oper_status: m[6].toLowerCase(), speed_bps: mbps === null ? null : mbps * 1e6, reported_speed_bps: null, duplex: null, mtu: null, mac: null, counters: {}, pvid: m[2] === '--' ? null : Number(m[2]) });
    }
    return out;
}
/** Espande solo intervalli nello stesso membro/slot, con limiti espliciti. */
export function cxPorts(text: string): string[] {
    const out: string[] = [];
    for (const token of text.split(',').map(s => s.trim()).filter(Boolean)) {
        if (portPattern.test(token)) { out.push(token); continue; }
        const m = token.match(/^(\d+\/\d+\/)(\d+)-(?:([0-9]+\/[0-9]+\/))?(\d+)$/);
        if (m && (!m[3] || m[3] === m[1]) && Number(m[4]) >= Number(m[2]) && Number(m[4]) - Number(m[2]) < 1024) {
            for (let i = Number(m[2]); i <= Number(m[4]); i++) out.push(m[1] + i);
        }
    }
    return [...new Set(out)];
}
export function parseCxVlans(text: string, ports: DeviceInterface[]): Vlan[] {
    const ls = lines(text), h = ls.find(l => /^VLAN\s+Name\s+Status/.test(l));
    if (!h) return [];
    const cols = ['Name', 'Status', 'Interfaces'].map(v => h.indexOf(v));
    const rows: { id: number; name: string; members: string }[] = [];
    for (const l of ls) {
        const m = l.match(/^(\d+)\s+/);
        if (m) { const id = Number(m[1]); if (id > 0 && id <= 4094) rows.push({ id, name: l.slice(cols[0], cols[1]).trim(), members: l.slice(cols[2]).trim() }); }
        else if (/^\s+(?:\d+\/\d+\/|lag\d)/i.test(l) && rows.length) rows[rows.length - 1].members += ',' + l.trim();
    }
    return rows.map(r => { const members = cxPorts(r.members); return { id: r.id, name: r.name || null, tagged_ports: members.filter(p => { const i = ports.find(i => i.name === p); return i?.pvid != null && i.pvid !== r.id; }), untagged_ports: members.filter(p => ports.find(i => i.name === p)?.pvid === r.id), forbidden_ports: [] }; });
}
export function parseCxFdb(text: string): Forwarding[] {
    return lines(text).flatMap(l => { const m = l.match(/^([\da-f]{2}(?::[\da-f]{2}){5})\s+(\d+)\s+(\S+)\s+(\S+)/i); return m ? [{ mac: m[1].toLowerCase(), vlan_id: Number(m[2]), fdb_id: null, bridge_port: null, if_index: null, port: m[4], status: m[3].toLowerCase() }] : []; });
}
export function parseCxNeighbors(text: string): Neighbor[] {
    const out: Neighbor[] = [];
    let port = '', current: Neighbor | null = null;
    const flush = () => { if (current?.remote_chassis && current.remote_port) out.push(current); current = null; };
    for (const l of lines(text)) {
        const m = l.match(/^\s*([^:]+?)\s*:\s*(.*)$/); if (!m) continue;
        const key = m[1].trim(), value = m[2].trim();
        if (key === 'Port') { flush(); port = value; }
        // Alcuni firmware ripetono il blocco Neighbor senza ripetere Port.
        if (key === 'Neighbor System-Name' && current?.remote_chassis && current.system_name !== null) flush();
        if (!port) continue;
        current ??= { local_port: port, remote_chassis: '', remote_port: '', system_name: null, system_description: null, management_addresses: [], capabilities: [], ttl_seconds: null };
        if (key === 'Neighbor Chassis-ID') { if (current.remote_chassis) { flush(); current = { local_port: port, remote_chassis: '', remote_port: '', system_name: null, system_description: null, management_addresses: [], capabilities: [], ttl_seconds: null }; } current.remote_chassis = value; }
        if (key === 'Neighbor Port-ID') current.remote_port = value;
        if (key === 'Neighbor System-Name') current.system_name = value || null;
        if (key === 'Neighbor System-Description') current.system_description = value || null;
        if (key === 'Neighbor Management-Address' && isIP(value)) current.management_addresses.push(value);
        if (key === 'Chassis Capabilities Enabled') current.capabilities = value.split(',').map(s => s.trim()).filter(Boolean);
        if (key === 'TTL') current.ttl_seconds = n(value);
    }
    flush(); return out;
}
export function parseCxStp(text: string): AcquisitionSnapshot['spanning_tree']['data'] {
    const enabled = /Spanning tree status\s*:\s*(Enabled|Disabled)/i.exec(text), protocol = /Protocol:\s*(\S+)/i.exec(text)?.[1] ?? null;
    const ports: AcquisitionSnapshot['spanning_tree']['data']['ports'] = []; let instance: string | null = null;
    for (const l of lines(text)) { const inst = l.trim().match(/^(MST\d+|CIST|IST)$/); if (inst) instance = inst[1]; const m = l.match(/^(\d+\/\d+\/\d+|lag\d+)\s+(\S+)\s+(\S+)\s+\d+/); if (m) ports.push({ port: m[1], role: m[2].toLowerCase(), state: m[3].toLowerCase(), instance }); }
    return { enabled: enabled ? enabled[1].toLowerCase() === 'enabled' : null, protocol, ports };
}
export function parseCxPoe(text: string): AcquisitionSnapshot['poe']['data'] {
    return lines(text).flatMap(l => { const m = l.match(/^(\d+\/\d+\/\d+)\s+(Yes|No)\s+\S+\s+\S+\s+\S+\s+[\d.]+\s+W\s+([\d.]+)\s+W\s+(\S+)/i); return m ? [{ port: m[1], enabled: m[2].toLowerCase() === 'yes', status: m[4], power_watts: Number(m[3]) }] : []; });
}
export function parseCxTemperatures(text: string): Sensor[] {
    return lines(text).flatMap(l => { const m = l.match(/^(\S+)\s+\S+\s+(-?[\d.]+)\s+C\s+(\S+)/); return m ? [{ name: m[1], kind: 'temperature' as const, value: Number(m[2]), unit: 'celsius' as const, note: m[3] }] : []; });
}
export function parseCxNetwork(ip: string, arp: string): AcquisitionSnapshot['network']['data'] {
    return {
        ipv4_addresses: lines(ip).flatMap(l => { const m = l.match(/^\S+\s+(\d+(?:\.\d+){3})\/(\d+)\s+/); if (!m || isIP(m[1]) !== 4 || Number(m[2]) > 32) return []; const mask = Number(m[2]) === 0 ? 0 : (0xffffffff << (32 - Number(m[2]))) >>> 0; return [{ address: m[1], netmask: [24, 16, 8, 0].map(n => (mask >>> n) & 255).join('.'), if_index: null }]; }),
        arp: lines(arp).flatMap(l => { const m = l.match(/^(\d+(?:\.\d+){3})\s+([\da-f]{2}(?::[\da-f]{2}){5})\s+\S+\s+\S+\s+(\S+)/i); return m && isIP(m[1]) === 4 ? [{ address: m[1], mac: m[2].toLowerCase(), if_index: null, type: m[3] }] : []; }),
    };
}
