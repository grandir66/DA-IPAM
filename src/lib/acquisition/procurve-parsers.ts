import type { Identity, DeviceInterface, Vlan, Neighbor, Aggregation, Forwarding, StpPort, AcquisitionSnapshot } from './schema';
import { cleanConsole, emptyInterface, normalizeMac } from './parsers';
function hpText(raw: string): string {
    return cleanConsole(raw).replace(/,?\s*next page:\s*Space,?\s*next line:\s*(?:Enter|Return),?\s*quit:\s*Control-C/gi, '');
}
function macOrText(value: string): string {
    return /^[0-9a-f\s:.-]+$/i.test(value) && value.replace(/[\s:.-]/g, '').length === 12
        ? normalizeMac(value.replace(/\s/g, '')) : value.trim();
}
export function parseProcurveIdentity(raw: string, description: string): Identity | null {
    if (!/\b(?:Aruba|ProCurve|HP|HPE)\b/i.test(description) || !/\brevision\s+[A-Z]{1,3}\.\d{2}\.\d{2}/i.test(description))
        return null;
    const text = hpText(raw), field = (name: string) => text.match(new RegExp(name + '\\s*:\\s*(\\S+)', 'i'))?.[1] ?? null;
    return { manufacturer: /\bAruba\b/.test(description) ? 'Aruba' : 'HP', model: description.split(/,\s*revision/i)[0].trim(), firmware: description.match(/revision\s+([^,\s]+)/i)?.[1] ?? field('Software revision'), serial_number: field('Serial Number'), hostname: text.match(/System Name\s*:\s*([^\n]*)/i)?.[1]?.trim() || null, mac: field('Base MAC Addr') ? macOrText(field('Base MAC Addr')!) : null, sys_object_id: null, uptime_seconds: null, part_number: description.match(/\b(J[A-Z0-9]{4,6})\b/)?.[1] ?? null, boot_rom: field('ROM Version') ?? description.match(/ROM\s+([^,\s]+)/)?.[1] ?? null };
}
export function parseProcurvePorts(raw: string): DeviceInterface[] {
    const rows: DeviceInterface[] = [];
    for (const line of hpText(raw).split('\n')) {
        const m = line.match(/^\s*([A-Z]?\d+)(?:-Trk\d+)?\s+([^|]*?)\|\s*(?:Yes|No)\s+(Yes|No)\s+(Up|Down|Disabled)\s+(\S+)/i);
        if (!m)
            continue;
        const p = emptyInterface(m[1]);
        p.kind = 'physical';
        p.admin_status = m[3].toLowerCase() === 'yes' ? 'up' : 'down';
        p.oper_status = m[4].toLowerCase() === 'up' ? 'up' : 'down';
        const mode = m[5].match(/^(\d+(?:\.\d+)?)(Gig|G|M)?(FDx?|HDx?)$/i);
        p.reported_speed_bps = mode ? Number(mode[1]) * (mode[2]?.match(/g/i) ? 1e9 : 1e6) : null;
        p.speed_bps = p.oper_status === 'up' ? p.reported_speed_bps : null;
        p.duplex = mode ? (mode[3].toUpperCase().startsWith('F') ? 'full' : 'half') : null;
        rows.push(p);
    }
    return rows;
}
export function parseProcurveVlans(summary: string, detail: string): Vlan[] {
    const out = new Map<number, Vlan>();
    const ensure = (id: number, name: string) => { if (!out.has(id))
        out.set(id, { id, name: name.trim() || null, tagged_ports: [], untagged_ports: [], forbidden_ports: [] }); return out.get(id)!; };
    for (const l of hpText(summary).split('\n')) {
        const m = l.match(/^\s*(\d+)\s+([^|]+)\|\s*Port-based/i);
        if (m && +m[1] <= 4094)
            ensure(+m[1], m[2]);
    }
    let port: string | null = null;
    for (const l of hpText(detail).split('\n')) {
        const h = l.match(/VLAN Information\s*-\s*for ports\s+(Trk\d+|[A-Z]?\d+)\s*$/i);
        if (h) {
            port = h[1];
            continue;
        }
        const m = l.match(/^\s*(\d+)\s+([^|]+)\|\s*Port-based\s+\S+\s+\S+\s+(Tagged|Untagged|Forbid)\b/i);
        if (m && port && +m[1] <= 4094) {
            const v = ensure(+m[1], m[2]);
            const key = m[3].toLowerCase() === 'tagged' ? 'tagged_ports' : m[3].toLowerCase() === 'untagged' ? 'untagged_ports' : 'forbidden_ports';
            if (!v[key].includes(port))
                v[key].push(port);
        }
    }
    return [...out.values()];
}
export function parseProcurveLldp(raw: string): Neighbor[] {
    return hpText(raw).split(/Local Port\s*:/i).slice(1).flatMap(block => {
        const field = (key: string) => block.match(new RegExp('(?:^|\\n)\\s*' + key + '\\s*:\\s*([^\\n]*)', 'i'))?.[1]?.trim() ?? null;
        const chassis = field('ChassisId'), remote = field('PortId'), local = block.match(/^\s*(\S+)/)?.[1];
        if (!chassis || !remote || !local)
            return [];
        const description = block.match(/System Descr\s*:\s*([\s\S]*?)(?=\n\s*PortDescr\s*:|\n\s*Pvid\s*:|\n\s*System Capabilities|$)/i)?.[1].trim() ?? null;
        return [{ local_port: local, remote_chassis: macOrText(chassis), remote_port: macOrText(remote), system_name: field('SysName'), system_description: description, management_addresses: [...block.matchAll(/\bAddress\s*:\s*([0-9a-f:.]+)/gi)].map(m => m[1]), capabilities: (field('System Capabilities Enabled') || '').split(',').map(s => s.trim()).filter(Boolean), ttl_seconds: null }];
    });
}
export function parseProcurveTrunks(raw: string): Aggregation[] {
    const out = new Map<string, Aggregation>();
    for (const l of hpText(raw).split('\n')) {
        const m = l.match(/^\s*([A-Z]?\d+)\s*\|[^|]*\|\s*(Trk\d+)\s+(\S+)/i);
        if (!m)
            continue;
        if (!out.has(m[2]))
            out.set(m[2], { name: m[2], protocol: m[3], admin_status: null, oper_status: null, members: [] });
        out.get(m[2])!.members.push(m[1]);
    }
    return [...out.values()];
}
export function parseProcurvePoe(raw: string): AcquisitionSnapshot['poe']['data'] {
    return hpText(raw).split('\n').flatMap(l => { const m = l.match(/^\s*([A-Z]?\d+)\s+(Yes|No)\s+\S+\s+\S+\s+\S+\s+\S+\s+([\d.]+)\s*W\s+([\d.]+)\s*W\s+(\S+)/i); return m ? [{ port: m[1], enabled: m[2].toLowerCase() === 'yes', power_watts: +m[4], status: m[5] }] : []; });
}
export function parseProcurveStp(raw: string): AcquisitionSnapshot['spanning_tree']['data'] {
    const text = hpText(raw), enabled = text.match(/STP Enabled\s*:\s*(Yes|No)/i)?.[1], root = text.match(/CST Root Port\s*:\s*(\S+)/i)?.[1], ports: StpPort[] = [];
    for (const l of text.split('\n')) {
        const m = l.match(/^\s*(Trk\d+|[A-Z]?\d+)\s+[^|]*\|\s*\S+\s+\d+\s+(Forwarding|Blocking|Learning|Listening|Disabled|Discarding)\b/i);
        if (m)
            ports.push({ port: m[1], instance: 'CIST', state: m[2].toLowerCase(), role: m[1] === root ? 'root' : null });
    }
    return { enabled: enabled ? enabled.toLowerCase() === 'yes' : null, protocol: text.match(/Force Version\s*:\s*(\S+)/i)?.[1] ?? null, ports };
}
export function parseProcurveFdb(raw: string): Forwarding[] { return hpText(raw).split('\n').flatMap(l => { const m = l.match(/^\s*([0-9a-f]{6}-[0-9a-f]{6})\s+(Trk\d+|[A-Z]?\d+)\s+(\d+)\s*$/i); return m ? [{ mac: macOrText(m[1]), port: m[2], vlan_id: +m[3], if_index: null, bridge_port: null, fdb_id: null, status: null }] : []; }); }
export function parseProcurveResources(raw: string) { const text = hpText(raw), numeric = (r: RegExp) => { const m = text.match(r)?.[1]; return m === undefined ? null : Number(m.replace(/,/g, '')); }; return { cpu_percent: numeric(/CPU Util \(%\)\s*:\s*([\d.]+)/i), memory_total_bytes: numeric(/Memory\s*-\s*Total\s*:\s*([\d,]+)/i), memory_free_bytes: numeric(/CPU Util[^\n]*Free\s*:\s*([\d,]+)/i) }; }
export function parseProcurveEnvironment(fans: string, poe: string) { const text = hpText(poe), watts = (key: string) => { const m = text.match(new RegExp(key + ':\\s*([\\d.]+)\\s*W', 'i')); return m ? +m[1] : null; }; return { fans: hpText(fans).split('\n').flatMap(l => { const m = l.match(/^\s*(Fan-\d+)\s*\|\s*([^|]+)\|\s*(\d+)\s*\|/i); return m ? [{ name: m[1], status: /Fan OK/i.test(m[2]) ? 'ok' as const : /fail|fault/i.test(m[2]) ? 'fault' as const : 'unknown' as const, failures: +m[3] }] : []; }), poe_budget_watts: { available: watts('Available'), used: watts('Used'), remaining: watts('Remaining') } }; }
export { hpText as cleanProcurveConsole };
