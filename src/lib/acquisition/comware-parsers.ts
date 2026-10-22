import type { AcquisitionSnapshot, DeviceInterface, Vlan, Neighbor, Forwarding, Aggregation, Sensor } from './schema';
import { cleanConsole, emptyInterface, normalizeMac } from './parsers';
export const comwareText = (raw: string) => cleanConsole(raw).replace(/\0/g, '').replace(/\r/g, '');
export function comwarePort(name: string): string { return name.replace(/^Ten-GigabitEthernet/i, 'XGE').replace(/^GigabitEthernet/i, 'GE').replace(/^FortyGigE/i, 'FGE').replace(/^HundredGigE/i, 'HGE').replace(/^Bridge-Aggregation/i, 'BAGG').replace(/^Route-Aggregation/i, 'RAGG'); }
const field = (text: string, key: string) => text.match(new RegExp('^\\s*' + key + '\\s*:\\s*([^\\n]*)', 'mi'))?.[1]?.trim() || null;
const macText = (s: string) => /^(?:[a-f\d]{4}-){2}[a-f\d]{4}$/i.test(s) ? normalizeMac(s) : s;
export function parseComwarePorts(raw: string): DeviceInterface[] { return comwareText(raw).split('\n').flatMap(line => { const m = line.match(/^\s*(\S+)\s+(UP|DOWN|ADM)\s+(\S+)\s+(\S+)(?:\s+(\S+)\s+(\S+))?/); if (!m)
    return []; const p = emptyInterface(comwarePort(m[1])); p.kind = /^[BR]AGG/.test(p.name) ? 'aggregate' : /^(?:XGE|GE|FGE|HGE)\d/.test(p.name) ? 'physical' : 'other'; p.oper_status = m[2] === 'UP' ? 'up' : 'down'; p.admin_status = m[2] === 'ADM' ? 'down' : 'up'; const speed = m[3].match(/^(\d+(?:\.\d+)?)([GMK])/i); p.reported_speed_bps = speed ? +speed[1] * ({ G: 1e9, M: 1e6, K: 1e3 }[speed[2].toUpperCase()]!) : null; p.speed_bps = p.oper_status === 'up' ? p.reported_speed_bps : null; p.duplex = /^F/.test(m[4]) ? 'full' : /^H/.test(m[4]) ? 'half' : null; p.pvid = m[6] && /^\d+$/.test(m[6]) ? +m[6] : null; const slot = p.name.match(/^(?:XGE|GE|FGE|HGE)(\d+)\//)?.[1]; if (slot)
    p.slot = slot; return [p]; }); }
export function parseComwareVlans(raw: string): Vlan[] { return comwareText(raw).split(/VLAN ID:\s*/).slice(1).flatMap(b => { const id = +(b.match(/^\d+/)?.[0] ?? 0); if (id < 1 || id > 4094)
    return []; const v: Vlan = { id, name: field(b, 'Name'), description: field(b, 'Description'), tagged_ports: [], untagged_ports: [], forbidden_ports: [] }; for (const [label, key] of [['Tagged', 'tagged_ports'], ['Untagged', 'untagged_ports']] as const) {
    const part = b.match(new RegExp('(?:^|\\n)\\s*' + label + ' ports:\\s*([\\s\\S]*?)(?=\\n\\s*(?:Tagged|Untagged) ports:|$)', 'i'))?.[1] ?? '';
    v[key] = [...new Set((part.match(/(?:Ten-GigabitEthernet|GigabitEthernet|FortyGigE|HundredGigE|Bridge-Aggregation|Route-Aggregation)[\d/]+/gi) || []).map(comwarePort))];
} return [v]; }); }
export function parseComwareLldp(raw: string): Neighbor[] { return comwareText(raw).split(/LLDP neighbor-information of port /i).slice(1).flatMap(port => { const local = port.match(/^\d+\[([^\]]+)\]/)?.[1]; if (!local)
    return []; return port.split(/LLDP neighbor index\s*:\s*\d+/i).slice(1).flatMap(b => { const chassis = field(b, 'Chassis ID'), remote = field(b, 'Port ID'); if (!chassis || !remote)
    return []; return [{ local_port: comwarePort(local), remote_chassis: macText(chassis), remote_port: macText(remote), system_name: field(b, 'System name'), system_description: b.match(/System description\s*:\s*([\s\S]*?)(?=\n\s*System capabilities|$)/i)?.[1]?.trim() || null, management_addresses: [...b.matchAll(/^\s*Management address\s*:\s*([^\s]+)/gmi)].map(m => m[1]), capabilities: (field(b, 'System capabilities enabled') ?? '').split(/[, ]+/).filter(Boolean), ttl_seconds: /^\d+$/.test(field(b, 'Time to live') ?? '') ? Number(field(b, 'Time to live')) : null }]; }); }); }
export function parseComwareFdb(raw: string): Forwarding[] { return comwareText(raw).split('\n').flatMap(l => { const m = l.match(/^\s*((?:[a-f\d]{4}-){2}[a-f\d]{4})\s+(\d+)\s+(\S+)\s+(\S+)/i); return m ? [{ mac: macText(m[1]), vlan_id: +m[2], fdb_id: null, bridge_port: null, if_index: null, port: comwarePort(m[4]), status: m[3] }] : []; }); }
export function parseComwareLags(raw: string): Aggregation[] { return comwareText(raw).split(/Aggregate Interface:\s*/i).slice(1).map(b => { const local = b.split(/\bLocal:\s*/i)[1]?.split(/\bRemote:/i)[0] ?? ''; const states = [...local.matchAll(/^\s*((?:XGE|GE|FGE|HGE)\S+)\s+([SUI])\s+\d+\s+\d+\s+\{([^}]*)\}/gmi)].map(m => ({ port: comwarePort(m[1]), selection: m[2], flags: m[3].split('') })); return { name: comwarePort(b.match(/^\S+/)?.[0] ?? ''), protocol: field(b, 'Aggregation Mode'), admin_status: null, oper_status: null, members: states.map(s => s.port), member_states: states }; }); }
export function parseComwareStp(brief: string, full: string): AcquisitionSnapshot['spanning_tree']['data'] { const t = comwareText(full), ports = [...comwareText(brief).matchAll(/^\s*(\d+)\s+(\S+)\s+(ROOT|DESI|ALTE|BACK|MAST)\s+(\S+)\s+\S+/gm)].map(m => ({ instance: m[1], port: comwarePort(m[2]), role: m[3], state: m[4].toLowerCase() })); return { enabled: /Port protocol\s*:\s*Enabled/i.test(t) ? true : /STP is disabled/i.test(t) ? false : null, protocol: t.match(/Global Info\]\[Mode\s+([^\]]+)/)?.[1] ?? null, ports }; }
export function parseComwareModules(raw: string): NonNullable<AcquisitionSnapshot['modules']>['data'] { return [...comwareText(raw).matchAll(/^\s*(\d+)\s+(.+?)\s+(Master|Standby|Normal|Fault|Absent)\s+(\d+)\s+(\S+)\s+\S+/gm)].map(m => ({ slot: m[1], model: m[2].trim(), description: m[2].trim(), status: m[3], subslot: +m[4], software_revision: m[5], serial_number: null })); }
export function parseComwareResources(cpu: string, memory: string): NonNullable<AcquisitionSnapshot['resources']>['data'] { const slots = new Map<string, {
    slot: string;
    cpu_percent: number | null;
    memory_total_bytes: number | null;
    memory_free_bytes: number | null;
}>(); const get = (slot: string) => { if (!slots.has(slot))
    slots.set(slot, { slot, cpu_percent: null, memory_total_bytes: null, memory_free_bytes: null }); return slots.get(slot)!; }; for (const b of comwareText(cpu).split(/Slot\s+(\d+)\s+CPU\s*\d+\s+CPU usage:/i).slice(1).reduce<string[][]>((a, s, i, all) => { if (i % 2 === 0)
    a.push([s, all[i + 1] ?? '']); return a; }, [])) {
    const n = b[1].match(/(\d+(?:\.\d+)?)%\s+in last 5 seconds/i);
    if (n)
        get(b[0]).cpu_percent = +n[1];
} const parts = comwareText(memory).split(/Slot\s+(\d+)\s*:/i); for (let i = 1; i < parts.length; i += 2) {
    const m = parts[i + 1].match(/Mem:\s*(\d+)\s+\d+\s+(\d+)/);
    if (m && /measured in KB/i.test(memory)) {
        get(parts[i]).memory_total_bytes = +m[1] * 1024;
        get(parts[i]).memory_free_bytes = +m[2] * 1024;
    }
} const instances = [...slots.values()]; return { cpu_percent: instances.length === 1 ? instances[0].cpu_percent : null, memory_total_bytes: instances.length === 1 ? instances[0].memory_total_bytes : null, memory_free_bytes: instances.length === 1 ? instances[0].memory_free_bytes : null, instances }; }
export function parseComwareSensors(raw: string): Sensor[] { return [...comwareText(raw).matchAll(/^\s*(\d+)\s+(.+?)\s+(-?\d+)\s+(-?\d+|NA)\s+(-?\d+|NA)\s+(-?\d+|NA)\s+(-?\d+|NA)\s*$/gm)].map(m => ({ name: `slot${m[1]}/${m[2]}`, kind: 'temperature', value: +m[3], unit: 'celsius', note: null, thresholds: { lower: m[4] === 'NA' ? null : +m[4], warning: m[5] === 'NA' ? null : +m[5], alarm: m[6] === 'NA' ? null : +m[6], shutdown: m[7] === 'NA' ? null : +m[7] } })); }
export function parseComwareEnvironment(fans: string, power: string): NonNullable<AcquisitionSnapshot['environment']>['data'] { const out: NonNullable<AcquisitionSnapshot['environment']>['data'] = { fans: [], power_supplies: [], input_power_watts: [], poe_budget_watts: { available: null, used: null, remaining: null } }; const chunks = comwareText(fans).split(/Slot\s+(\d+)\s*:/i); for (let i = 1; i < chunks.length; i += 2) {
    const parts = chunks[i + 1].split(/Fan\s+(\d+)\s*:/i);
    for (let j = 1; j < parts.length; j += 2) {
        const state = field(parts[j + 1], 'State');
        out.fans.push({ name: `slot${chunks[i]}/fan${parts[j]}`, status: state === 'Normal' ? 'ok' : state && /fault|fail/i.test(state) ? 'fault' : 'unknown', failures: null, airflow_direction: field(parts[j + 1], 'Airflow Direction'), preferred_airflow_direction: field(parts[j + 1], 'Prefer Airflow Direction') });
    }
} const ps = comwareText(power).split(/Slot\s+(\d+)\s*:/i); for (let i = 1; i < ps.length; i += 2) {
    const watts = ps[i + 1].match(/Input Power:\s*([\d.]+)\s*\(W\)/i);
    if (watts)
        out.input_power_watts!.push({ slot: ps[i], watts: +watts[1] });
    for (const m of ps[i + 1].matchAll(/^\s*(\d+)\s+(Normal|Absent|Fault|Failed)\s+(\S+)/gm))
        out.power_supplies!.push({ slot: ps[i], id: m[1], status: m[2], mode: m[3] });
} return out; }
